package com.alproutes.auth

import com.alproutes.common.forbidden
import com.alproutes.common.notFound
import com.alproutes.common.params
import com.alproutes.common.uuid
import com.alproutes.common.validate
import com.alproutes.users.UserRepository
import com.alproutes.users.UserRole
import com.alproutes.users.UserRow
import com.alproutes.users.UserStatus
import org.springframework.context.annotation.Profile
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

data class OAuthLoginRequest(val idToken: String, val nonce: String? = null, val displayName: String? = null)
data class RefreshRequest(val refreshToken: String)
data class DevLoginRequest(val email: String, val displayName: String? = null, val role: UserRole? = null)

@Service
class AuthService(
    private val verifier: OAuthVerifier,
    private val users: UserRepository,
    private val tokens: TokenService,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    /**
     * An identity (provider + subject) maps to one user. A new identity is linked to an existing
     * user only by an email the provider has VERIFIED; otherwise a separate user is created.
     */
    @Transactional
    fun login(provider: OAuthProvider, req: OAuthLoginRequest, userAgent: String?): TokenPair {
        val identity = verifier.verify(provider, req.idToken, req.nonce)
        val existing = jdbc.query(
            "SELECT user_id FROM user_identities WHERE provider = :p AND subject = :s",
            params { str("p", provider.wire); str("s", identity.subject) },
        ) { rs, _ -> rs.uuid("user_id") }.firstOrNull()

        val user: UserRow = if (existing != null) {
            users.findById(existing)!!
        } else {
            val verifiedEmail = identity.email?.takeIf { identity.emailVerified }
            val linked = verifiedEmail?.let { users.findByEmail(it) }
            val u = linked ?: users.insert(
                email = verifiedEmail,
                displayName = req.displayName?.trim()?.takeIf { it.isNotEmpty() }
                    ?: identity.name?.takeIf { it.isNotBlank() }
                    ?: identity.email?.substringBefore('@')
                    ?: "Альпинист",
            )
            jdbc.update(
                "INSERT INTO user_identities (user_id, provider, subject, email) VALUES (:u, :p, :s, CAST(:e AS citext))",
                params { uuid("u", u.id); str("p", provider.wire); str("s", identity.subject); str("e", identity.email) },
            )
            u
        }
        if (user.status != UserStatus.ACTIVE) throw forbidden("Учётная запись заблокирована")
        jdbc.update(
            "UPDATE user_identities SET last_login_at = now() WHERE provider = :p AND subject = :s",
            params { str("p", provider.wire); str("s", identity.subject) },
        )
        return tokens.issue(user, userAgent)
    }

    @Transactional
    fun devLogin(req: DevLoginRequest, userAgent: String?): TokenPair {
        validate {
            check(req.email.contains('@') && req.email.length <= 254, "email", "Некорректный email")
            req.displayName?.let { check(it.isNotBlank() && it.length <= 100, "displayName", "От 1 до 100 символов") }
        }
        var user = users.findByEmail(req.email) ?: users.insert(req.email, req.displayName ?: req.email.substringBefore('@'))
        if (req.role != null && req.role != user.role) {
            users.updateRole(user.id, req.role)
            user = users.findById(user.id)!!
        }
        return tokens.issue(user, userAgent)
    }
}

@RestController
class AuthController(private val auth: AuthService, private val tokens: TokenService) {

    @PostMapping("/auth/oauth/{provider}")
    fun oauth(
        @PathVariable provider: String,
        @RequestBody body: OAuthLoginRequest,
        @RequestHeader("User-Agent", required = false) userAgent: String?,
    ): TokenPair {
        val p = OAuthProvider.entries.firstOrNull { it.wire == provider } ?: throw notFound("Неизвестный провайдер")
        return auth.login(p, body, userAgent)
    }

    @PostMapping("/auth/refresh")
    fun refresh(@RequestBody body: RefreshRequest, @RequestHeader("User-Agent", required = false) userAgent: String?) =
        tokens.refresh(body.refreshToken, userAgent)

    @PostMapping("/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun logout(@RequestBody body: RefreshRequest) = tokens.revoke(body.refreshToken)
}

/** Registered ONLY with the `dev` profile: in any other environment the path does not exist (404). */
@RestController
@Profile("dev")
class DevAuthController(private val auth: AuthService) {

    @PostMapping("/auth/dev-login")
    fun devLogin(@RequestBody body: DevLoginRequest, @RequestHeader("User-Agent", required = false) userAgent: String?) =
        auth.devLogin(body, userAgent)
}
