package com.alproutes.users

import com.alproutes.auth.Caller
import com.alproutes.common.Wire
import com.alproutes.common.forbidden
import com.alproutes.common.notFound
import com.alproutes.common.params
import com.alproutes.common.uuid
import com.alproutes.common.validate
import com.alproutes.common.wireOf
import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.jdbc.core.RowMapper
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

enum class UserRole(@get:JsonValue override val wire: String) : Wire {
    USER("user"), MODERATOR("moderator"), ADMIN("admin")
}

enum class UserStatus(@get:JsonValue override val wire: String) : Wire {
    ACTIVE("active"), BLOCKED("blocked"), DELETED("deleted")
}

data class UserRow(
    val id: UUID,
    val email: String?,
    val displayName: String,
    val avatarKey: String?,
    val locale: String,
    val role: UserRole,
    val status: UserStatus,
)

// ---- DTOs (contract: UserPublic, User, UserUpdate)

data class UserPublic(val id: UUID, val displayName: String, val avatarUrl: String?)

data class UserDto(
    val id: UUID,
    val displayName: String,
    val avatarUrl: String?,
    val email: String?,
    val locale: String,
    val role: UserRole,
)

data class UserUpdate(val displayName: String? = null, val locale: String? = null)

// Avatars become downloadable with the media work of step 4; until then there is no URL.
fun UserRow.toPublic() = UserPublic(id, displayName, avatarUrl = null)
fun UserRow.toDto() = UserDto(id, displayName, avatarUrl = null, email = email, locale = locale, role = role)

@Repository
class UserRepository(private val jdbc: NamedParameterJdbcTemplate) {

    private val mapper = RowMapper { rs, _ ->
        UserRow(
            id = rs.uuid("id"),
            email = rs.getString("email"),
            displayName = rs.getString("display_name"),
            avatarKey = rs.getString("avatar_key"),
            locale = rs.getString("locale"),
            role = wireOf(rs.getString("role")),
            status = wireOf(rs.getString("status")),
        )
    }

    private val columns = "id, email::text AS email, display_name, avatar_key, locale, role, status"

    fun findById(id: UUID): UserRow? =
        jdbc.query("SELECT $columns FROM users WHERE id = :id", params { uuid("id", id) }, mapper).firstOrNull()

    fun findByEmail(email: String): UserRow? =
        jdbc.query("SELECT $columns FROM users WHERE email = CAST(:email AS citext)", params { str("email", email) }, mapper)
            .firstOrNull()

    fun insert(email: String?, displayName: String, role: UserRole = UserRole.USER): UserRow {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO users (id, email, display_name, role)
            VALUES (:id, CAST(:email AS citext), :name, :role)
            """.trimIndent(),
            params { uuid("id", id); str("email", email); str("name", displayName.take(100)); str("role", role.wire) },
        )
        return findById(id)!!
    }

    fun updateRole(id: UUID, role: UserRole) {
        jdbc.update("UPDATE users SET role = :role WHERE id = :id", params { uuid("id", id); str("role", role.wire) })
    }

    fun updateProfile(id: UUID, displayName: String?, locale: String?) {
        jdbc.update(
            """
            UPDATE users
               SET display_name = COALESCE(CAST(:name AS text), display_name),
                   locale = COALESCE(CAST(:locale AS text), locale)
             WHERE id = :id
            """.trimIndent(),
            params { uuid("id", id); str("name", displayName); str("locale", locale) },
        )
    }

    /** Loads the caller and refuses writes from blocked or deleted accounts (their access token may still be valid). */
    fun requireActive(id: UUID): UserRow {
        val user = findById(id) ?: throw forbidden("Учётная запись не найдена")
        if (user.status != UserStatus.ACTIVE) throw forbidden("Учётная запись заблокирована")
        return user
    }

    fun publicById(ids: Collection<UUID>): Map<UUID, UserPublic> {
        if (ids.isEmpty()) return emptyMap()
        return jdbc.query("SELECT $columns FROM users WHERE id IN (:ids)", params { uuids("ids", ids.toSet()) }, mapper)
            .associate { it.id to it.toPublic() }
    }
}

@RestController
class UsersController(private val users: UserRepository) {

    @GetMapping("/me")
    fun me(): UserDto = (users.findById(Caller.current().userId) ?: throw notFound("Пользователь не найден")).toDto()

    @PatchMapping("/me")
    @Transactional
    fun updateMe(@RequestBody body: UserUpdate): UserDto {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        validate {
            body.displayName?.let { check(it.isNotBlank() && it.length <= 100, "displayName", "От 1 до 100 символов") }
            body.locale?.let { check(Regex("^[a-z]{2}$").matches(it), "locale", "Код языка ISO 639-1") }
        }
        users.updateProfile(caller.userId, body.displayName?.trim(), body.locale)
        return users.findById(caller.userId)!!.toDto()
    }

    @GetMapping("/users/{userId}")
    fun user(@PathVariable userId: UUID): UserPublic {
        val user = users.findById(userId) ?: throw notFound("Пользователь не найден")
        if (user.status == UserStatus.DELETED) throw notFound("Пользователь не найден")
        return user.toPublic()
    }
}
