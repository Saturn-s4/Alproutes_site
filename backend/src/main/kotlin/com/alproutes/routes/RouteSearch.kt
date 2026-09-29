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
import com.alproutes.common.wireOf
import com.alproutes.grades.GradeRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import java.util.UUID

enum class RouteSort(val wire: String) { NAME("name"), GRADE("grade"), UPDATED("updated"), DISTANCE("distance"), RELEVANCE("relevance") }

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
    val sort: RouteSort?,
    val cursor: String?,
    val limit: Int,
)

/**
 * Catalog search over published routes. Geo filters run in PostGIS on route_geo (the geometry
 * cache of current revisions): bbox against all features, radius against the anchor point.
 */
@Repository
class RouteSearch(
    private val jdbc: NamedParameterJdbcTemplate,
    private val grades: GradeRepository,
    private val routes: RouteRepository,
    private val mapper: ObjectMapper,
) {
    private data class SortSpec(val expr: String, val sqlType: String, val descending: Boolean)

    private data class Row(val summary: RouteSummary, val revisionId: UUID, val sortKey: String)

    fun search(q: RouteQuery): Page<RouteSummary> {
        if (q.near != null && q.radiusM == null) throw fieldError("radiusM", "Обязателен вместе с near")
        if (q.radiusM != null && q.near == null) throw fieldError("near", "Обязателен вместе с radiusM")
        q.radiusM?.let { if (it !in 1..200_000) throw fieldError("radiusM", "От 1 до 200000 м") }
        if ((q.gradeMin != null || q.gradeMax != null) && q.gradeSystem == null) {
            throw fieldError("gradeSystem", "Обязателен вместе с gradeMin/gradeMax")
        }
        val gradeMin = q.gradeMin?.let { grades.sortOrder(q.gradeSystem!!, it) ?: throw fieldError("gradeMin", "Нет такого значения в ${q.gradeSystem}") }
        val gradeMax = q.gradeMax?.let { grades.sortOrder(q.gradeSystem!!, it) ?: throw fieldError("gradeMax", "Нет такого значения в ${q.gradeSystem}") }
        if (q.gradeSystem != null && !grades.systemExists(q.gradeSystem)) throw fieldError("gradeSystem", "Неизвестная система категорий")

        val sort = q.sort ?: when {
            q.near != null -> RouteSort.DISTANCE
            q.q != null -> RouteSort.RELEVANCE
            else -> RouteSort.NAME
        }
        if (sort == RouteSort.DISTANCE && q.near == null) throw fieldError("sort", "Сортировка distance требует near")
        if (sort == RouteSort.RELEVANCE && q.q == null) throw fieldError("sort", "Сортировка relevance требует q")
        if (sort == RouteSort.GRADE && q.gradeSystem == null) throw fieldError("sort", "Сортировка grade требует gradeSystem")

        val p = MapSqlParameterSource()
        val where = mutableListOf("r.status = 'published'")
        val distanceExpr = if (q.near != null) {
            p.addValue("nearLon", q.near.lon).addValue("nearLat", q.near.lat)
            "ST_Distance(g.anchor_point::geography, ST_SetSRID(ST_MakePoint(:nearLon, :nearLat), 4326)::geography)"
        } else null

        val spec = when (sort) {
            RouteSort.NAME -> SortSpec("lower(COALESCE(rv.name->>'ru', rv.name->>'en', rv.search_text))", "text", false)
            RouteSort.UPDATED -> SortSpec("r.updated_at", "timestamptz", true)
            RouteSort.DISTANCE -> SortSpec(distanceExpr!!, "float8", false)
            // similarity() returns real; cast so the cursor's text form round-trips exactly.
            RouteSort.RELEVANCE -> SortSpec("CAST(similarity(rv.search_text, :qLower) AS float8)", "float8", true)
            RouteSort.GRADE -> SortSpec("gv.sort_order", "integer", false)
        }

        val geoJoin = if (q.bbox != null || q.near != null) "JOIN route_geo g ON g.route_id = r.id" else "LEFT JOIN route_geo g ON g.route_id = r.id"
        val gradeJoin = if (q.gradeSystem != null) {
            p.addValue("gradeSystem", q.gradeSystem)
            """
            JOIN route_revision_grades gr ON gr.revision_id = rv.id AND gr.system_code = :gradeSystem
            JOIN grade_values gv ON gv.system_code = gr.system_code AND gv.value = gr.value
            """.trimIndent()
        } else ""

        if (q.bbox != null) {
            where += "g.geometry && ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)"
            where += "ST_Intersects(g.geometry, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))"
            p.addValue("minLon", q.bbox.minLon).addValue("minLat", q.bbox.minLat)
                .addValue("maxLon", q.bbox.maxLon).addValue("maxLat", q.bbox.maxLat)
        }
        if (q.near != null) {
            where += "ST_DWithin(g.anchor_point::geography, ST_SetSRID(ST_MakePoint(:nearLon, :nearLat), 4326)::geography, :radius)"
            p.addValue("radius", q.radiusM!!.toDouble())
        }
        var cte = ""
        if (q.areaId != null) {
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
        if (gradeMin != null) { where += "gv.sort_order >= :gradeMin"; p.addValue("gradeMin", gradeMin) }
        if (gradeMax != null) { where += "gv.sort_order <= :gradeMax"; p.addValue("gradeMax", gradeMax) }
        if (q.routeType != null) { where += "rv.route_type = :routeType"; p.addValue("routeType", q.routeType.wire) }

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
                    coverPhotoUrl = null,   // photos arrive with step 4
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
