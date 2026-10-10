package com.alproutes.topo

import com.alproutes.auth.Caller
import com.alproutes.common.Cursor
import com.alproutes.common.Page
import com.alproutes.common.Validator
import com.alproutes.common.conflict
import com.alproutes.common.forbidden
import com.alproutes.common.notFound
import com.alproutes.common.odt
import com.alproutes.common.odtOrNull
import com.alproutes.common.pageLimit
import com.alproutes.common.params
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.validate
import com.alproutes.moderation.ModerationLog
import com.alproutes.photos.PhotoKind
import com.alproutes.photos.PhotoRepository
import com.alproutes.photos.TopoLine
import com.alproutes.routes.ReviewDecision
import com.alproutes.users.UserPublic
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.sql.ResultSet
import java.util.UUID

// ------------------------------------------------------------------- DTOs (contract TopoDrawing)

data class TopoPoint(val x: Double, val y: Double)

data class TopoPath(
    val id: String,
    val style: String,
    val dashed: Boolean = false,
    val smooth: Boolean = true,
    val points: List<TopoPoint>,
)

data class TopoMarker(val x: Double, val y: Double, val kind: String, val label: String? = null)

data class TopoLabel(val x: Double, val y: Double, val text: String, val pathId: String? = null)

data class TopoDrawing(
    val formatVersion: Int,
    val paths: List<TopoPath>,
    val markers: List<TopoMarker> = emptyList(),
    val labels: List<TopoLabel> = emptyList(),
)

data class TopoLineCreate(val baseVersionId: UUID? = null, val drawing: TopoDrawing, val publish: Boolean = false)

private val STYLES = setOf("main", "variant", "approach", "descent")
private val MARKER_KINDS = setOf("belay", "crux", "bivouac", "rappel", "key_point")

/** Mirrors the contract limits; the stored JSON is re-serialized from these classes, so unknown keys are dropped. */
internal fun validateDrawing(d: TopoDrawing) = validate {
    check(d.formatVersion == 1, "drawing.formatVersion", "Поддерживается только версия 1")
    check(d.paths.size in 1..20, "drawing.paths", "От 1 до 20 линий")
    val ids = mutableSetOf<String>()
    d.paths.forEachIndexed { i, p ->
        val f = "drawing.paths[$i]"
        check(p.id.isNotBlank() && p.id.length <= 36, "$f.id", "Непустой, до 36 символов")
        check(ids.add(p.id), "$f.id", "id линии повторяется")
        check(p.style in STYLES, "$f.style", "Допустимые значения: ${STYLES.joinToString()}")
        check(p.points.size in 2..2000, "$f.points", "От 2 до 2000 точек")
        p.points.forEachIndexed { j, pt -> point(pt.x, pt.y, "$f.points[$j]") }
    }
    check(d.markers.size <= 200, "drawing.markers", "Не больше 200 отметок")
    d.markers.forEachIndexed { i, m ->
        point(m.x, m.y, "drawing.markers[$i]")
        check(m.kind in MARKER_KINDS, "drawing.markers[$i].kind", "Допустимые значения: ${MARKER_KINDS.joinToString()}")
        m.label?.let { check(it.length <= 50, "drawing.markers[$i].label", "До 50 символов") }
    }
    check(d.labels.size <= 200, "drawing.labels", "Не больше 200 подписей")
    d.labels.forEachIndexed { i, l ->
        point(l.x, l.y, "drawing.labels[$i]")
        check(l.text.isNotBlank() && l.text.length <= 200, "drawing.labels[$i].text", "От 1 до 200 символов")
        l.pathId?.let { check(it in ids, "drawing.labels[$i].pathId", "Нет линии с таким id") }
    }
}

private fun Validator.point(x: Double, y: Double, field: String) =
    check(x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0, field, "Координаты в долях изображения, от 0 до 1")

// ------------------------------------------------------------------- repository

internal data class TopoState(
    val id: UUID, val photoId: UUID, val routeId: UUID, val baseVersionId: UUID?, val status: String, val authorId: UUID,
)

@Repository
class TopoLineRepository(private val jdbc: NamedParameterJdbcTemplate, private val mapper: ObjectMapper) {

    private val select = """
        SELECT t.id, t.photo_id, t.route_id, t.version, t.base_version_id, t.status, t.is_current, t.drawing::text AS drawing,
               t.created_at, t.created_at::text AS created_at_text, t.reviewed_at, t.review_note, t.author_id,
               u.display_name AS author_name
          FROM topo_lines t JOIN users u ON u.id = t.author_id
    """.trimIndent()

    private fun line(rs: ResultSet) = TopoLine(
        rs.uuid("id"), rs.uuid("photo_id"), rs.uuid("route_id"), rs.getInt("version"), rs.uuidOrNull("base_version_id"),
        rs.getString("status"), rs.getBoolean("is_current"), mapper.readTree(rs.getString("drawing")),
        UserPublic(rs.uuid("author_id"), rs.getString("author_name"), null),
        rs.odt("created_at"), rs.odtOrNull("reviewed_at"), rs.getString("review_note"),
    )

    fun find(id: UUID): TopoLine? =
        jdbc.query("$select WHERE t.id = :id", params { uuid("id", id) }) { rs, _ -> line(rs) }.firstOrNull()

    internal fun state(id: UUID): TopoState? = jdbc.query(
        "SELECT id, photo_id, route_id, base_version_id, status, author_id FROM topo_lines WHERE id = :id FOR UPDATE",
        params { uuid("id", id) },
    ) { rs, _ ->
        TopoState(rs.uuid("id"), rs.uuid("photo_id"), rs.uuid("route_id"), rs.uuidOrNull("base_version_id"), rs.getString("status"), rs.uuid("author_id"))
    }.firstOrNull()

    /** Serializes proposals for one photo (row lock), so version numbers and the current flag never race. */
    fun lockPhoto(photoId: UUID) {
        jdbc.query("SELECT id FROM photos WHERE id = :id FOR UPDATE", params { uuid("id", photoId) }) { _, _ -> }
    }

    /** Current approved version and the latest version of one route on one photo, plus the next number. */
    fun heads(photoId: UUID, routeId: UUID): Triple<UUID?, UUID?, Int> = jdbc.query(
        """
        SELECT (SELECT id FROM topo_lines WHERE photo_id = :p AND route_id = :r AND is_current) AS current_id,
               (SELECT id FROM topo_lines WHERE photo_id = :p AND route_id = :r ORDER BY version DESC LIMIT 1) AS latest_id,
               (SELECT COALESCE(max(version), 0) + 1 FROM topo_lines WHERE photo_id = :p AND route_id = :r) AS next_version
        """.trimIndent(),
        params { uuid("p", photoId); uuid("r", routeId) },
    ) { rs, _ -> Triple(rs.uuidOrNull("current_id"), rs.uuidOrNull("latest_id"), rs.getInt("next_version")) }.first()

    fun insert(id: UUID, photoId: UUID, routeId: UUID, version: Int, baseVersionId: UUID?, drawing: TopoDrawing, authorId: UUID) {
        jdbc.update(
            """
            INSERT INTO topo_lines (id, photo_id, route_id, version, base_version_id, drawing, author_id)
            VALUES (:id, :p, :r, :v, CAST(:base AS uuid), CAST(:drawing AS jsonb), :author)
            """.trimIndent(),
            params {
                uuid("id", id); uuid("p", photoId); uuid("r", routeId); int("v", version); uuid("base", baseVersionId)
                str("drawing", mapper.writeValueAsString(drawing)); uuid("author", authorId)
            },
        )
    }

    fun approve(id: UUID, previousCurrent: UUID?, reviewerId: UUID, note: String?) {
        if (previousCurrent != null) {
            jdbc.update("UPDATE topo_lines SET is_current = false WHERE id = :id", params { uuid("id", previousCurrent) })
        }
        jdbc.update(
            """
            UPDATE topo_lines
               SET status = 'approved', is_current = true, reviewed_by = :reviewer, reviewed_at = now(), review_note = CAST(:note AS text)
             WHERE id = :id
            """.trimIndent(),
            params { uuid("id", id); uuid("reviewer", reviewerId); str("note", note) },
        )
    }

    fun reject(id: UUID, reviewerId: UUID, note: String) {
        jdbc.update(
            "UPDATE topo_lines SET status = 'rejected', reviewed_by = :reviewer, reviewed_at = now(), review_note = :note WHERE id = :id",
            params { uuid("id", id); uuid("reviewer", reviewerId); str("note", note) },
        )
    }

    /** Newest first. Approved for everybody; pending and rejected for their author and moderators. */
    fun versions(photoId: UUID, routeId: UUID, callerId: UUID?, moderator: Boolean, beforeVersion: Int?, limit: Int): List<TopoLine> {
        val visibility = when {
            moderator -> "TRUE"
            callerId != null -> "(t.status = 'approved' OR t.author_id = :caller)"
            else -> "t.status = 'approved'"
        }
        return jdbc.query(
            """
            $select
             WHERE t.photo_id = :p AND t.route_id = :r AND $visibility AND (CAST(:before AS int) IS NULL OR t.version < CAST(:before AS int))
             ORDER BY t.version DESC
             LIMIT :limit
            """.trimIndent(),
            params { uuid("p", photoId); uuid("r", routeId); uuid("caller", callerId); int("before", beforeVersion); int("limit", limit + 1) },
        ) { rs, _ -> line(rs) }
    }

    /** Oldest first: the moderation queue. */
    fun pending(afterCreatedAt: String?, afterId: UUID?, limit: Int): List<Pair<TopoLine, String>> = jdbc.query(
        """
        $select
         WHERE t.status = 'pending'
           AND (CAST(:after AS timestamptz) IS NULL OR (t.created_at, t.id) > (CAST(:after AS timestamptz), CAST(:afterId AS uuid)))
         ORDER BY t.created_at, t.id
         LIMIT :limit
        """.trimIndent(),
        params { str("after", afterCreatedAt); uuid("afterId", afterId); int("limit", limit + 1) },
    ) { rs, _ -> line(rs) to rs.getString("created_at_text") }
}

// ------------------------------------------------------------------- service

@Service
class TopoLineService(
    private val lines: TopoLineRepository,
    private val photos: PhotoRepository,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    /**
     * A version is a full drawing based on the current approved one (or the latest while none is
     * approved). A stale base means someone else changed the drawing in between: 409, merge by hand.
     */
    @Transactional
    fun propose(photoId: UUID, routeId: UUID, req: TopoLineCreate): TopoLine {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        if (req.publish && !caller.isModerator) throw forbidden("Сразу публиковать могут только модераторы")
        requireRoute(routeId, caller)
        val photo = photos.find(photoId)
        val own = photo != null && photo.authorId == caller.userId
        if (photo == null || photo.deleted || (!photo.visible && !own && !caller.isModerator)) throw notFound("Фото не найдено")
        if (photo.photo.routeId == null && photo.photo.areaId == null) {
            throw conflict("invalid-state", "Фото ещё не привязано к маршруту или району")
        }
        if (photo.photo.kind != PhotoKind.TOPO) throw conflict("invalid-state", "Нитку рисуют на фото типа «topo»")
        validateDrawing(req.drawing)

        lines.lockPhoto(photoId)
        val (current, latest, next) = lines.heads(photoId, routeId)
        val expected = current ?: latest
        if (req.baseVersionId != expected) {
            throw conflict("revision-conflict", "Прорисовку уже изменили: начните с текущей версии", currentRevisionId = expected)
        }
        val id = UUID.randomUUID()
        lines.insert(id, photoId, routeId, next, req.baseVersionId, req.drawing, caller.userId)
        if (req.publish) {
            lines.approve(id, current, caller.userId, null)
            log.record(caller.userId, "self_approve_topo_line", "topo_line", id)
        }
        return lines.find(id)!!
    }

    fun versions(photoId: UUID, routeId: UUID, cursor: String?, limit: Int): Page<TopoLine> {
        val caller = Caller.currentOrNull()
        requireRoute(routeId, caller)
        val before = Cursor.decode(cursor, 1)?.let { it[0].toIntOrNull() ?: throw com.alproutes.common.fieldError("cursor", "Некорректный курсор") }
        val rows = lines.versions(photoId, routeId, caller?.userId, caller?.isModerator == true, before, limit)
        return toPage(rows, limit, cursorOf = { listOf(it.version.toString()) }) { it }
    }

    @Transactional
    fun approve(id: UUID, note: String?): TopoLine {
        val caller = moderator()
        validateNote(note, required = false)
        val state = lines.state(id) ?: throw notFound("Прорисовка не найдена")
        lines.lockPhoto(state.photoId)
        if (state.status != "pending") throw conflict("invalid-state", "Прорисовка уже рассмотрена")
        val (current, _, _) = lines.heads(state.photoId, state.routeId)
        // Approving a drawing based on an outdated version would silently discard the changes made since.
        if (current != null && state.baseVersionId != current) {
            throw conflict("revision-stale", "После создания этой версии одобрена другая", currentRevisionId = current)
        }
        lines.approve(id, current, caller.userId, note)
        log.record(caller.userId, "approve_topo_line", "topo_line", id, note)
        return lines.find(id)!!
    }

    @Transactional
    fun reject(id: UUID, note: String?): TopoLine {
        val caller = moderator()
        validateNote(note, required = true)
        val state = lines.state(id) ?: throw notFound("Прорисовка не найдена")
        if (state.status != "pending") throw conflict("invalid-state", "Прорисовка уже рассмотрена")
        lines.reject(id, caller.userId, note!!)
        log.record(caller.userId, "reject_topo_line", "topo_line", id, note)
        return lines.find(id)!!
    }

    fun pending(cursor: String?, limit: Int): Page<TopoLine> {
        moderator()
        val c = Cursor.decode(cursor, 2)
        val rows = lines.pending(c?.get(0), c?.get(1)?.let { Cursor.uuid(it) }, limit)
        return toPage(rows, limit, cursorOf = { listOf(it.second, it.first.id.toString()) }) { it.first }
    }

    private fun requireRoute(routeId: UUID, caller: Caller?) {
        val status = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
            .firstOrNull()
        if (status == null || (status == "hidden" && caller?.isModerator != true)) throw notFound("Маршрут не найден")
    }

    private fun moderator(): Caller {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        if (!caller.isModerator) throw forbidden("Действие доступно модераторам")
        return caller
    }

    private fun validateNote(note: String?, required: Boolean) = validate {
        check(!required || !note.isNullOrBlank(), "note", "Укажите причину")
        note?.let { check(it.length <= 2000, "note", "Не длиннее 2000 символов") }
    }
}

// ------------------------------------------------------------------- controller

@RestController
class TopoLineController(private val service: TopoLineService) {

    @GetMapping("/photos/{photoId}/topo-lines/{routeId}/versions")
    fun versions(
        @PathVariable photoId: UUID,
        @PathVariable routeId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.versions(photoId, routeId, cursor, pageLimit(limit))

    @PostMapping("/photos/{photoId}/topo-lines/{routeId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    fun propose(@PathVariable photoId: UUID, @PathVariable routeId: UUID, @RequestBody body: TopoLineCreate) =
        service.propose(photoId, routeId, body)

    @PostMapping("/topo-lines/{topoLineId}/approve")
    fun approve(@PathVariable topoLineId: UUID, @RequestBody(required = false) body: ReviewDecision?) =
        service.approve(topoLineId, body?.note)

    @PostMapping("/topo-lines/{topoLineId}/reject")
    fun reject(@PathVariable topoLineId: UUID, @RequestBody body: ReviewDecision) = service.reject(topoLineId, body.note)

    @GetMapping("/moderation/topo-lines")
    fun pending(@RequestParam(required = false) cursor: String?, @RequestParam(required = false) limit: Int?) =
        service.pending(cursor, pageLimit(limit))
}
