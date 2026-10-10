package com.alproutes.routes

import com.alproutes.areas.AreaRef
import com.alproutes.common.Bbox
import com.alproutes.common.Cursor
import com.alproutes.common.GeoJsonPoint
import com.alproutes.common.LonLat
import com.alproutes.common.Page
import com.alproutes.common.doubleOrNull
import com.alproutes.common.fieldError
import com.alproutes.common.geo
import com.alproutes.common.intOrNull
import com.alproutes.common.likePattern
import com.alproutes.common.localized
import com.alproutes.common.odt
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.wireOf
import com.alproutes.grades.GradeRepository
import com.alproutes.photos.PhotoRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import java.util.UUID

enum class RouteSort(val wire: String) {
    NAME("name"), GRADE("grade"), UPDATED("updated"), DISTANCE("distance"), RELEVANCE("relevance"), ELEVATION_GAIN("elevation_gain")
}

data class RouteQuery(
    val bbox: Bbox?,
    val near: LonLat?,
    val radiusM: Int?,
    val areaId: UUID?,
    val includeSubareas: Boolean,
    val q: String?,
    val gradeSystem: String?,
    val gradeMin: String?,
    val gradeMax: String?,
    val routeType: RouteType?,
    val gradeValues: List<String>? = null,
    val hasTrack: Boolean? = null,
    val hasDocument: Boolean? = null,
    val sort: RouteSort?,
    val cursor: String?,
    val limit: Int,
)

// Public materials only: what an anonymous visitor would actually get.
private const val HAS_TRACK =
    "EXISTS (SELECT 1 FROM tracks t WHERE t.route_id = r.id AND t.deleted_at IS NULL AND t.visibility = 'visible' AND t.processing_status = 'ready')"
private const val HAS_DOCUMENT =
    "EXISTS (SELECT 1 FROM documents d WHERE d.route_id = r.id AND d.deleted_at IS NULL AND d.visibility = 'visible')"

/**
 * Catalog search over published routes. Geo filters run in PostGIS on route_geo (the geometry
 * cache of current revisions): bbox against all features, radius against the anchor point.
 */
@Repository
class RouteSearch(
    private val jdbc: NamedParameterJdbcTemplate,
    private val grades: GradeRepository,
    private val routes: RouteRepository,
    private val photos: PhotoRepository,
    private val mapper: ObjectMapper,
) {
    private data class SortSpec(val expr: String, val sqlType: String, val descending: Boolean)

    private data class Row(val summary: RouteSummary, val revisionId: UUID, val sortKey: String)

    /** Which filter a facet ignores: a facet counts as if its own filter were not set. */
    private enum class Facet { GRADES, AREAS, MATERIALS }

    /** WHERE parts, joins and CTE of the catalogue filters; shared by search and facets. */
    private data class Filters(val cte: String, val geoJoin: String, val where: List<String>)

    private data class ResolvedGrades(val min: Int?, val max: Int?)

    private fun validate(q: RouteQuery): ResolvedGrades {
        if (q.near != null && q.radiusM == null) throw fieldError("radiusM", "Обязателен вместе с near")
        if (q.radiusM != null && q.near == null) throw fieldError("near", "Обязателен вместе с radiusM")
        q.radiusM?.let { if (it !in 1..200_000) throw fieldError("radiusM", "От 1 до 200000 м") }
        if ((q.gradeMin != null || q.gradeMax != null || !q.gradeValues.isNullOrEmpty()) && q.gradeSystem == null) {
            throw fieldError("gradeSystem", "Обязателен вместе с gradeMin/gradeMax/gradeValues")
        }
        if (q.gradeSystem != null && !grades.systemExists(q.gradeSystem)) throw fieldError("gradeSystem", "Неизвестная система категорий")
        q.gradeValues?.forEach { v ->
            if (grades.sortOrder(q.gradeSystem!!, v) == null) throw fieldError("gradeValues", "Нет значения «$v» в ${q.gradeSystem}")
        }
        val gradeMin = q.gradeMin?.let { grades.sortOrder(q.gradeSystem!!, it) ?: throw fieldError("gradeMin", "Нет такого значения в ${q.gradeSystem}") }
        val gradeMax = q.gradeMax?.let { grades.sortOrder(q.gradeSystem!!, it) ?: throw fieldError("gradeMax", "Нет такого значения в ${q.gradeSystem}") }
        return ResolvedGrades(gradeMin, gradeMax)
    }

    private fun filters(q: RouteQuery, g: ResolvedGrades, p: MapSqlParameterSource, exclude: Facet? = null): Filters {
        val where = mutableListOf("r.status = 'published'")
        val geoJoin = if (q.bbox != null || q.near != null) "JOIN route_geo g ON g.route_id = r.id" else "LEFT JOIN route_geo g ON g.route_id = r.id"
        if (q.bbox != null) {
            where += "g.geometry && ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)"
            where += "ST_Intersects(g.geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))"
            p.addValue("minLon", q.bbox.minLon).addValue("minLat", q.bbox.minLat)
                .addValue("maxLon", q.bbox.maxLon).addValue("maxLat", q.bbox.maxLat)
        }
        if (q.near != null) {
            p.addValue("nearLon", q.near.lon).addValue("nearLat", q.near.lat)
            where += "ST_DWithin(g.anchor_point::geography, ST_SetSRID(ST_MakePoint(:nearLon, :nearLat), 4326)::geography, :radius)"
            p.addValue("radius", q.radiusM!!.toDouble())
        }
        var cte = ""
        if (q.areaId != null && exclude != Facet.AREAS) {
            p.addValue("areaId", q.areaId)
            if (q.includeSubareas) {
                cte = """
                    WITH RECURSIVE sub (id) AS (
                        SELECT CAST(:areaId AS uuid)
                        UNION ALL
                        SELECT c.id FROM areas c JOIN sub ON c.parent_id = sub.id
                    )
                """.trimIndent()
                where += "rv.area_id IN (SELECT id FROM sub)"
            } else {
                where += "rv.area_id = :areaId"
            }
        }
        if (q.q != null) {
            where += "(rv.search_text ILIKE :qPattern ESCAPE '\\' OR rv.search_text % :qLower)"
            p.addValue("qPattern", likePattern(q.q.lowercase()))
        }
        // Bound even when q is absent: only referenced by the relevance sort, which requires q.
        p.addValue("qLower", q.q?.lowercase() ?: "")
        if (q.gradeSystem != null) p.addValue("gradeSystem", q.gradeSystem)
        if (exclude != Facet.GRADES) {
            // A grade filter works inside one system: routes without a grade in it never match.
            val conds = mutableListOf<String>()
            if (!q.gradeValues.isNullOrEmpty()) { conds += "gf.value IN (:gradeValues)"; p.addValue("gradeValues", q.gradeValues) }
            if (g.min != null) { conds += "gvf.sort_order >= :gradeMin"; p.addValue("gradeMin", g.min) }
            if (g.max != null) { conds += "gvf.sort_order <= :gradeMax"; p.addValue("gradeMax", g.max) }
            if (conds.isNotEmpty()) {
                where += """
                    EXISTS (SELECT 1 FROM route_revision_grades gf
                              JOIN grade_values gvf ON gvf.system_code = gf.system_code AND gvf.value = gf.value
                             WHERE gf.revision_id = rv.id AND gf.system_code = :gradeSystem AND ${conds.joinToString(" AND ")})
                """.trimIndent()
            }
        }
        if (q.routeType != null) { where += "rv.route_type = :routeType"; p.addValue("routeType", q.routeType.wire) }
        if (exclude != Facet.MATERIALS) {
            q.hasTrack?.let { where += (if (it) "" else "NOT ") + HAS_TRACK }
            q.hasDocument?.let { where += (if (it) "" else "NOT ") + HAS_DOCUMENT }
        }
        return Filters(cte, geoJoin, where)
    }

    /** Filtered routes as a subquery: id, current revision, area. */
    private fun filteredSql(f: Filters) = """
        (${f.cte}
         SELECT r.id, rv.id AS revision_id, rv.area_id
           FROM routes r
           JOIN route_revisions rv ON rv.route_id = r.id AND rv.is_current
           ${f.geoJoin}
          WHERE ${f.where.joinToString("\n AND ")})
    """.trimIndent()

    fun search(q: RouteQuery): Page<RouteSummary> {
        val g = validate(q)
        val sort = q.sort ?: when {
            q.near != null -> RouteSort.DISTANCE
            q.q != null -> RouteSort.RELEVANCE
            else -> RouteSort.NAME
        }
        if (sort == RouteSort.DISTANCE && q.near == null) throw fieldError("sort", "Сортировка distance требует near")
        if (sort == RouteSort.RELEVANCE && q.q == null) throw fieldError("sort", "Сортировка relevance требует q")
        if (sort == RouteSort.GRADE && q.gradeSystem == null) throw fieldError("sort", "Сортировка grade требует gradeSystem")

        val p = MapSqlParameterSource()
        val f = filters(q, g, p)
        val cte = f.cte
        val geoJoin = f.geoJoin
        val where = f.where
        val distanceExpr = if (q.near != null) {
            "ST_Distance(g.anchor_point::geography, ST_SetSRID(ST_MakePoint(:nearLon, :nearLat), 4326)::geography)"
        } else null

        val spec = when (sort) {
            RouteSort.NAME -> SortSpec("lower(COALESCE(rv.name->>'ru', rv.name->>'en', rv.search_text))", "text", false)
            RouteSort.UPDATED -> SortSpec("r.updated_at", "timestamptz", true)
            RouteSort.DISTANCE -> SortSpec(distanceExpr!!, "float8", false)
            // similarity() returns real; cast so the cursor's text form round-trips exactly.
            RouteSort.RELEVANCE -> SortSpec("CAST(similarity(rv.search_text, :qLower) AS float8)", "float8", true)
            // Routes without a grade in the system go last instead of disappearing from the list.
            RouteSort.GRADE -> SortSpec("COALESCE(gv.sort_order, 2147483647)", "integer", false)
            // "No data" goes last, never treated as zero gain.
            RouteSort.ELEVATION_GAIN -> SortSpec("COALESCE(rv.elevation_gain_m, -1)", "integer", true)
        }

        // Sorting by grade needs the grade of each route in the chosen system, if it has one.
        val gradeJoin = if (sort == RouteSort.GRADE) {
            """
            LEFT JOIN route_revision_grades gr ON gr.revision_id = rv.id AND gr.system_code = :gradeSystem
            LEFT JOIN grade_values gv ON gv.system_code = gr.system_code AND gv.value = gr.value
            """.trimIndent()
        } else ""

        val cmp = if (spec.descending) "<" else ">"
        val dir = if (spec.descending) "DESC" else "ASC"
        val cursorCond = Cursor.decode(q.cursor, 2)?.let { (key, id) ->
            p.addValue("cKey", key).addValue("cId", Cursor.uuid(id))
            "WHERE (s.sort_key, s.id) $cmp (CAST(:cKey AS ${spec.sqlType}), CAST(:cId AS uuid))"
        } ?: ""
        p.addValue("limit", q.limit + 1)

        val sql = """
            $cte
            SELECT * FROM (
                SELECT r.id, r.slug, r.status, r.updated_at,
                       rv.id AS revision_id, rv.name::text AS name, rv.route_type, rv.elevation_gain_m, rv.length_m,
                       a.id AS area_id, a.slug AS area_slug, a.type AS area_type, a.name::text AS area_name,
                       ST_AsGeoJSON(g.anchor_point) AS anchor,
                       (SELECT p.id FROM route_revision_photos rp JOIN photos p ON p.id = rp.photo_id
                         WHERE rp.revision_id = rv.id AND p.deleted_at IS NULL AND p.visibility = 'visible'
                           AND p.processing_status = 'ready'
                         ORDER BY rp.position LIMIT 1) AS cover_photo_id,
                       ${distanceExpr ?: "CAST(NULL AS float8)"} AS distance_m,
                       ${spec.expr} AS sort_key,
                       (${spec.expr})::text AS sort_key_text
                  FROM routes r
                  JOIN route_revisions rv ON rv.route_id = r.id AND rv.is_current
                  JOIN areas a ON a.id = rv.area_id
                  $geoJoin
                  $gradeJoin
                 WHERE ${where.joinToString("\n   AND ")}
            ) s
            $cursorCond
            ORDER BY s.sort_key $dir, s.id $dir
            LIMIT :limit
        """.trimIndent()

        val rows = jdbc.query(sql, p) { rs, _ ->
            Row(
                RouteSummary(
                    id = rs.uuid("id"),
                    slug = rs.getString("slug"),
                    status = wireOf(rs.getString("status")),
                    name = mapper.localized(rs.getString("name"))!!,
                    area = AreaRef(rs.uuid("area_id"), rs.getString("area_slug"), wireOf(rs.getString("area_type")),
                        mapper.localized(rs.getString("area_name"))!!),
                    grades = emptyList(),
                    routeType = rs.getString("route_type")?.let { wireOf<RouteType>(it) },
                    elevationGainM = rs.intOrNull("elevation_gain_m"),
                    lengthM = rs.intOrNull("length_m"),
                    anchorPoint = mapper.geo(rs.getString("anchor")),
                    distanceM = rs.doubleOrNull("distance_m"),
                    coverPhotoUrl = rs.uuidOrNull("cover_photo_id")?.let { photos.urls(it).thumbnail },
                    updatedAt = rs.odt("updated_at"),
                ),
                rs.uuid("revision_id"),
                rs.getString("sort_key_text"),
            )
        }
        val gradesByRevision = routes.gradesOf(rows.map { it.revisionId })
        return toPage(rows, q.limit, cursorOf = { listOf(it.sortKey, it.summary.id.toString()) }) {
            it.summary.copy(grades = gradesByRevision[it.revisionId].orEmpty())
        }
    }

    /**
     * Counts for the catalogue filters under the same query. Each facet ignores its own filter
     * (grade values, area, materials), so every option shows how many routes it would give.
     * [areaParentId]: the area facet lists its children (top-level areas when null), each counted with subareas.
     */
    fun facets(q: RouteQuery, areaParentId: UUID?): RouteFacets {
        val g = validate(q)

        fun count(exclude: Facet?): Pair<String, MapSqlParameterSource> {
            val p = MapSqlParameterSource()
            return filteredSql(filters(q, g, p, exclude)) to p
        }

        val (all, pAll) = count(null)
        val total = jdbc.queryForObject("SELECT count(*) FROM $all f", pAll, Int::class.java) ?: 0

        val (byGrade, pGrade) = count(Facet.GRADES)
        val gradeCounts = jdbc.query(
            """
            SELECT gr.system_code, gr.value, count(DISTINCT f.id) AS n
              FROM $byGrade f
              JOIN route_revision_grades gr ON gr.revision_id = f.revision_id
              JOIN grade_systems s ON s.code = gr.system_code
              JOIN grade_values gv ON gv.system_code = gr.system_code AND gv.value = gr.value
             GROUP BY gr.system_code, gr.value, s.sort_order, gv.sort_order
             ORDER BY s.sort_order, gv.sort_order
            """.trimIndent(),
            pGrade,
        ) { rs, _ -> GradeCount(rs.getString("system_code"), rs.getString("value"), rs.getInt("n")) }

        val (byArea, pArea) = count(Facet.AREAS)
        pArea.addValue("areaParent", areaParentId, java.sql.Types.OTHER)
        val areaCounts = jdbc.query(
            """
            WITH RECURSIVE tree (root, id) AS (
                SELECT a.id, a.id FROM areas a
                 WHERE a.status = 'published'
                   AND (CAST(:areaParent AS uuid) IS NULL AND a.parent_id IS NULL OR a.parent_id = CAST(:areaParent AS uuid))
                UNION ALL
                SELECT t.root, c.id FROM areas c JOIN tree t ON c.parent_id = t.id WHERE c.status = 'published'
            ),
            counts AS (
                SELECT t.root, count(DISTINCT f.id) AS n FROM tree t JOIN $byArea f ON f.area_id = t.id GROUP BY t.root
            )
            SELECT a.id, a.slug, a.type, a.name::text AS name, COALESCE(c.n, 0) AS n
              FROM areas a LEFT JOIN counts c ON c.root = a.id
             WHERE a.id IN (SELECT root FROM tree)
             ORDER BY lower(COALESCE(a.name->>'ru', a.name->>'en')), a.id
            """.trimIndent(),
            pArea,
        ) { rs, _ ->
            AreaCount(AreaRef(rs.uuid("id"), rs.getString("slug"), wireOf(rs.getString("type")), mapper.localized(rs.getString("name"))!!), rs.getInt("n"))
        }

        val (byMaterial, pMaterial) = count(Facet.MATERIALS)
        val materials = jdbc.queryForObject(
            """
            SELECT count(*) FILTER (WHERE ${HAS_TRACK.replace("r.id", "f.id")}) AS tracks,
                   count(*) FILTER (WHERE ${HAS_DOCUMENT.replace("r.id", "f.id")}) AS documents
              FROM $byMaterial f
            """.trimIndent(),
            pMaterial,
        ) { rs, _ -> MaterialCounts(rs.getInt("tracks"), rs.getInt("documents")) }!!

        return RouteFacets(total, gradeCounts, areaCounts, materials)
    }

    /** Markers for the map: published routes with geometry inside the bbox, keyset by id. */
    fun mapPoints(bbox: Bbox, cursor: String?, limit: Int): Page<RouteMapPoint> {
        val p = MapSqlParameterSource()
            .addValue("minLon", bbox.minLon).addValue("minLat", bbox.minLat)
            .addValue("maxLon", bbox.maxLon).addValue("maxLat", bbox.maxLat)
            .addValue("limit", limit + 1)
        val after = Cursor.decode(cursor, 1)?.let { p.addValue("after", Cursor.uuid(it[0])); "AND r.id > :after" } ?: ""
        val rows = jdbc.query(
            """
            SELECT r.id, r.slug, rv.id AS revision_id, rv.name::text AS name, ST_AsGeoJSON(g.anchor_point) AS anchor
              FROM route_geo g
              JOIN routes r ON r.id = g.route_id
              JOIN route_revisions rv ON rv.id = g.revision_id
             WHERE r.status = 'published'
               AND g.geometry && ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)
               AND ST_Intersects(g.geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))
               $after
             ORDER BY r.id
             LIMIT :limit
            """.trimIndent(),
            p,
        ) { rs, _ ->
            RouteMapPoint(rs.uuid("id"), rs.getString("slug"), mapper.localized(rs.getString("name"))!!,
                mapper.geo<GeoJsonPoint>(rs.getString("anchor"))!!, emptyList()) to rs.uuid("revision_id")
        }
        val gradesByRevision = routes.gradesOf(rows.map { it.second })
        return toPage(rows, limit, cursorOf = { listOf(it.first.id.toString()) }) {
            it.first.copy(grades = gradesByRevision[it.second].orEmpty())
        }
    }
}
