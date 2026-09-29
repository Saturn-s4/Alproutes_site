package com.alproutes.auth

import com.alproutes.common.unauthorized
import com.alproutes.users.UserRole
import com.alproutes.common.wireOf
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken
import java.util.UUID

/** The authenticated user of the current request, taken from the access token. */
data class Caller(val userId: UUID, val role: UserRole) {
    val isModerator: Boolean get() = role == UserRole.MODERATOR || role == UserRole.ADMIN

    companion object {
        fun currentOrNull(): Caller? {
            val auth = SecurityContextHolder.getContext().authentication as? JwtAuthenticationToken ?: return null
            val jwt = auth.token
            return Caller(UUID.fromString(jwt.subject), wireOf(jwt.getClaimAsString("role") ?: "user"))
        }

        fun current(): Caller = currentOrNull() ?: throw unauthorized()
    }
}
