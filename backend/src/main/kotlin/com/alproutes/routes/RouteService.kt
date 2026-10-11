package com.alproutes.routes

import com.alproutes.areas.AreaRef
import com.alproutes.areas.AreaRepository
import com.alproutes.areas.ContentStatus
import com.alproutes.auth.Caller
import com.alproutes.common.Cursor
import com.alproutes.common.Page
import com.alproutes.common.Slugs
import com.alproutes.common.conflict
import com.alproutes.common.fieldError
import com.alproutes.common.forbidden
import com.alproutes.common.localized
import com.alproutes.common.notFound
import com.alproutes.common.odt
import com.alproutes.common.odtOrNull
import com.alproutes.common.params
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.validate
import com.alproutes.common.wireOf
import com.alproutes.moderation.ModerationLog
import com.alproutes.photos.PhotoRepository
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Service
class RouteService(
    private val routes: RouteRepository,
    private val validator: RouteContentValidator,
    private val areas: AreaRepository,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val photos: PhotoRepository,
    private val jdbc: NamedParameterJdbcTemplate,
    private val mapper: ObjectMapper,
) {
    // ------------------------------------------------------------------ writes

    /** New route = route row (draft) + revision 1 (pending), or published at once when a moderator asks. */
    @Transactional
    fun create(req: RouteCreate): RouteRevision {
        val caller = activeCaller()
        if (req.publish && !caller.isModerator) throw forbidden("Сразу публиковать могут только модераторы")
        validateSummary(req.changeSummary)
        validator.validate(req.content, routeId = null, authorId = caller.userId)

        val slug = if (req.slug != null) {
            validate {
                check(Slugs.PATTERN.matches(req.slug) && req.slug.length <= Slugs.MAX_LENGTH, "slug",
                    "Строчные латинские буквы, цифры и дефисы, до ${Slugs.MAX_LENGTH} символов")
            }
            if (routes.routeIdBySlug(req.slug) != null) throw conflict("slug-taken", "Slug «${req.slug}» уже занят")
            req.slug
        } else {
            uniqueSlug(req.content.name)
        }

        val routeId = UUID.randomUUID()
        val revisionId = UUID.randomUUID()
        routes.insertRoute(routeId, slug, caller.userId)
        // Before the revision: its photo rows must already belong to the route (route_revision_photos check).
        photos.attachToRoute(req.content.photos.map { it.photoId }, routeId, caller.userId)
        routes.insertRevision(revisionId, routeId, 1, null, null, caller.userId, req.changeSummary, req.content)
        if (req.publish) {
            routes.publish(routeId, revisionId, null, caller.userId, null)
            log.record(caller.userId, "self_approve_revision", "route_revision", revisionId)
        }
        return routes.revision(revisionId)!!
    }

    /**
     * An edit is a full snapshot based on [RouteRevisionCreate.baseRevisionId]. The base must be the
     * current published revision (or the latest one while the route has never been published);
     * otherwise someone else changed the route in between and the author must merge by hand.
     */
    @Transactional
    fun propose(routeId: UUID, req: RouteRevisionCreate): RouteRevision {
        val caller = activeCaller()
        if (req.publish && !caller.isModerator) throw forbidden("Сразу публиковать могут только модераторы")
        val lock = routes.lockRoute(routeId) ?: throw notFound("Маршрут не найден")
        if (lock.status == "hidden" && !caller.isModerator) throw notFound("Маршрут не найден")
        val expectedBase = lock.currentRevisionId ?: lock.latestRevisionId
        if (req.baseRevisionId != expectedBase) {
            throw conflict("revision-conflict", "Маршрут изменён после начала редактирования", currentRevisionId = expectedBase)
        }
        validateSummary(req.changeSummary)
        validator.validate(req.content, routeId)

        val revisionId = UUID.randomUUID()
        routes.insertRevision(revisionId, routeId, lock.maxRevision + 1, req.baseRevisionId, null, caller.userId, req.changeSummary, req.content)
        if (req.publish) {
            routes.publish(routeId, revisionId, lock.currentRevisionId, caller.userId, null)
            log.record(caller.userId, "self_approve_revision", "route_revision", revisionId)
        }
        return routes.revision(revisionId)!!
    }

    @Transactional
    fun approve(revisionId: UUID, note: String?): RouteRevision {
        val caller = moderator()
        validateNote(note, required = false)
        val rev = routes.revisionState(revisionId, forUpdate = true) ?: throw notFound("Ревизия не найдена")
        val lock = routes.lockRoute(rev.routeId)!!
        if (rev.status != ReviewStatus.PENDING) throw conflict("invalid-state", "Ревизия уже рассмотрена")
        // Approving an edit based on an outdated snapshot would silently discard the changes made since.
        if (lock.currentRevisionId != null && rev.baseRevisionId != lock.currentRevisionId) {
            throw conflict("revision-stale", "После создания правки опубликована другая ревизия", currentRevisionId = lock.currentRevisionId)
        }
        routes.publish(rev.routeId, revisionId, lock.currentRevisionId, caller.userId, note)
        log.record(caller.userId, "approve_revision", "route_revision", revisionId, note)
        return routes.revision(revisionId)!!
    }

    @Transactional
    fun reject(revisionId: UUID, note: String?): RouteRevision {
        val caller = moderator()
        validateNote(note, required = true)
        val rev = routes.revisionState(revisionId, forUpdate = true) ?: throw notFound("Ревизия не найдена")
        if (rev.status != ReviewStatus.PENDING) throw conflict("invalid-state", "Ревизия уже рассмотрена")
        routes.reject(revisionId, caller.userId, note!!)
        log.record(caller.userId, "reject_revision", "route_revision", revisionId, note)
        return routes.revision(revisionId)!!
    }

    /** Restores an older approved snapshot as a NEW revision and publishes it. History is never rewritten. */
    @Transactional
    fun revert(targetRevisionId: UUID, note: String?): RouteRevision {
        val caller = moderator()
        validateNote(note, required = true)
        val target = routes.revisionState(targetRevisionId, forUpdate = false) ?: throw notFound("Ревизия не найдена")
        val lock = routes.lockRoute(target.routeId)!!
        if (target.status != ReviewStatus.APPROVED) throw conflict("invalid-state", "Откатить можно только к одобренной ревизии")
        if (target.id == lock.currentRevisionId) throw conflict("invalid-state", "Эта ревизия и так текущая")

        val newId = UUID.randomUUID()
        routes.copyRevision(
            fromRevision = target.id, toRevision = newId, routeId = target.routeId, number = lock.maxRevision + 1,
            baseRevisionId = lock.currentRevisionId, authorId = caller.userId,
            summary = "Откат к ревизии ${target.revisionNumber}",
        )
        routes.publish(target.routeId, newId, lock.currentRevisionId, caller.userId, note)
        log.record(caller.userId, "revert_revision", "route_revision", newId, note, mapOf("revertedTo" to target.id.toString()))
        return routes.revision(newId)!!
    }

    // ------------------------------------------------------------------- reads

    fun detail(routeId: UUID?, slug: String?): RouteDetail {
        val caller = Caller.currentOrNull()
        val id = routeId ?: routes.routeIdBySlug(slug!!) ?: throw notFound("Маршрут не найден")
        val row = jdbc.query(
            """
            SELECT r.id, r.slug, r.status, r.updated_at,
                   rv.id AS revision_id, rv.revision_number, rv.reviewed_at, ${routes.contentColumns},
                   a.slug AS area_slug, a.type AS area_type, a.name::text AS area_name
              FROM routes r
              JOIN route_revisions rv ON rv.route_id = r.id AND rv.is_current
              JOIN areas a ON a.id = rv.area_id
             WHERE r.id = :id
            """.trimIndent(),
            params { uuid("id", id) },
        ) { rs, _ ->
            val content = routes.contentBase(rs)
            DetailRow(
                id = rs.uuid("id"),
                slug = rs.getString("slug"),
                status = wireOf(rs.getString("status")),
                updatedAt = rs.odt("updated_at"),
                revision = RouteRevisionRef(rs.uuid("revision_id"), rs.getInt("revision_number"), rs.odtOrNull("reviewed_at")),
                content = content,
                area = AreaRef(content.areaId, rs.getString("area_slug"), wireOf(rs.getString("area_type")),
                    mapper.localized(rs.getString("area_name"))!!),
            )
        }.firstOrNull() ?: throw notFound("Маршрут не найден")   // draft: nothing published yet
        if (row.status == ContentStatus.HIDDEN && caller?.isModerator != true) throw notFound("Маршрут не найден")

        val content = routes.attachChildren(row.revision.id, row.content)
        return RouteDetail(
            content = content,
            id = row.id,
            slug = row.slug,
            status = row.status,
            area = row.area,
            areaPath = areas.ancestors(row.area.id, includeSelf = true),
            currentRevision = row.revision,
            descriptionPhotos = photos.publicByIds(content.photos.map { it.photoId }),
            stats = stats(row.id),
            updatedAt = row.updatedAt,
        )
    }

    fun revision(revisionId: UUID): RouteRevision {
        val caller = Caller.currentOrNull()
        val rev = routes.revision(revisionId) ?: throw notFound("Ревизия не найдена")
        val visible = caller?.isModerator == true ||
            (rev.summary.status == ReviewStatus.APPROVED && routes.routeStatus(rev.summary.routeId) != "hidden") ||
            rev.summary.author.id == caller?.userId
        if (!visible) throw notFound("Ревизия не найдена")
        return rev
    }

    fun revisions(routeId: UUID, status: String?, cursor: String?, limit: Int): Page<RouteRevisionSummary> {
        val caller = Caller.currentOrNull()
        val routeStatus = routes.routeStatus(routeId) ?: throw notFound("Маршрут не найден")
        if (routeStatus == "hidden" && caller?.isModerator != true) throw notFound("Маршрут не найден")
        val after = Cursor.decode(cursor, 1)?.get(0)?.let { it.toIntOrNull() ?: throw fieldError("cursor", "Некорректный курсор") }
        val rows = routes.revisions(
            routeId, status?.let { com.alproutes.common.parseWire<ReviewStatus>(it, "status") },
            moderator = caller?.isModerator == true, callerId = caller?.userId, afterNumber = after, limit = limit,
        )
        return toPage(rows, limit, cursorOf = { listOf(it.revisionNumber.toString()) }) { it }
    }

    fun pending(cursor: String?, limit: Int): Page<RouteRevisionSummary> {
        moderator()
        val c = Cursor.decode(cursor, 2)
        val rows = routes.pending(c?.get(0), c?.get(1)?.let { Cursor.uuid(it) }, limit)
        return toPage(rows, limit, cursorOf = { listOf(routes.createdAtText(it.id), it.id.toString()) }) { it }
    }

    // ----------------------------------------------------------------- helpers

    private data class DetailRow(
        val id: UUID,
        val slug: String,
        val status: ContentStatus,
        val updatedAt: java.time.OffsetDateTime,
        val revision: RouteRevisionRef,
        val content: RouteContent,
        val area: AreaRef,
    )

    private fun stats(routeId: UUID): RouteStats = jdbc.query(
        """
        SELECT
          (SELECT count(*) FROM photos    WHERE route_id = :id AND deleted_at IS NULL AND visibility = 'visible') AS photos,
          (SELECT count(*) FROM tracks    WHERE route_id = :id AND deleted_at IS NULL AND visibility = 'visible') AS tracks,
          (SELECT count(*) FROM ascents   WHERE route_id = :id AND deleted_at IS NULL AND visibility = 'visible' AND NOT is_private) AS ascents,
          (SELECT count(*) FROM comments  WHERE route_id = :id AND deleted_at IS NULL AND visibility = 'visible') AS comments,
          (SELECT count(*) FROM documents WHERE route_id = :id AND deleted_at IS NULL AND visibility = 'visible') AS documents
        """.trimIndent(),
        params { uuid("id", routeId) },
    ) { rs, _ ->
        RouteStats(rs.getInt("photos"), rs.getInt("tracks"), rs.getInt("ascents"), rs.getInt("comments"), rs.getInt("documents"))
    }.first()

    private fun uniqueSlug(name: Map<String, String>): String {
        val base = Slugs.fromText(name["ru"] ?: name["en"] ?: name.values.first())
        val taken = routes.slugsStartingWith(base)
        if (base !in taken) return base
        return (2..10_000).asSequence().map { "$base-$it" }.first { it !in taken }
    }

    private fun activeCaller(): Caller {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        return caller
    }

    private fun moderator(): Caller {
        val caller = activeCaller()
        if (!caller.isModerator) throw forbidden("Действие доступно модераторам")
        return caller
    }

    private fun validateSummary(summary: String?) = validate {
        summary?.let { check(it.length <= 500, "changeSummary", "Не длиннее 500 символов") }
    }

    private fun validateNote(note: String?, required: Boolean) = validate {
        check(!required || !note.isNullOrBlank(), "note", "Укажите причину")
        note?.let { check(it.length <= 2000, "note", "Не длиннее 2000 символов") }
    }
}
