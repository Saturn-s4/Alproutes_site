package com.alproutes.comments

import com.alproutes.auth.Caller
import com.alproutes.common.Cursor
import com.alproutes.common.Page
import com.alproutes.common.conflict
import com.alproutes.common.fieldError
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
import com.alproutes.photos.Photo
import com.alproutes.photos.PhotoRepository
import com.alproutes.users.UserPublic
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.annotation.JsonProperty
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

// ------------------------------------------------------------------- DTOs (contract Comment*)

data class Comment(
    val id: UUID,
    val author: UserPublic,
    val routeId: UUID?,
    val ascentId: UUID?,
    val parentId: UUID?,
    val body: String?,
    val language: String?,
    val photos: List<Photo>,
    @get:JsonProperty("isDeleted")
    val isDeleted: Boolean,
    val createdAt: OffsetDateTime,
    val editedAt: OffsetDateTime?,
)

data class CommentCreate(
    val id: UUID,
    val body: String,
    val parentId: UUID? = null,
    val language: String? = null,
    val photoIds: List<UUID> = emptyList(),
)

data class CommentUpdate(val body: String)

private val LANG = Regex("^[a-z]{2}$")
private const val MAX_BODY = 5000
private const val MAX_PHOTOS = 10

// ------------------------------------------------------------------- repository

internal data class CommentRow(
    val id: UUID, val authorId: UUID, val authorName: String, val routeId: UUID?, val ascentId: UUID?, val parentId: UUID?,
    val body: String, val language: String?, val visible: Boolean, val deleted: Boolean,
    val createdAt: OffsetDateTime, val createdAtText: String, val editedAt: OffsetDateTime?,
)

@Repository
class CommentRepository(private val jdbc: NamedParameterJdbcTemplate) {

    private val select = """
        SELECT c.id, c.author_id, u.display_name AS author_name, c.route_id, c.ascent_id, c.parent_id,
               c.body, c.language, c.visibility = 'visible' AS visible,
               c.deleted_at IS NOT NULL AS deleted, c.created_at, c.created_at::text AS created_at_text, c.edited_at
          FROM comments c
          JOIN users u ON u.id = c.author_id
    """.trimIndent()

    private fun row(rs: ResultSet) = CommentRow(
        rs.uuid("id"), rs.uuid("author_id"), rs.getString("author_name"), rs.uuidOrNull("route_id"), rs.uuidOrNull("ascent_id"),
        rs.uuidOrNull("parent_id"), rs.getString("body"), rs.getString("language"),
        rs.getBoolean("visible"), rs.getBoolean("deleted"), rs.odt("created_at"), rs.getString("created_at_text"), rs.odtOrNull("edited_at"),
    )

    internal fun find(id: UUID): CommentRow? =
        jdbc.query("$select WHERE c.id = :id", params { uuid("id", id) }) { rs, _ -> row(rs) }.firstOrNull()

    /** Oldest first: a thread reads top to bottom. Hidden ones only for moderators; deleted ones stay as stubs. */
    internal fun listForRoute(routeId: UUID, moderator: Boolean, after: Pair<String, UUID>?, limit: Int): List<CommentRow> {
        val where = mutableListOf("c.route_id = :routeId")
        if (!moderator) where += "c.visibility = 'visible'"
        if (after != null) where += "(c.created_at, c.id) > (CAST(:afterCreated AS timestamptz), CAST(:afterId AS uuid))"
        return jdbc.query(
            "$select WHERE ${where.joinToString(" AND ")} ORDER BY c.created_at, c.id LIMIT :limit",
            params { uuid("routeId", routeId); str("afterCreated", after?.first); uuid("afterId", after?.second); int("limit", limit + 1) },
        ) { rs, _ -> row(rs) }
    }

    fun insert(id: UUID, routeId: UUID, parentId: UUID?, authorId: UUID, body: String, language: String?) {
        jdbc.update(
            """
            INSERT INTO comments (id, author_id, route_id, parent_id, body, language)
            VALUES (:id, :author, :route, CAST(:parent AS uuid), :body, CAST(:lang AS text))
            """.trimIndent(),
            params { uuid("id", id); uuid("author", authorId); uuid("route", routeId); uuid("parent", parentId); str("body", body); str("lang", language) },
        )
    }

    fun updateBody(id: UUID, body: String) {
        jdbc.update("UPDATE comments SET body = :body, edited_at = now() WHERE id = :id", params { uuid("id", id); str("body", body) })
    }

    fun softDelete(id: UUID) {
        jdbc.update("UPDATE comments SET deleted_at = now() WHERE id = :id AND deleted_at IS NULL", params { uuid("id", id) })
    }
}

// ------------------------------------------------------------------- service

@Service
class CommentService(
    private val comments: CommentRepository,
    private val photos: PhotoRepository,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    fun listForRoute(routeId: UUID, cursor: String?, limit: Int): Page<Comment> {
        val caller = Caller.currentOrNull()
        requireRoute(routeId, caller)
        val after = Cursor.decode(cursor, 2)?.let { it[0] to Cursor.uuid(it[1]) }
        val rows = comments.listForRoute(routeId, caller?.isModerator == true, after, limit)
        val page = toPage(rows, limit, cursorOf = { listOf(it.createdAtText, it.id.toString()) }) { it }
        val photoMap = photos.forComments(page.items.filter { !it.deleted }.map { it.id }, caller?.userId, caller?.isModerator == true)
        return Page(page.items.map { toDto(it, photoMap[it.id].orEmpty()) }, page.nextCursor)
    }

    /** Returns the comment and whether it was created now (false = idempotent repeat of the same id). */
    @Transactional
    fun createForRoute(routeId: UUID, req: CommentCreate): Pair<Comment, Boolean> {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        requireRoute(routeId, caller)

        comments.find(req.id)?.let { existing ->
            if (existing.authorId == caller.userId && existing.routeId == routeId) return dto(existing, caller) to false
            throw conflict("conflict", "Объект с таким id уже существует")
        }

        val body = req.body.trim()
        validate {
            check(body.isNotEmpty() && body.length <= MAX_BODY, "body", "От 1 до $MAX_BODY символов")
            req.language?.let { check(LANG.matches(it), "language", "Код языка ISO 639-1") }
            check(req.photoIds.size <= MAX_PHOTOS, "photoIds", "Не больше $MAX_PHOTOS фото")
            check(req.photoIds.toSet().size == req.photoIds.size, "photoIds", "Фото указано дважды")
        }
        if (req.parentId != null) {
            val parent = comments.find(req.parentId)
            when {
                parent == null || parent.routeId != routeId || !parent.visible -> throw fieldError("parentId", "Комментарий не найден")
                parent.deleted -> throw fieldError("parentId", "Нельзя ответить на удалённый комментарий")
                parent.parentId != null -> throw fieldError("parentId", "Отвечать можно только на комментарий верхнего уровня")
            }
        }

        comments.insert(req.id, routeId, req.parentId, caller.userId, body, req.language)
        val rejected = photos.attachToComment(req.photoIds, req.id, routeId, caller.userId)
        if (rejected.isNotEmpty()) {
            // The transaction rolls back: no comment without the photos the author meant to attach.
            val i = req.photoIds.indexOf(rejected.first())
            throw fieldError("photoIds[$i]", "Фото не найдено среди ваших фото этого маршрута или уже прикреплено")
        }
        return dto(comments.find(req.id)!!, caller) to true
    }

    @Transactional
    fun update(id: UUID, req: CommentUpdate): Comment {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = comments.find(id)?.takeUnless { it.deleted } ?: throw notFound("Комментарий не найден")
        if (row.authorId != caller.userId) throw forbidden("Исправить комментарий может только автор")
        val body = req.body.trim()
        validate { check(body.isNotEmpty() && body.length <= MAX_BODY, "body", "От 1 до $MAX_BODY символов") }
        comments.updateBody(id, body)
        return dto(comments.find(id)!!, caller)
    }

    /** The author or a moderator; the photos of the comment go with it. */
    @Transactional
    fun delete(id: UUID) {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = comments.find(id) ?: throw notFound("Комментарий не найден")
        if (row.deleted) return
        if (row.authorId != caller.userId && !caller.isModerator) throw forbidden("Удалить комментарий может только автор")
        comments.softDelete(id)
        photos.softDeleteByComment(id)
        if (row.authorId != caller.userId) log.record(caller.userId, "delete_comment", "comment", id)
    }

    private fun dto(row: CommentRow, caller: Caller?): Comment =
        toDto(row, if (row.deleted) emptyList() else photos.forComments(listOf(row.id), caller?.userId, caller?.isModerator == true)[row.id].orEmpty())

    private fun toDto(row: CommentRow, photos: List<Photo>) = Comment(
        id = row.id,
        author = UserPublic(row.authorId, row.authorName, null),
        routeId = row.routeId,
        ascentId = row.ascentId,
        parentId = row.parentId,
        body = if (row.deleted) null else row.body,
        language = if (row.deleted) null else row.language,
        photos = if (row.deleted) emptyList() else photos,
        isDeleted = row.deleted,
        createdAt = row.createdAt,
        editedAt = if (row.deleted) null else row.editedAt,
    )

    private fun requireRoute(routeId: UUID, caller: Caller?) {
        val status = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
            .firstOrNull()
        if (status == null || (status == "hidden" && caller?.isModerator != true)) throw notFound("Маршрут не найден")
    }
}

// ------------------------------------------------------------------- controller

@RestController
class CommentController(private val service: CommentService) {

    @GetMapping("/routes/{routeId}/comments")
    fun list(
        @PathVariable routeId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.listForRoute(routeId, cursor, pageLimit(limit))

    @PostMapping("/routes/{routeId}/comments")
    fun create(@PathVariable routeId: UUID, @RequestBody body: CommentCreate): ResponseEntity<Comment> {
        val (comment, created) = service.createForRoute(routeId, body)
        return ResponseEntity.status(if (created) HttpStatus.CREATED else HttpStatus.OK).body(comment)
    }

    @PatchMapping("/comments/{commentId}")
    fun update(@PathVariable commentId: UUID, @RequestBody body: CommentUpdate) = service.update(commentId, body)

    @DeleteMapping("/comments/{commentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable commentId: UUID) = service.delete(commentId)
}
