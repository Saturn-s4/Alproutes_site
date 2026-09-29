package com.alproutes.areas

import com.alproutes.auth.Caller
import com.alproutes.common.Bbox
import com.alproutes.common.Cursor
import com.alproutes.common.GeoJsonMultiPolygon
import com.alproutes.common.GeoJsonPoint
import com.alproutes.common.LocalizedText
import com.alproutes.common.Page
import com.alproutes.common.Slugs
import com.alproutes.common.Validator
import com.alproutes.common.Wire
import com.alproutes.common.conflict
import com.alproutes.common.fieldError
import com.alproutes.common.forbidden
import com.alproutes.common.geo
import com.alproutes.common.intOrNull
import com.alproutes.common.likePattern
import com.alproutes.common.localized
import com.alproutes.common.multiPolygon
import com.alproutes.common.notFound
import com.alproutes.common.odt
import com.alproutes.common.pageLimit
import com.alproutes.common.params
import com.alproutes.common.parseWire
import com.alproutes.common.point
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.validate
import com.alproutes.common.wireOf
import com.alproutes.moderation.ModerationLog
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.annotation.JsonValue
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.sql.ResultSet
import java.time.OffsetDateTime
import java.util.UUID

enum class AreaType(@get:JsonValue override val wire: String) : Wire {
    MOUNTAIN_SYSTEM("mountain_system"), REGION("region"), RIDGE("ridge"), MASSIF("massif"), SUMMIT("summit"), OTHER("other")
}

enum class ContentStatus(@get:JsonValue override val wire: String) : Wire {
    DRAFT("draft"), PUBLISHED("published"), HIDDEN("hidden")
}

// ---- DTOs (contract: AreaRef, AreaSummary, Area, AreaCreate)

data class AreaRef(val id: UUID, val slug: String, val type: AreaType, val name: LocalizedText)

data class AreaSummary(
    val id: UUID,
    val slug: String,
    val type: AreaType,
    val name: LocalizedText,
    val parentId: UUID?,
    val center: GeoJsonPoint?,
    val elevationM: Int?,
    val status: ContentStatus,
    val childCount: Int,
    val routeCount: Int,
    val updatedAt: OffsetDateTime,
)

data class Area(
    val id: UUID,
    val slug: String,
    val type: AreaType,
    val name: LocalizedText,
    val parentId: UUID?,
    val center: GeoJsonPoint?,
    val elevationM: Int?,
    val status: ContentStatus,
    val childCount: Int,
    val routeCount: Int,
    val updatedAt: OffsetDateTime,
    val description: LocalizedText?,
    val boundary: GeoJsonMultiPolygon?,
    val ancestors: List<AreaRef>,
)

data class AreaCreate(
    val parentId: UUID? = null,
    val type: AreaType,
    val slug: String,
    val name: LocalizedText,
    val description: LocalizedText? = null,
    val center: GeoJsonPoint? = null,
    val elevationM: Int? = null,
    val boundary: GeoJsonMultiPolygon? = null,
    val status: ContentStatus? = null,
)

/** Every column an area write can set; used for both create and patch. */
internal data class AreaFields(
    val parentId: UUID?,
    val type: AreaType,
    val slug: String,
    val name: LocalizedText,
    val description: LocalizedText?,
    val center: GeoJsonPoint?,
    val elevationM: Int?,
    val boundary: GeoJsonMultiPolygon?,
    val status: ContentStatus,
)

@Repository
class AreaRepository(private val jdbc: NamedParameterJdbcTemplate, private val mapper: ObjectMapper) {

    /** Sort key: Russian name first, then English, then any translation. */
    private val sortName = "lower(COALESCE(a.name->>'ru', a.name->>'en', a.search_text))"

    private fun summaryColumns(includeHidden: Boolean) = """
        a.id, a.parent_id, a.type, a.slug, a.name::text AS name, a.status, a.elevation_m,
        ST_AsGeoJSON(a.center) AS center, a.updated_at,
        $sortName AS sort_name,
        (SELECT count(*) FROM areas c
          WHERE c.parent_id = a.id ${if (includeHidden) "" else "AND c.status = 'published'"}) AS child_count,
        (WITH RECURSIVE sub (id) AS (
             SELECT a.id
             UNION ALL
             SELECT c.id FROM areas c JOIN sub ON c.parent_id = sub.id
         )
         SELECT count(*) FROM route_revisions rv JOIN routes r ON r.id = rv.route_id
          WHERE rv.is_current AND r.status = 'published' AND rv.area_id IN (SELECT id FROM sub)) AS route_count
    """.trimIndent()

    private fun summary(rs: ResultSet) = AreaSummary(
        id = rs.uuid("id"),
        slug = rs.getString("slug"),
        type = wireOf(rs.getString("type")),
        name = mapper.localized(rs.getString("name"))!!,
        parentId = rs.uuidOrNull("parent_id"),
        center = mapper.geo(rs.getString("center")),
        elevationM = rs.intOrNull("elevation_m"),
        status = wireOf(rs.getString("status")),
        childCount = rs.getInt("child_count"),
        routeCount = rs.getInt("route_count"),
        updatedAt = rs.odt("updated_at"),
    )

    fun list(
        parentId: UUID?, type: AreaType?, q: String?, bbox: Bbox?, includeHidden: Boolean, cursor: String?, limit: Int,
    ): Page<AreaSummary> {
        val where = mutableListOf<String>()
        val p = MapSqlParameterSource()
        if (!includeHidden) where += "a.status = 'published'"
        if (parentId != null) { where += "a.parent_id = :parentId"; p.addValue("parentId", parentId) }
        if (type != null) { where += "a.type = :type"; p.addValue("type", type.wire) }
        if (q != null) { where += "a.search_text ILIKE :q ESCAPE '\\'"; p.addValue("q", likePattern(q.lowercase())) }
        if (bbox != null) {
            where += """(a.center && ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326)
                         OR a.boundary && ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))"""
            p.addValue("minLon", bbox.minLon).addValue("minLat", bbox.minLat)
                .addValue("maxLon", bbox.maxLon).addValue("maxLat", bbox.maxLat)
        }
        // No filter at all -> the top of the hierarchy.
        if (parentId == null && type == null && q == null && bbox == null) where += "a.parent_id IS NULL"
        Cursor.decode(cursor, 2)?.let { (name, id) ->
            where += "($sortName, a.id) > (CAST(:cName AS text), CAST(:cId AS uuid))"
            p.addValue("cName", name).addValue("cId", Cursor.uuid(id))
        }
        p.addValue("limit", limit + 1)
        val sql = """
            SELECT ${summaryColumns(includeHidden)}
              FROM areas a
             WHERE ${where.joinToString(" AND ")}
             ORDER BY $sortName, a.id
             LIMIT :limit
        """.trimIndent()
        val rows = jdbc.query(sql, p) { rs, _ -> summary(rs) to rs.getString("sort_name") }
        return toPage(rows, limit, cursorOf = { listOf(it.second, it.first.id.toString()) }) { it.first }
    }

    fun find(id: UUID?, slug: String?, includeHidden: Boolean): Area? {
        val cond = if (id != null) "a.id = :id" else "a.slug = :slug"
        val rows = jdbc.query(
            """
            SELECT ${summaryColumns(includeHidden)}, a.description::text AS description, ST_AsGeoJSON(a.boundary) AS boundary
              FROM areas a
             WHERE $cond
            """.trimIndent(),
            params { uuid("id", id); str("slug", slug) },
        ) { rs, _ -> Triple(summary(rs), rs.getString("description"), rs.getString("boundary")) }
        val (s, description, boundary) = rows.firstOrNull() ?: return null
        if (!includeHidden && s.status != ContentStatus.PUBLISHED) return null
        return Area(
            s.id, s.slug, s.type, s.name, s.parentId, s.center, s.elevationM, s.status, s.childCount, s.routeCount,
            s.updatedAt, mapper.localized(description), mapper.geo(boundary), ancestors(s.id, includeSelf = false),
        )
    }

    /** Breadcrumbs from the root down to the parent (or to the area itself). */
    fun ancestors(id: UUID, includeSelf: Boolean): List<AreaRef> = jdbc.query(
        """
        WITH RECURSIVE up (id, parent_id, depth) AS (
            SELECT id, parent_id, 0 FROM areas WHERE id = :id
            UNION ALL
            SELECT a.id, a.parent_id, up.depth + 1 FROM areas a JOIN up ON a.id = up.parent_id
        )
        SELECT a.id, a.slug, a.type, a.name::text AS name
          FROM up JOIN areas a ON a.id = up.id
         WHERE up.depth >= :minDepth
         ORDER BY up.depth DESC
        """.trimIndent(),
        params { uuid("id", id); int("minDepth", if (includeSelf) 0 else 1) },
    ) { rs, _ -> AreaRef(rs.uuid("id"), rs.getString("slug"), wireOf(rs.getString("type")), mapper.localized(rs.getString("name"))!!) }

    fun exists(id: UUID): Boolean = jdbc.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM areas WHERE id = :id)", params { uuid("id", id) }, Boolean::class.java,
    ) == true

    fun slugTaken(slug: String, exceptId: UUID?): Boolean = jdbc.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM areas WHERE slug = :slug AND id IS DISTINCT FROM CAST(:except AS uuid))",
        params { str("slug", slug); uuid("except", exceptId) },
        Boolean::class.java,
    ) == true

    internal fun insert(id: UUID, f: AreaFieldsSql, createdBy: UUID) {
        jdbc.update(
            """
            INSERT INTO areas (id, parent_id, type, slug, name, description, center, elevation_m, boundary, status, created_by)
            VALUES (:id, CAST(:parentId AS uuid), :type, :slug, CAST(:name AS jsonb), CAST(:description AS jsonb),
                    ST_SetSRID(ST_GeomFromGeoJSON(CAST(:center AS text)), 4326), CAST(:elevation AS integer),
                    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(CAST(:boundary AS text)), 4326)), :status, :createdBy)
            """.trimIndent(),
            f.params.addValue("id", id).addValue("createdBy", createdBy),
        )
    }

    internal fun update(id: UUID, f: AreaFieldsSql) {
        jdbc.update(
            """
            UPDATE areas
               SET parent_id = CAST(:parentId AS uuid), type = :type, slug = :slug,
                   name = CAST(:name AS jsonb), description = CAST(:description AS jsonb),
                   center = ST_SetSRID(ST_GeomFromGeoJSON(CAST(:center AS text)), 4326),
                   elevation_m = CAST(:elevation AS integer),
                   boundary = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(CAST(:boundary AS text)), 4326)),
                   status = :status
             WHERE id = :id
            """.trimIndent(),
            f.params.addValue("id", id),
        )
    }
}

/** Bound SQL parameters of [AreaFields]; built by the service which owns JSON serialization. */
internal class AreaFieldsSql(val params: MapSqlParameterSource)

@Service
class AreaService(
    private val areas: AreaRepository,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val mapper: ObjectMapper,
) {
    fun list(parentId: UUID?, type: String?, q: String?, bbox: String?, cursor: String?, limit: Int?): Page<AreaSummary> {
        val caller = Caller.currentOrNull()
        val query = q?.trim()?.takeIf { it.isNotEmpty() }
        if (query != null && query.length < 2) throw fieldError("q", "Минимум 2 символа")
        return areas.list(
            parentId = parentId,
            type = type?.let { parseWire<AreaType>(it, "type") },
            q = query,
            bbox = bbox?.let { Bbox.parse(it) },
            includeHidden = caller?.isModerator == true,
            cursor = cursor,
            limit = pageLimit(limit),
        )
    }

    fun get(id: UUID?, slug: String?): Area =
        areas.find(id, slug, includeHidden = Caller.currentOrNull()?.isModerator == true) ?: throw notFound("Район не найден")

    @Transactional
    fun create(req: AreaCreate): Area {
        val caller = requireModerator()
        val fields = AreaFields(
            req.parentId, req.type, req.slug, req.name, req.description, req.center, req.elevationM, req.boundary,
            req.status ?: ContentStatus.DRAFT,
        )
        validateFields(fields, selfId = null)
        val id = UUID.randomUUID()
        areas.insert(id, toSql(fields), caller.userId)
        log.record(caller.userId, "create_area", "area", id)
        return areas.find(id, null, includeHidden = true)!!
    }

    /** PATCH: only present keys change; an explicit null clears a nullable field. */
    @Transactional
    fun update(id: UUID, body: JsonNode): Area {
        val caller = requireModerator()
        if (body !is ObjectNode) throw fieldError("body", "Ожидается объект")
        val current = areas.find(id, null, includeHidden = true) ?: throw notFound("Район не найден")
        val allowed = setOf("parentId", "type", "slug", "name", "description", "center", "elevationM", "boundary", "status")
        body.fieldNames().asSequence().firstOrNull { it !in allowed }?.let { throw fieldError(it, "Неизвестное поле") }

        fun <T> field(name: String, type: Class<T>, currentValue: T?): T? {
            if (!body.has(name)) return currentValue
            val node = body.get(name)
            if (node.isNull) return null
            return try {
                mapper.treeToValue(node, type)
            } catch (e: Exception) {
                throw fieldError(name, "Неверный формат")
            }
        }
        @Suppress("UNCHECKED_CAST")
        val fields = AreaFields(
            parentId = field("parentId", UUID::class.java, current.parentId),
            type = field("type", AreaType::class.java, current.type) ?: throw fieldError("type", "Обязательное поле"),
            slug = field("slug", String::class.java, current.slug) ?: throw fieldError("slug", "Обязательное поле"),
            name = (field("name", Map::class.java, current.name) as LocalizedText?) ?: throw fieldError("name", "Обязательное поле"),
            description = field("description", Map::class.java, current.description) as LocalizedText?,
            center = field("center", GeoJsonPoint::class.java, current.center),
            elevationM = field("elevationM", Int::class.javaObjectType, current.elevationM),
            boundary = field("boundary", GeoJsonMultiPolygon::class.java, current.boundary),
            status = field("status", ContentStatus::class.java, current.status) ?: throw fieldError("status", "Обязательное поле"),
        )
        validateFields(fields, selfId = id)
        areas.update(id, toSql(fields))
        log.record(caller.userId, "update_area", "area", id, details = mapOf("fields" to body.fieldNames().asSequence().toList()))
        return areas.find(id, null, includeHidden = true)!!
    }

    private fun requireModerator(): Caller {
        val caller = Caller.current()
        if (!caller.isModerator) throw forbidden("Районы редактируют модераторы")
        users.requireActive(caller.userId)
        return caller
    }

    private fun validateFields(f: AreaFields, selfId: UUID?) {
        validate {
            check(Slugs.PATTERN.matches(f.slug) && f.slug.length <= Slugs.MAX_LENGTH, "slug",
                "Строчные латинские буквы, цифры и дефисы, до ${Slugs.MAX_LENGTH} символов")
            localized(f.name, "name", required = true, maxLength = 200)
            localized(f.description, "description", required = false, maxLength = 100_000)
            f.center?.let { point(it, "center") }
            f.boundary?.let { multiPolygon(it, "boundary") }
            f.elevationM?.let { check(it in -500..9000, "elevationM", "От -500 до 9000") }
            check(f.elevationM == null || f.type == AreaType.SUMMIT, "elevationM", "Высота указывается только для вершин")
            f.parentId?.let {
                check(it != selfId, "parentId", "Район не может быть своим родителем")
                check(areas.exists(it), "parentId", "Родительский район не найден")
            }
        }
        if (areas.slugTaken(f.slug, selfId)) throw conflict("slug-taken", "Slug «${f.slug}» уже занят")
    }

    private fun toSql(f: AreaFields) = AreaFieldsSql(
        params {
            uuid("parentId", f.parentId); str("type", f.type.wire); str("slug", f.slug)
            str("name", mapper.writeValueAsString(f.name))
            str("description", f.description?.let { mapper.writeValueAsString(it) })
            str("center", f.center?.let { mapper.writeValueAsString(it) })
            int("elevation", f.elevationM)
            str("boundary", f.boundary?.let { mapper.writeValueAsString(it) })
            str("status", f.status.wire)
        },
    )
}

@RestController
class AreaController(private val service: AreaService) {

    @GetMapping("/areas")
    fun list(
        @RequestParam(required = false) parentId: UUID?,
        @RequestParam(required = false) type: String?,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) bbox: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.list(parentId, type, q, bbox, cursor, limit)

    @GetMapping("/areas/{areaId}")
    fun get(@PathVariable areaId: UUID) = service.get(areaId, null)

    @GetMapping("/areas/by-slug/{slug}")
    fun bySlug(@PathVariable slug: String) = service.get(null, slug)

    @PostMapping("/areas")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody body: AreaCreate) = service.create(body)

    @PatchMapping("/areas/{areaId}")
    fun update(@PathVariable areaId: UUID, @RequestBody body: JsonNode) = service.update(areaId, body)
}
