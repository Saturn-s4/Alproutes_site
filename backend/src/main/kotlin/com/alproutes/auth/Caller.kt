package com.alproutes.auth

import com.alproutes.common.unauthorized
import com.alproutes.users.UserRole
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken
import java.util.UUID

/** The authenticated user of the current request, taken from the access token. */
data class Caller(val userId: UUID, val roles: Set<UserRole>) {
    val isModerator: Boolean get() = UserRole.MODERATOR in roles || UserRole.ADMIN in roles

    companion object {
        fun currentOrNull(): Caller? {
            val auth = SecurityContextHolder.getContext().authentication as? JwtAuthenticationToken ?: return null
            val jwt = auth.token
            return Caller(UUID.fromString(jwt.subject), rolesOf(jwt))
        }

        fun current(): Caller = currentOrNull() ?: throw unauthorized()
    }
}

/** Access token claim "roles" (list of role codes); unknown codes are ignored. */
fun rolesOf(jwt: Jwt): Set<UserRole> =
    jwt.getClaimAsStringList("roles").orEmpty()
        .mapNotNullTo(mutableSetOf()) { code -> UserRole.entries.firstOrNull { it.wire == code } }
