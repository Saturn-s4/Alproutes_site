package com.alproutes.photos

import com.alproutes.auth.Caller
import com.alproutes.common.Cursor
import com.alproutes.common.GeoJsonPoint
import com.alproutes.common.Page
import com.alproutes.common.Wire
import com.alproutes.common.conflict
import com.alproutes.common.doubleOrNull
import com.alproutes.common.fieldError
import com.alproutes.common.forbidden
import com.alproutes.common.intOrNull
import com.alproutes.common.notFound
import com.alproutes.common.odt
import com.alproutes.common.odtOrNull
import com.alproutes.common.params
import com.alproutes.common.parseWire
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.validate
import com.alproutes.common.wireOf
import com.alproutes.media.MediaStorage
import com.alproutes.moderation.ModerationLog
import com.alproutes.uploads.UploadService
import com.alproutes.users.UserPublic
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonValue
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.context.ApplicationEventPublisher
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
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

// ------------------------------------------------------------------- DTOs (contract: Photo*)

enum class PhotoKind(@get:JsonValue override val wire: String) : Wire {
    OVERVIEW("overview"), TOPO("topo"), DETAIL("detail")
}

enum class ProcessingStatus(@get:JsonValue override val wire: String) : Wire {
    PROCESSING("processing"), READY("ready"), FAILED("failed")
}

data class PhotoUrls(val thumbnail: String, val medium: String, val full: String)

data class TopoLine(
    val id: UUID,
    val photoId: UUID,
    val routeId: UUID,
    val version: Int,
    val baseVersionId: UUID?,
    val status: String,
    @get:JsonProperty("isCurrent")
    val isCurrent: Boolean,
    val drawing: JsonNode,
    val author: UserPublic,
    val createdAt: OffsetDateTime,
    val reviewedAt: OffsetDateTime?,
    val reviewNote: String?,
)

data class Photo(
    val id: UUID,
    val routeId: UUID?,
    val areaId: UUID?,
    val ascentId: UUID?,
    val author: UserPublic,
    val kind: PhotoKind,
    val widthPx: Int?,
    val heightPx: Int?,
    val takenAt: OffsetDateTime?,
    val location: GeoJsonPoint?,
    val caption: String?,
    val captionLanguage: String?,
    val processingStatus: ProcessingStatus,
    val urls: PhotoUrls?,
    val topoLines: List<TopoLine>,
    val createdAt: OffsetDateTime,
    val updatedAt: OffsetDateTime,
)

data class PhotoCreate(
    val id: UUID,
    val uploadId: UUID,
    val kind: String,
    val ascentId: UUID? = null,
    val caption: String? = null,
    val captionLanguage: String? = null,
)

/** Derivative sizes: longest side in pixels. Never upscaled. */
enum class PhotoSize(val key: String, val maxSide: Int) {
    THUMBNAIL("thumbnail", 400), MEDIUM("medium", 1280), FULL("full", 2560);

    fun storageKey(photoId: UUID) = "photos/$photoId/$key.jpg"
}

// ------------------------------------------------------------------- repository

internal data class PhotoRow(val photo: Photo, val authorId: UUID, val deleted: Boolean, val visible: Boolean, val createdAtText: String)

@Repository
class PhotoRepository(
    private val jdbc: NamedParameterJdbcTemplate,
    private val mapper: ObjectMapper,
    private val storage: MediaStorage,
) {
    private val columns = """
        p.id, p.route_id, p.area_id, p.ascent_id, p.kind, p.width_px, p.height_px, p.taken_at,
        ST_X(p.location) AS lon, ST_Y(p.location) AS lat, p.caption, p.caption_language, p.processing_status,
        p.visibility, p.deleted_at IS NOT NULL AS deleted, p.created_at, p.created_at::text AS created_at_text, p.updated_at,
        u.id AS author_id, u.display_name AS author_name
    """.trimIndent()

    private val from = "FROM photos p JOIN users u ON u.id = p.author_id"

    private fun row(rs: ResultSet): PhotoRow {
        val id = rs.uuid("id")
        val status = wireOf<ProcessingStatus>(rs.getString("processing_status"))
        val lon = rs.doubleOrNull("lon")
        val lat = rs.doubleOrNull("lat")
        val photo = Photo(
            id = id,
            routeId = rs.uuidOrNull("route_id"),
            areaId = rs.uuidOrNull("area_id"),
            ascentId = rs.uuidOrNull("ascent_id"),
            author = UserPublic(rs.uuid("author_id"), rs.getString("author_name"), null),
            kind = wireOf(rs.getString("kind")),
            widthPx = rs.intOrNull("width_px"),
            heightPx = rs.intOrNull("height_px"),
            takenAt = rs.odtOrNull("taken_at"),
            location = if (lon != null && lat != null) GeoJsonPoint("Point", listOf(lon, lat)) else null,
            caption = rs.getString("caption"),
            captionLanguage = rs.getString("caption_language"),
            processingStatus = status,
            urls = if (status == ProcessingStatus.READY) urls(id) else null,
            topoLines = emptyList(),
            createdAt = rs.odt("created_at"),
            updatedAt = rs.odt("updated_at"),
        )
        return PhotoRow(photo, rs.uuid("author_id"), rs.getBoolean("deleted"), rs.getString("visibility") == "visible",
            rs.getString("created_at_text"))
    }

    fun urls(id: UUID) = PhotoUrls(
        thumbnail = storage.publicUrl(PhotoSize.THUMBNAIL.storageKey(id)),
        medium = storage.publicUrl(PhotoSize.MEDIUM.storageKey(id)),
        full = storage.publicUrl(PhotoSize.FULL.storageKey(id)),
    )

    internal fun find(id: UUID): PhotoRow? =
        jdbc.query("SELECT $columns $from WHERE p.id = :id", params { uuid("id", id) }) { rs, _ -> row(rs) }.firstOrNull()

    /**
     * Photos of a route, newest first. Others' photos only when ready; the caller's own in any status;
     * hidden ones only for moderators. [inDescription] splits by the current published revision.
     */
    internal fun listForRoute(
        routeId: UUID, kind: PhotoKind?, inDescription: Boolean?, callerId: UUID?, moderator: Boolean,
        after: Pair<String, UUID>?, limit: Int,
    ): List<PhotoRow> {
        val where = mutableListOf("p.route_id = :routeId", "p.deleted_at IS NULL")
        where += if (callerId != null) "(p.processing_status = 'ready' OR p.author_id = :caller)" else "p.processing_status = 'ready'"
        if (!moderator) where += "p.visibility = 'visible'"
        if (kind != null) where += "p.kind = :kind"
        if (inDescription != null) {
            val exists = """
                EXISTS (SELECT 1 FROM route_revision_photos rp
                          JOIN route_revisions rv ON rv.id = rp.revision_id AND rv.is_current
                         WHERE rp.photo_id = p.id)
            """.trimIndent()
            where += if (inDescription) exists else "NOT $exists"
        }
        if (after != null) where += "(p.created_at, p.id) < (CAST(:afterCreated AS timestamptz), CAST(:afterId AS uuid))"
        return jdbc.query(
            "SELECT $columns $from WHERE ${where.joinToString(" AND ")} ORDER BY p.created_at DESC, p.id DESC LIMIT :limit",
            params {
                uuid("routeId", routeId); uuid("caller", callerId); str("kind", kind?.wire)
                str("afterCreated", after?.first); uuid("afterId", after?.second); int("limit", limit + 1)
            },
        ) { rs, _ -> row(rs) }
    }

    /** Ready, visible, not deleted photos among [ids], in the order of [ids] (description order). */
    fun publicByIds(ids: List<UUID>): List<Photo> {
        if (ids.isEmpty()) return emptyList()
        val found = jdbc.query(
            """
            SELECT $columns $from
             WHERE p.id IN (:ids) AND p.deleted_at IS NULL AND p.visibility = 'visible' AND p.processing_status = 'ready'
            """.trimIndent(),
            params { uuids("ids", ids) },
        ) { rs, _ -> row(rs).photo }.associateBy { it.id }
        return withTopoLines(ids.mapNotNull { found[it] })
    }

    /** Current (approved) topo lines of the given photos. */
    fun withTopoLines(photos: List<Photo>): List<Photo> {
        if (photos.isEmpty()) return photos
        val lines = jdbc.query(
            """
            SELECT t.id, t.photo_id, t.route_id, t.version, t.base_version_id, t.status, t.is_current, t.drawing::text AS drawing,
                   t.created_at, t.reviewed_at, t.review_note, u.id AS author_id, u.display_name AS author_name
              FROM topo_lines t JOIN users u ON u.id = t.author_id
             WHERE t.photo_id IN (:ids) AND t.is_current
            """.trimIndent(),
            params { uuids("ids", photos.map { it.id }) },
        ) { rs, _ ->
            TopoLine(
                rs.uuid("id"), rs.uuid("photo_id"), rs.uuid("route_id"), rs.getInt("version"), rs.uuidOrNull("base_version_id"),
                rs.getString("status"), rs.getBoolean("is_current"), mapper.readTree(rs.getString("drawing")),
                UserPublic(rs.uuid("author_id"), rs.getString("author_name"), null),
                rs.odt("created_at"), rs.odtOrNull("reviewed_at"), rs.getString("review_note"),
            )
        }.groupBy { it.photoId }
        return photos.map { it.copy(topoLines = lines[it.id].orEmpty()) }
    }

    fun insert(id: UUID, routeId: UUID?, ascentId: UUID?, authorId: UUID, kind: PhotoKind, storageKey: String,
               contentType: String, caption: String?, captionLanguage: String?) {
        jdbc.update(
            """
            INSERT INTO photos (id, route_id, ascent_id, author_id, kind, storage_key, content_type, caption, caption_language)
            VALUES (:id, :routeId, CAST(:ascent AS uuid), :author, :kind, :key, :ct, CAST(:caption AS text), CAST(:lang AS text))
            """.trimIndent(),
            params {
                uuid("id", id); uuid("routeId", routeId); uuid("ascent", ascentId); uuid("author", authorId)
                str("kind", kind.wire); str("key", storageKey); str("ct", contentType); str("caption", caption); str("lang", captionLanguage)
            },
        )
    }

    /** Gives the author's unattached photos to a route that is being created. */
    fun attachToRoute(ids: List<UUID>, routeId: UUID, authorId: UUID) {
        if (ids.isEmpty()) return
        jdbc.update(
            """
            UPDATE photos SET route_id = :route, updated_at = now()
             WHERE id IN (:ids) AND route_id IS NULL AND area_id IS NULL AND author_id = :author AND deleted_at IS NULL
            """.trimIndent(),
            params { uuids("ids", ids); uuid("route", routeId); uuid("author", authorId) },
        )
    }

    fun storageKey(id: UUID): String? =
        jdbc.query("SELECT storage_key FROM photos WHERE id = :id", params { uuid("id", id) }) { rs, _ -> rs.getString(1) }.firstOrNull()

    fun markReady(id: UUID, width: Int, height: Int, takenAt: OffsetDateTime?, lon: Double?, lat: Double?) {
        jdbc.update(
            """
            UPDATE photos
               SET processing_status = 'ready', width_px = :w, height_px = :h, taken_at = CAST(:taken AS timestamptz),
                   location = CASE WHEN CAST(:lon AS float8) IS NULL THEN NULL
                                   ELSE ST_SetSRID(ST_MakePoint(CAST(:lon AS float8), CAST(:lat AS float8)), 4326) END
             WHERE id = :id
            """.trimIndent(),
            params {
                uuid("id", id); int("w", width); int("h", height); str("taken", takenAt?.toString())
                double("lon", lon); double("lat", lat)
            },
        )
    }

    fun markFailed(id: UUID) {
        jdbc.update("UPDATE photos SET processing_status = 'failed' WHERE id = :id", params { uuid("id", id) })
    }

    fun update(id: UUID, kind: PhotoKind?, caption: String?, setCaption: Boolean, captionLanguage: String?, setLanguage: Boolean) {
        jdbc.update(
            """
            UPDATE photos
               SET kind = COALESCE(CAST(:kind AS text), kind),
                   caption = CASE WHEN :setCaption THEN CAST(:caption AS text) ELSE caption END,
                   caption_language = CASE WHEN :setLang THEN CAST(:lang AS text) ELSE caption_language END
             WHERE id = :id
            """.trimIndent(),
            params {
                uuid("id", id); str("kind", kind?.wire); str("caption", caption); bool("setCaption", setCaption)
                str("lang", captionLanguage); bool("setLang", setLanguage)
            },
        )
    }

    fun softDelete(id: UUID) {
        jdbc.update("UPDATE photos SET deleted_at = now() WHERE id = :id AND deleted_at IS NULL", params { uuid("id", id) })
    }
}

// ------------------------------------------------------------------- service

/** Published after the photo row is committed; [PhotoProcessor] picks it up. */
data class PhotoUploaded(val photoId: UUID)

private val LANG = Regex("^[a-z]{2}$")

@Service
class PhotoService(
    private val photos: PhotoRepository,
    private val uploads: UploadService,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val events: ApplicationEventPublisher,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    /**
     * Returns the photo and whether it was created now (false = idempotent repeat).
     * Without [routeId] the photo stays unattached until a new route takes it (see RouteService.create).
     */
    @Transactional
    fun create(routeId: UUID?, req: PhotoCreate): Pair<Photo, Boolean> {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        if (routeId != null) {
            val routeStatus = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
                .firstOrNull()
            if (routeStatus == null || (routeStatus == "hidden" && !caller.isModerator)) throw notFound("Маршрут не найден")
        } else if (req.ascentId != null) {
            throw fieldError("ascentId", "Фото восхождения загружается к маршруту")
        }

        photos.find(req.id)?.let { existing ->
            // A repeat of POST /photos after the route took the photo is still the same request.
            if (existing.authorId == caller.userId && (existing.photo.routeId == routeId || routeId == null)) return existing.photo to false
            throw conflict("conflict", "Объект с таким id уже существует")
        }

        val kind = parseWire<PhotoKind>(req.kind, "kind")
        validate {
            req.caption?.let { check(it.isNotBlank() && it.length <= 1000, "caption", "До 1000 символов") }
            req.captionLanguage?.let { check(LANG.matches(it), "captionLanguage", "Код языка ISO 639-1") }
            check(req.captionLanguage == null || req.caption != null, "captionLanguage", "Язык указывается вместе с подписью")
        }
        if (req.ascentId != null && routeId != null) {
            val ok = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM ascents WHERE id = :a AND route_id = :r AND deleted_at IS NULL)",
                params { uuid("a", req.ascentId); uuid("r", routeId) }, Boolean::class.java,
            )
            if (ok != true) throw fieldError("ascentId", "Восхождение по этому маршруту не найдено")
        }

        val upload = uploads.claim(caller, req.uploadId, "photo")
        photos.insert(req.id, routeId, req.ascentId, caller.userId, kind, upload.storageKey, upload.contentType, req.caption, req.captionLanguage)
        events.publishEvent(PhotoUploaded(req.id))
        return photos.find(req.id)!!.photo to true
    }

    fun list(routeId: UUID, kind: String?, inDescription: Boolean?, cursor: String?, limit: Int): Page<Photo> {
        val caller = Caller.currentOrNull()
        val routeStatus = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
            .firstOrNull()
        if (routeStatus == null || (routeStatus == "hidden" && caller?.isModerator != true)) throw notFound("Маршрут не найден")
        val after = Cursor.decode(cursor, 2)?.let { it[0] to Cursor.uuid(it[1]) }
        val rows = photos.listForRoute(
            routeId, kind?.let { parseWire<PhotoKind>(it, "kind") }, inDescription, caller?.userId,
            caller?.isModerator == true, after, limit,
        )
        val page = toPage(rows, limit, cursorOf = { listOf(it.createdAtText, it.photo.id.toString()) }) { it.photo }
        return page.copy(items = photos.withTopoLines(page.items))
    }

    fun get(id: UUID): Photo {
        val row = visibleRow(id, Caller.currentOrNull())
        return photos.withTopoLines(listOf(row.photo)).first()
    }

    /** PATCH semantics: absent field = unchanged, null = cleared (caption, captionLanguage). */
    @Transactional
    fun update(id: UUID, body: JsonNode): Photo {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = visibleRow(id, caller)
        if (row.authorId != caller.userId && !caller.isModerator) throw forbidden("Изменить фото может только автор")
        val allowed = setOf("kind", "caption", "captionLanguage")
        body.fieldNames().forEach { if (it !in allowed) throw fieldError(it, "Неизвестное поле") }

        val kind = body.get("kind")?.let { if (it.isNull) throw fieldError("kind", "Не может быть null") else parseWire<PhotoKind>(it.asText(), "kind") }
        val caption = body.get("caption")?.takeUnless { it.isNull }?.asText()
        val lang = body.get("captionLanguage")?.takeUnless { it.isNull }?.asText()
        validate {
            caption?.let { check(it.isNotBlank() && it.length <= 1000, "caption", "До 1000 символов") }
            lang?.let { check(LANG.matches(it), "captionLanguage", "Код языка ISO 639-1") }
        }
        photos.update(id, kind, caption, body.has("caption"), lang, body.has("captionLanguage"))
        if (row.authorId != caller.userId) log.record(caller.userId, "edit_photo", "photo", id)
        return get(id)
    }

    @Transactional
    fun delete(id: UUID) {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = photos.find(id) ?: throw notFound("Фото не найдено")
        if (row.deleted) return
        if (row.authorId != caller.userId && !caller.isModerator) throw forbidden("Удалить фото может только автор")
        photos.softDelete(id)
        if (row.authorId != caller.userId) log.record(caller.userId, "delete_photo", "photo", id)
    }

    private fun visibleRow(id: UUID, caller: Caller?): PhotoRow {
        val row = photos.find(id) ?: throw notFound("Фото не найдено")
        val own = caller != null && row.authorId == caller.userId
        val attached = row.photo.routeId != null || row.photo.areaId != null
        val visible = !row.deleted && (own || caller?.isModerator == true ||
            (attached && row.visible && row.photo.processingStatus == ProcessingStatus.READY))
        if (!visible) throw notFound("Фото не найдено")
        return row
    }
}

// ------------------------------------------------------------------- controller

@RestController
class PhotoController(private val service: PhotoService) {

    @GetMapping("/routes/{routeId}/photos")
    fun list(
        @PathVariable routeId: UUID,
        @RequestParam(required = false) kind: String?,
        @RequestParam(required = false) inDescription: Boolean?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.list(routeId, kind, inDescription, cursor, com.alproutes.common.pageLimit(limit))

    @PostMapping("/routes/{routeId}/photos")
    fun create(@PathVariable routeId: UUID, @RequestBody body: PhotoCreate): ResponseEntity<Photo> {
        val (photo, created) = service.create(routeId, body)
        return ResponseEntity.status(if (created) HttpStatus.CREATED else HttpStatus.OK).body(photo)
    }

    @PostMapping("/photos")
    fun createUnattached(@RequestBody body: PhotoCreate): ResponseEntity<Photo> {
        val (photo, created) = service.create(null, body)
        return ResponseEntity.status(if (created) HttpStatus.CREATED else HttpStatus.OK).body(photo)
    }

    @GetMapping("/photos/{photoId}")
    fun get(@PathVariable photoId: UUID) = service.get(photoId)

    @PatchMapping("/photos/{photoId}")
    fun update(@PathVariable photoId: UUID, @RequestBody body: JsonNode) = service.update(photoId, body)

    @DeleteMapping("/photos/{photoId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable photoId: UUID) = service.delete(photoId)
}
