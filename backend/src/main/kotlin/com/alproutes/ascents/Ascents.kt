package com.alproutes.ascents

import com.alproutes.auth.Caller
import com.alproutes.common.Cursor
import com.alproutes.common.Page
import com.alproutes.common.conflict
import com.alproutes.common.forbidden
import com.alproutes.common.intOrNull
import com.alproutes.common.notFound
import com.alproutes.common.odt
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
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonProperty
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.sql.ResultSet
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

// ------------------------------------------------------------------- DTOs (contract Ascent*)

data class AscentMember(
    val userId: UUID? = null,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    val user: UserPublic? = null,
    val name: String? = null,
    // Explicit names: Jackson would otherwise drop the "is" prefix of Kotlin booleans.
    @param:JsonProperty("isLeader") @get:JsonProperty("isLeader")
    val isLeader: Boolean = false,
)

/** AscentFields + id: the create body. PUT takes the same fields without id. */
data class AscentInput(
    val id: UUID? = null,
    val ascentDate: LocalDate,
    val datePrecision: String,
    val outcome: String? = null,
    val totalTimeMinutes: Int? = null,
    val conditions: String? = null,
    val report: String? = null,
    val language: String? = null,
    @param:JsonProperty("isPrivate") @get:JsonProperty("isPrivate")
    val isPrivate: Boolean = false,
    val members: List<AscentMember> = emptyList(),
)

data class Ascent(
    val id: UUID,
    val routeId: UUID,
    val user: UserPublic,
    val ascentDate: LocalDate,
    val datePrecision: String,
    val outcome: String?,
    val totalTimeMinutes: Int?,
    val conditions: String?,
    val report: String?,
    val language: String?,
    @get:JsonProperty("isPrivate")
    val isPrivate: Boolean,
    val members: List<AscentMember>,
    val photos: List<Photo>,
    val createdAt: OffsetDateTime,
    val updatedAt: OffsetDateTime,
)

private val PRECISIONS = setOf("day", "month", "year")
private val OUTCOMES = setOf("summit", "retreat")
private val LANG = Regex("^[a-z]{2}$")
private val EARLIEST = LocalDate.of(1850, 1, 1)

/** Old ascents are known to the month or year: stored as the first day of the period (schema CHECKs). */
internal fun normalizeDate(date: LocalDate, precision: String): LocalDate = when (precision) {
    "year" -> date.withDayOfYear(1)
    "month" -> date.withDayOfMonth(1)
    else -> date
}

private fun String?.clean(): String? = this?.trim()?.takeUnless { it.isEmpty() }

// ------------------------------------------------------------------- repository

internal data class AscentRow(val ascent: Ascent, val deleted: Boolean, val visible: Boolean)

@Repository
class AscentRepository(private val jdbc: NamedParameterJdbcTemplate) {

    private val select = """
        SELECT a.id, a.route_id, a.user_id, u.display_name AS user_name, a.ascent_date, a.date_precision, a.outcome,
               a.total_time_minutes, a.conditions, a.report, a.language, a.is_private, a.visibility = 'visible' AS visible,
               a.deleted_at IS NOT NULL AS deleted, a.created_at, a.updated_at
          FROM ascents a JOIN users u ON u.id = a.user_id
    """.trimIndent()

    private fun row(rs: ResultSet) = AscentRow(
        Ascent(
            id = rs.uuid("id"), routeId = rs.uuid("route_id"), user = UserPublic(rs.uuid("user_id"), rs.getString("user_name"), null),
            ascentDate = rs.getObject("ascent_date", LocalDate::class.java), datePrecision = rs.getString("date_precision"),
            outcome = rs.getString("outcome"), totalTimeMinutes = rs.intOrNull("total_time_minutes"),
            conditions = rs.getString("conditions"), report = rs.getString("report"), language = rs.getString("language"),
            isPrivate = rs.getBoolean("is_private"), members = emptyList(), photos = emptyList(),
            createdAt = rs.odt("created_at"), updatedAt = rs.odt("updated_at"),
        ),
        rs.getBoolean("deleted"), rs.getBoolean("visible"),
    )

    internal fun find(id: UUID): AscentRow? =
        jdbc.query("$select WHERE a.id = :id", params { uuid("id", id) }) { rs, _ -> row(rs) }.firstOrNull()

    /**
     * Newest ascent date first (ties: newest record). Others' records only when public and visible;
     * the caller's own private ones too; moderators also see hidden ones.
     */
    internal fun list(
        column: String, ownerId: UUID, callerId: UUID?, moderator: Boolean, after: Triple<String, String, UUID>?, limit: Int,
    ): List<AscentRow> {
        val where = mutableListOf("a.$column = :owner", "a.deleted_at IS NULL")
        where += if (callerId != null) "(NOT a.is_private OR a.user_id = CAST(:caller AS uuid))" else "NOT a.is_private"
        if (!moderator) where += "a.visibility = 'visible'"
        if (after != null) {
            where += "(a.ascent_date, a.created_at, a.id) < (CAST(:afterDate AS date), CAST(:afterCreated AS timestamptz), CAST(:afterId AS uuid))"
        }
        return jdbc.query(
            "$select WHERE ${where.joinToString(" AND ")} ORDER BY a.ascent_date DESC, a.created_at DESC, a.id DESC LIMIT :limit",
            params {
                uuid("owner", ownerId); uuid("caller", callerId)
                str("afterDate", after?.first); str("afterCreated", after?.second); uuid("afterId", after?.third); int("limit", limit + 1)
            },
        ) { rs, _ -> row(rs) }
    }

    fun members(ascentIds: Collection<UUID>): Map<UUID, List<AscentMember>> {
        if (ascentIds.isEmpty()) return emptyMap()
        return jdbc.query(
            """
            SELECT m.ascent_id, m.user_id, u.display_name, m.name, m.is_leader
              FROM ascent_members m LEFT JOIN users u ON u.id = m.user_id
             WHERE m.ascent_id IN (:ids)
             ORDER BY m.ascent_id, m.position
            """.trimIndent(),
            params { uuids("ids", ascentIds) },
        ) { rs, _ ->
            val userId = rs.uuidOrNull("user_id")
            rs.uuid("ascent_id") to AscentMember(
                userId = userId,
                user = userId?.let { UserPublic(it, rs.getString("display_name"), null) },
                name = rs.getString("name"),
                isLeader = rs.getBoolean("is_leader"),
            )
        }.groupBy({ it.first }, { it.second })
    }

    fun insert(id: UUID, routeId: UUID, userId: UUID, f: AscentInput) {
        jdbc.update(
            """
            INSERT INTO ascents (id, route_id, user_id, ascent_date, date_precision, outcome, total_time_minutes,
                                 conditions, report, language, is_private)
            VALUES (:id, :route, :user, CAST(:date AS date), :precision, CAST(:outcome AS text), CAST(:time AS int),
                    CAST(:conditions AS text), CAST(:report AS text), CAST(:lang AS text), :private)
            """.trimIndent(),
            fields(f).apply { uuid("id", id); uuid("route", routeId); uuid("user", userId) }.source,
        )
    }

    fun update(id: UUID, f: AscentInput) {
        jdbc.update(
            """
            UPDATE ascents
               SET ascent_date = CAST(:date AS date), date_precision = :precision, outcome = CAST(:outcome AS text),
                   total_time_minutes = CAST(:time AS int), conditions = CAST(:conditions AS text),
                   report = CAST(:report AS text), language = CAST(:lang AS text), is_private = :private
             WHERE id = :id
            """.trimIndent(),
            fields(f).apply { uuid("id", id) }.source,
        )
    }

    private fun fields(f: AscentInput) = com.alproutes.common.Params().apply {
        str("date", f.ascentDate.toString()); str("precision", f.datePrecision); str("outcome", f.outcome)
        int("time", f.totalTimeMinutes); str("conditions", f.conditions); str("report", f.report); str("lang", f.language)
        bool("private", f.isPrivate)
    }

    /** Members are replaced as a whole, like the record itself (PUT). */
    fun replaceMembers(id: UUID, members: List<AscentMember>) {
        jdbc.update("DELETE FROM ascent_members WHERE ascent_id = :id", params { uuid("id", id) })
        members.forEachIndexed { i, m ->
            jdbc.update(
                """
                INSERT INTO ascent_members (ascent_id, position, user_id, name, is_leader)
                VALUES (:id, :pos, CAST(:user AS uuid), CAST(:name AS text), :leader)
                """.trimIndent(),
                params { uuid("id", id); int("pos", i); uuid("user", m.userId); str("name", m.name); bool("leader", m.isLeader) },
            )
        }
    }

    fun softDelete(id: UUID) {
        jdbc.update("UPDATE ascents SET deleted_at = now() WHERE id = :id AND deleted_at IS NULL", params { uuid("id", id) })
    }
}

// ------------------------------------------------------------------- service

@Service
class AscentService(
    private val ascents: AscentRepository,
    private val photos: PhotoRepository,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    fun listForRoute(routeId: UUID, cursor: String?, limit: Int): Page<Ascent> {
        val caller = Caller.currentOrNull()
        requireRoute(routeId, caller)
        return page("route_id", routeId, caller, cursor, limit)
    }

    fun listForUser(userId: UUID, cursor: String?, limit: Int): Page<Ascent> {
        val caller = Caller.currentOrNull()
        if (users.findById(userId) == null) throw notFound("Пользователь не найден")
        return page("user_id", userId, caller, cursor, limit)
    }

    fun get(id: UUID): Ascent {
        val caller = Caller.currentOrNull()
        val row = visibleRow(id, caller)
        return full(listOf(row.ascent), caller).first()
    }

    /** Returns the record and whether it was created now (false = idempotent repeat of the same id). */
    @Transactional
    fun create(routeId: UUID, req: AscentInput): Pair<Ascent, Boolean> {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        requireRoute(routeId, caller)
        val id = req.id ?: throw com.alproutes.common.fieldError("id", "Обязательное поле")
        ascents.find(id)?.let { existing ->
            if (existing.ascent.user.id == caller.userId && existing.ascent.routeId == routeId && !existing.deleted) {
                return full(listOf(existing.ascent), caller).first() to false
            }
            throw conflict("conflict", "Объект с таким id уже существует")
        }
        val fields = validated(req)
        ascents.insert(id, routeId, caller.userId, fields)
        ascents.replaceMembers(id, fields.members)
        return get(id) to true
    }

    @Transactional
    fun update(id: UUID, req: AscentInput): Ascent {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = ascents.find(id)?.takeUnless { it.deleted } ?: throw notFound("Запись не найдена")
        if (row.ascent.user.id != caller.userId) {
            if (row.ascent.isPrivate) throw notFound("Запись не найдена")
            throw forbidden("Изменить запись может только автор")
        }
        val fields = validated(req)
        ascents.update(id, fields)
        ascents.replaceMembers(id, fields.members)
        return get(id)
    }

    /** The author or a moderator; the photos of the record go with it. */
    @Transactional
    fun delete(id: UUID) {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        val row = ascents.find(id) ?: throw notFound("Запись не найдена")
        if (row.deleted) return
        val own = row.ascent.user.id == caller.userId
        if (!own && row.ascent.isPrivate && !caller.isModerator) throw notFound("Запись не найдена")
        if (!own && !caller.isModerator) throw forbidden("Удалить запись может только автор")
        ascents.softDelete(id)
        photos.softDeleteByAscent(id)
        if (!own) log.record(caller.userId, "delete_ascent", "ascent", id)
    }

    // ----------------------------------------------------------------- helpers

    private fun page(column: String, ownerId: UUID, caller: Caller?, cursor: String?, limit: Int): Page<Ascent> {
        val after = Cursor.decode(cursor, 3)?.let { Triple(it[0], it[1], Cursor.uuid(it[2])) }
        val rows = ascents.list(column, ownerId, caller?.userId, caller?.isModerator == true, after, limit)
        val page = toPage(rows, limit, cursorOf = {
            listOf(it.ascent.ascentDate.toString(), it.ascent.createdAt.toString(), it.ascent.id.toString())
        }) { it.ascent }
        return Page(full(page.items, caller), page.nextCursor)
    }

    private fun full(items: List<Ascent>, caller: Caller?): List<Ascent> {
        val ids = items.map { it.id }
        val members = ascents.members(ids)
        val photoMap = photos.forAscents(ids, caller?.userId, caller?.isModerator == true)
        return items.map { it.copy(members = members[it.id].orEmpty(), photos = photoMap[it.id].orEmpty()) }
    }

    private fun visibleRow(id: UUID, caller: Caller?): AscentRow {
        val row = ascents.find(id) ?: throw notFound("Запись не найдена")
        val own = caller != null && row.ascent.user.id == caller.userId
        // A private record is the author's only (contract): not even moderators read it.
        val visible = !row.deleted && (own || (!row.ascent.isPrivate && (row.visible || caller?.isModerator == true)))
        if (!visible) throw notFound("Запись не найдена")
        return row
    }

    private fun validated(req: AscentInput): AscentInput {
        val today = LocalDate.now(ZoneOffset.ofHours(14)) // the date line's far side: "today" somewhere on Earth
        val conditions = req.conditions.clean()
        val report = req.report.clean()
        val members = req.members.map { it.copy(name = it.name.clean(), user = null) }
        validate {
            check(req.datePrecision in PRECISIONS, "datePrecision", "Допустимые значения: day, month, year")
            check(!req.ascentDate.isAfter(today), "ascentDate", "Дата восхождения не может быть в будущем")
            check(!req.ascentDate.isBefore(EARLIEST), "ascentDate", "Не раньше 1850 года")
            req.outcome?.let { check(it in OUTCOMES, "outcome", "Допустимые значения: summit, retreat") }
            req.totalTimeMinutes?.let { check(it in 1..(60 * 24 * 60), "totalTimeMinutes", "От 1 минуты до 60 суток") }
            conditions?.let { check(it.length <= 5000, "conditions", "До 5000 символов") }
            report?.let { check(it.length <= 20000, "report", "До 20 000 символов") }
            req.language?.let { check(LANG.matches(it), "language", "Код языка ISO 639-1") }
            check(members.size <= 30, "members", "Не больше 30 участников")
            val userIds = mutableSetOf<UUID>()
            members.forEachIndexed { i, m ->
                check(m.userId != null || m.name != null, "members[$i]", "Укажите имя или пользователя")
                m.name?.let { check(it.length <= 200, "members[$i].name", "До 200 символов") }
                m.userId?.let {
                    check(userIds.add(it), "members[$i].userId", "Участник указан дважды")
                    check(users.findById(it) != null, "members[$i].userId", "Пользователь не найден")
                }
            }
        }
        return req.copy(
            ascentDate = normalizeDate(req.ascentDate, req.datePrecision),
            conditions = conditions, report = report, members = members,
        )
    }

    private fun requireRoute(routeId: UUID, caller: Caller?) {
        val status = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
            .firstOrNull()
        if (status == null || (status == "hidden" && caller?.isModerator != true)) throw notFound("Маршрут не найден")
    }
}

// ------------------------------------------------------------------- controller

@RestController
class AscentController(private val service: AscentService) {

    @GetMapping("/routes/{routeId}/ascents")
    fun listForRoute(
        @PathVariable routeId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.listForRoute(routeId, cursor, pageLimit(limit))

    @PostMapping("/routes/{routeId}/ascents")
    fun create(@PathVariable routeId: UUID, @RequestBody body: AscentInput): ResponseEntity<Ascent> {
        val (ascent, created) = service.create(routeId, body)
        return ResponseEntity.status(if (created) HttpStatus.CREATED else HttpStatus.OK).body(ascent)
    }

    @GetMapping("/ascents/{ascentId}")
    fun get(@PathVariable ascentId: UUID) = service.get(ascentId)

    @PutMapping("/ascents/{ascentId}")
    fun update(@PathVariable ascentId: UUID, @RequestBody body: AscentInput) = service.update(ascentId, body.copy(id = null))

    @DeleteMapping("/ascents/{ascentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable ascentId: UUID) = service.delete(ascentId)

    @GetMapping("/users/{userId}/ascents")
    fun listForUser(
        @PathVariable userId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.listForUser(userId, cursor, pageLimit(limit))
}
