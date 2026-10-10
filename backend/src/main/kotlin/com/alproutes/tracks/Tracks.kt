package com.alproutes.tracks

import com.alproutes.auth.Caller
import com.alproutes.common.Cursor
import com.alproutes.common.Page
import com.alproutes.common.conflict
import com.alproutes.common.fieldError
import com.alproutes.common.forbidden
import com.alproutes.common.intOrNull
import com.alproutes.common.localDateOrNull
import com.alproutes.common.notFound
import com.alproutes.common.odt
import com.alproutes.common.pageLimit
import com.alproutes.common.params
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.validate
import com.alproutes.media.MediaStorage
import com.alproutes.moderation.ModerationLog
import com.alproutes.uploads.UploadService
import com.alproutes.users.UserPublic
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.slf4j.LoggerFactory
import org.springframework.context.ApplicationEventPublisher
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Component
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.event.TransactionPhase
import org.springframework.transaction.event.TransactionalEventListener
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
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.UUID

// ------------------------------------------------------------------- DTOs (contract: Track*)

data class Track(
    val id: UUID,
    val routeId: UUID,
    val ascentId: UUID?,
    val author: UserPublic,
    val format: String,
    val originalFilename: String?,
    val recordedOn: LocalDate?,
    val note: String?,
    val lengthM: Int?,
    val elevationGainM: Int?,
    val elevationLossM: Int?,
    val minElevationM: Int?,
    val maxElevationM: Int?,
    val elevationSource: String?,
    val processingStatus: String,
    val processingError: String?,
    val createdAt: OffsetDateTime,
    val updatedAt: OffsetDateTime,
)

data class TrackCreate(
    val id: UUID,
    val uploadId: UUID,
    val ascentId: UUID? = null,
    val recordedOn: LocalDate? = null,
    val note: String? = null,
)

data class ElevationProfile(val source: String?, val points: List<List<Int>>)

data class TrackUploaded(val trackId: UUID)

// ------------------------------------------------------------------- repository

internal data class TrackRow(
    val track: Track, val authorId: UUID, val storageKey: String, val deleted: Boolean, val visible: Boolean,
    val createdAtText: String, val profile: String?,
)

@Repository
class TrackRepository(private val jdbc: NamedParameterJdbcTemplate) {
    private val columns = """
        t.id, t.route_id, t.ascent_id, t.format, t.original_filename, t.recorded_on, t.note, t.length_m,
        t.elevation_gain_m, t.elevation_loss_m, t.min_elevation_m, t.max_elevation_m, t.elevation_source,
        t.processing_status, t.processing_error, t.storage_key, t.visibility, t.deleted_at IS NOT NULL AS deleted,
        t.elevation_profile::text AS profile, t.created_at, t.created_at::text AS created_at_text, t.updated_at,
        u.id AS author_id, u.display_name AS author_name
    """.trimIndent()
    private val from = "FROM tracks t JOIN users u ON u.id = t.author_id"

    private fun row(rs: ResultSet) = TrackRow(
        Track(
            id = rs.uuid("id"),
            routeId = rs.uuid("route_id"),
            ascentId = rs.uuidOrNull("ascent_id"),
            author = UserPublic(rs.uuid("author_id"), rs.getString("author_name"), null),
            format = rs.getString("format"),
            originalFilename = rs.getString("original_filename"),
            recordedOn = rs.localDateOrNull("recorded_on"),
            note = rs.getString("note"),
            lengthM = rs.intOrNull("length_m"),
            elevationGainM = rs.intOrNull("elevation_gain_m"),
            elevationLossM = rs.intOrNull("elevation_loss_m"),
            minElevationM = rs.intOrNull("min_elevation_m"),
            maxElevationM = rs.intOrNull("max_elevation_m"),
            elevationSource = rs.getString("elevation_source"),
            processingStatus = rs.getString("processing_status"),
            processingError = rs.getString("processing_error"),
            createdAt = rs.odt("created_at"),
            updatedAt = rs.odt("updated_at"),
        ),
        rs.uuid("author_id"), rs.getString("storage_key"), rs.getBoolean("deleted"), rs.getString("visibility") == "visible",
        rs.getString("created_at_text"), rs.getString("profile"),
    )

    internal fun find(id: UUID): TrackRow? =
        jdbc.query("SELECT $columns $from WHERE t.id = :id", params { uuid("id", id) }) { rs, _ -> row(rs) }.firstOrNull()

    internal fun listForRoute(routeId: UUID, callerId: UUID?, moderator: Boolean, after: Pair<String, UUID>?, limit: Int): List<TrackRow> {
        val where = mutableListOf("t.route_id = :routeId", "t.deleted_at IS NULL")
        where += if (callerId != null) "(t.processing_status = 'ready' OR t.author_id = :caller)" else "t.processing_status = 'ready'"
        if (!moderator) where += "t.visibility = 'visible'"
        if (after != null) where += "(t.created_at, t.id) < (CAST(:afterCreated AS timestamptz), CAST(:afterId AS uuid))"
        return jdbc.query(
            "SELECT $columns $from WHERE ${where.joinToString(" AND ")} ORDER BY t.created_at DESC, t.id DESC LIMIT :limit",
            params {
                uuid("routeId", routeId); uuid("caller", callerId)
                str("afterCreated", after?.first); uuid("afterId", after?.second); int("limit", limit + 1)
            },
        ) { rs, _ -> row(rs) }
    }

    fun insert(id: UUID, routeId: UUID, ascentId: UUID?, authorId: UUID, storageKey: String, fileName: String?, format: String,
               recordedOn: LocalDate?, note: String?) {
        jdbc.update(
            """
            INSERT INTO tracks (id, route_id, ascent_id, author_id, storage_key, original_filename, format, recorded_on, note)
            VALUES (:id, :routeId, CAST(:ascent AS uuid), :author, :key, CAST(:fileName AS text), :format,
                    CAST(:recordedOn AS date), CAST(:note AS text))
            """.trimIndent(),
            params {
                uuid("id", id); uuid("routeId", routeId); uuid("ascent", ascentId); uuid("author", authorId); str("key", storageKey)
                str("fileName", fileName); str("format", format); str("recordedOn", recordedOn?.toString()); str("note", note)
            },
        )
    }

    /** Geometry goes in as GeoJSON MultiLineString with Z; length is measured on the spheroid (geography). */
    fun markReady(id: UUID, format: String, geometryJson: String, stats: TrackStats, profileJson: String?) {
        jdbc.update(
            """
            UPDATE tracks
               SET processing_status = 'ready', processing_error = NULL, format = :format,
                   geometry = ST_SetSRID(ST_Force3DZ(ST_GeomFromGeoJSON(CAST(:geom AS text))), 4326),
                   length_m = round(ST_Length(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(CAST(:geom AS text)), 4326))::geography)),
                   elevation_gain_m = CAST(:gain AS integer), elevation_loss_m = CAST(:loss AS integer),
                   min_elevation_m = CAST(:minEle AS integer), max_elevation_m = CAST(:maxEle AS integer),
                   elevation_profile = CAST(:profile AS jsonb),
                   recorded_on = COALESCE(recorded_on, CAST(:recordedOn AS date))
             WHERE id = :id
            """.trimIndent(),
            params {
                uuid("id", id); str("format", format); str("geom", geometryJson)
                int("gain", stats.elevationGainM); int("loss", stats.elevationLossM)
                int("minEle", stats.minElevationM); int("maxEle", stats.maxElevationM)
                str("profile", profileJson); str("recordedOn", stats.recordedOn?.toString())
            },
        )
    }

    fun markFailed(id: UUID, error: String) {
        jdbc.update(
            "UPDATE tracks SET processing_status = 'failed', processing_error = :err WHERE id = :id",
            params { uuid("id", id); str("err", error.take(500)) },
        )
    }

    /** 2D when the track has no elevations: a zero Z must never look like a real height. */
    fun geometry(id: UUID): String? = jdbc.query(
        """
        SELECT ST_AsGeoJSON(CASE WHEN elevation_profile IS NULL THEN ST_Force2D(geometry) ELSE geometry END, 6) AS g
          FROM tracks WHERE id = :id AND geometry IS NOT NULL
        """.trimIndent(),
        params { uuid("id", id) },
    ) { rs, _ -> rs.getString("g") }.firstOrNull()

    fun update(id: UUID, recordedOn: LocalDate?, setRecordedOn: Boolean, note: String?, setNote: Boolean) {
        jdbc.update(
            """
            UPDATE tracks
               SET recorded_on = CASE WHEN :setDate THEN CAST(:date AS date) ELSE recorded_on END,
                   note = CASE WHEN :setNote THEN CAST(:note AS text) ELSE note END
             WHERE id = :id
            """.trimIndent(),
            params {
                uuid("id", id); bool("setDate", setRecordedOn); str("date", recordedOn?.toString())
                bool("setNote", setNote); str("note", note)
            },
        )
    }

    fun softDelete(id: UUID) {
        jdbc.update("UPDATE tracks SET deleted_at = now() WHERE id = :id AND deleted_at IS NULL", params { uuid("id", id) })
    }
}

// ------------------------------------------------------------------- processing

@Component
class TrackProcessor(
    private val tracks: TrackRepository,
    private val storage: MediaStorage,
    private val mapper: ObjectMapper,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onUploaded(event: TrackUploaded) = process(event.trackId)

    fun process(id: UUID) {
        val row = tracks.find(id) ?: return
        try {
            val parsed = TrackParser.parse(storage.read(row.storageKey))
            val stats = TrackStatsCalculator.compute(parsed)
            // Missing heights inside a segment take the nearest known one; without any, Z = 0 is stored
            // only to satisfy the column type and is stripped on output (see TrackRepository.geometry).
            val coords = parsed.segments.map { seg ->
                var last = seg.firstOrNull { it.ele != null }?.ele ?: 0.0
                seg.map { p -> p.ele?.also { last = it }; listOf(p.lon, p.lat, p.ele ?: last) }
            }
            val geometry = mapper.writeValueAsString(mapOf("type" to "MultiLineString", "coordinates" to coords))
            tracks.markReady(id, parsed.format, geometry, stats, stats.profile?.let { mapper.writeValueAsString(it) })
        } catch (e: TrackFormatException) {
            tracks.markFailed(id, e.message ?: "Не удалось разобрать файл")
        } catch (e: Exception) {
            log.warn("Track {} processing failed: {}", id, e.toString())
            tracks.markFailed(id, "Ошибка обработки трека")
        }
    }
}

// ------------------------------------------------------------------- service

@Service
class TrackService(
    private val tracks: TrackRepository,
    private val uploads: UploadService,
    private val users: UserRepository,
    private val storage: MediaStorage,
    private val log: ModerationLog,
    private val events: ApplicationEventPublisher,
    private val jdbc: NamedParameterJdbcTemplate,
    private val mapper: ObjectMapper,
) {
    @Transactional
    fun create(routeId: UUID, req: TrackCreate): Pair<Track, Boolean> {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        requireRoute(routeId, caller)
        tracks.find(req.id)?.let { existing ->
            if (existing.authorId == caller.userId && existing.track.routeId == routeId) return existing.track to false
            throw conflict("conflict", "Объект с таким id уже существует")
        }
        validate {
            req.note?.let { check(it.length <= 2000, "note", "До 2000 символов") }
            req.recordedOn?.let { check(!it.isAfter(LocalDate.now().plusDays(1)), "recordedOn", "Дата в будущем") }
        }
        if (req.ascentId != null) {
            val ok = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM ascents WHERE id = :a AND route_id = :r AND deleted_at IS NULL)",
                params { uuid("a", req.ascentId); uuid("r", routeId) }, Boolean::class.java,
            )
            if (ok != true) throw fieldError("ascentId", "Восхождение по этому маршруту не найдено")
        }
        val upload = uploads.claim(caller, req.uploadId, "track")
        // Provisional: the processor sets the format from the file content.
        val format = if (upload.contentType.contains("kml")) "kml" else "gpx"
        tracks.insert(req.id, routeId, req.ascentId, caller.userId, upload.storageKey, upload.fileName, format, req.recordedOn, req.note?.takeIf { it.isNotBlank() })
        events.publishEvent(TrackUploaded(req.id))
        return tracks.find(req.id)!!.track to true
    }

    fun list(routeId: UUID, cursor: String?, limit: Int): Page<Track> {
        val caller = Caller.currentOrNull()
        requireRoute(routeId, caller)
        val after = Cursor.decode(cursor, 2)?.let { it[0] to Cursor.uuid(it[1]) }
        val rows = tracks.listForRoute(routeId, caller?.userId, caller?.isModerator == true, after, limit)
        return toPage(rows, limit, cursorOf = { listOf(it.createdAtText, it.track.id.toString()) }) { it.track }
    }

    fun get(id: UUID): Track = visible(id, Caller.currentOrNull()).track

    fun geometry(id: UUID): String {
        val row = visible(id, Caller.currentOrNull())
        if (row.track.processingStatus != "ready") throw conflict("invalid-state", "Трек ещё обрабатывается или обработка не удалась")
        return tracks.geometry(id) ?: throw notFound("Геометрия трека не найдена")
    }

    fun profile(id: UUID): ElevationProfile {
        val row = visible(id, Caller.currentOrNull())
        if (row.track.processingStatus != "ready") throw conflict("invalid-state", "Трек ещё обрабатывается или обработка не удалась")
        val points: List<List<Int>> = row.profile?.let { mapper.readValue(it) } ?: throw notFound("В треке нет высот")
        return ElevationProfile(row.track.elevationSource, points)
    }

    fun downloadUrl(id: UUID): String {
        val row = visible(id, Caller.currentOrNull())
        val ext = row.track.format
        val name = row.track.originalFilename?.takeIf { it.endsWith(".$ext", ignoreCase = true) } ?: "track-${row.track.id}.$ext"
        val type = if (ext == "kml") "application/vnd.google-earth.kml+xml" else "application/gpx+xml"
        return storage.presignedDownload(row.storageKey, type, name, attachment = true)
    }

    @Transactional
    fun update(id: UUID, body: JsonNode): Track {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = visible(id, caller)
        if (row.authorId != caller.userId && !caller.isModerator) throw forbidden("Изменить трек может только автор")
        body.fieldNames().forEach { if (it !in setOf("recordedOn", "note")) throw fieldError(it, "Неизвестное поле") }
        val date = body.get("recordedOn")?.takeUnless { it.isNull }?.asText()?.let {
            runCatching { LocalDate.parse(it) }.getOrElse { throw fieldError("recordedOn", "Дата в формате ГГГГ-ММ-ДД") }
        }
        val note = body.get("note")?.takeUnless { it.isNull }?.asText()
        validate { note?.let { check(it.length <= 2000, "note", "До 2000 символов") } }
        tracks.update(id, date, body.has("recordedOn"), note, body.has("note"))
        if (row.authorId != caller.userId) log.record(caller.userId, "edit_track", "track", id)
        return tracks.find(id)!!.track
    }

    @Transactional
    fun delete(id: UUID) {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = tracks.find(id) ?: throw notFound("Трек не найден")
        if (row.deleted) return
        if (row.authorId != caller.userId && !caller.isModerator) throw forbidden("Удалить трек может только автор")
        // Revisions that imported a line keep their copy of the geometry: only the track disappears.
        tracks.softDelete(id)
        if (row.authorId != caller.userId) log.record(caller.userId, "delete_track", "track", id)
    }

    private fun visible(id: UUID, caller: Caller?): TrackRow {
        val row = tracks.find(id) ?: throw notFound("Трек не найден")
        val own = caller != null && row.authorId == caller.userId
        val ok = !row.deleted && (own || caller?.isModerator == true || (row.visible && row.track.processingStatus == "ready"))
        if (!ok) throw notFound("Трек не найден")
        return row
    }

    private fun requireRoute(routeId: UUID, caller: Caller?) {
        val status = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
            .firstOrNull()
        if (status == null || (status == "hidden" && caller?.isModerator != true)) throw notFound("Маршрут не найден")
    }
}

// ------------------------------------------------------------------- controller

@RestController
class TrackController(private val service: TrackService) {

    @GetMapping("/routes/{routeId}/tracks")
    fun list(
        @PathVariable routeId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.list(routeId, cursor, pageLimit(limit))

    @PostMapping("/routes/{routeId}/tracks")
    fun create(@PathVariable routeId: UUID, @RequestBody body: TrackCreate): ResponseEntity<Track> {
        val (track, created) = service.create(routeId, body)
        return ResponseEntity.status(if (created) HttpStatus.CREATED else HttpStatus.OK).body(track)
    }

    @GetMapping("/tracks/{trackId}")
    fun get(@PathVariable trackId: UUID) = service.get(trackId)

    @PatchMapping("/tracks/{trackId}")
    fun update(@PathVariable trackId: UUID, @RequestBody body: JsonNode) = service.update(trackId, body)

    @DeleteMapping("/tracks/{trackId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable trackId: UUID) = service.delete(trackId)

    @GetMapping("/tracks/{trackId}/geometry")
    fun geometry(@PathVariable trackId: UUID): ResponseEntity<String> =
        ResponseEntity.ok().contentType(MediaType.parseMediaType("application/geo+json")).body(service.geometry(trackId))

    @GetMapping("/tracks/{trackId}/profile")
    fun profile(@PathVariable trackId: UUID) = service.profile(trackId)

    @GetMapping("/tracks/{trackId}/download")
    fun download(@PathVariable trackId: UUID): ResponseEntity<Void> =
        ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION, service.downloadUrl(trackId)).build()
}
