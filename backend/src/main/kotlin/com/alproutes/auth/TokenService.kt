package com.alproutes.auth

import com.alproutes.common.ApiException
import com.alproutes.common.odt
import com.alproutes.common.odtOrNull
import com.alproutes.common.params
import com.alproutes.common.unauthorized
import com.alproutes.common.uuid
import com.alproutes.config.AccessTokenKey
import com.alproutes.config.AppProperties
import com.alproutes.users.UserDto
import com.alproutes.users.UserRepository
import com.alproutes.users.UserRow
import com.alproutes.users.UserStatus
import com.alproutes.users.toDto
import com.nimbusds.jose.jwk.source.ImmutableSecret
import com.nimbusds.jose.proc.SecurityContext
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID

data class TokenPair(
    val accessToken: String,
    val accessTokenExpiresAt: OffsetDateTime,
    val refreshToken: String,
    val refreshTokenExpiresAt: OffsetDateTime,
    val user: UserDto,
)

/**
 * Access tokens: short-lived HS256 JWTs (sub = user id, role claim).
 * Refresh tokens: opaque random strings, only their SHA-256 is stored; rotated on every use.
 */
@Service
class TokenService(
    key: AccessTokenKey,
    private val props: AppProperties,
    private val jdbc: NamedParameterJdbcTemplate,
    private val users: UserRepository,
) {
    private val encoder = NimbusJwtEncoder(ImmutableSecret<SecurityContext>(key.key))
    private val random = SecureRandom()

    /** Two parallel refreshes from one client: the loser gets 401 but must not kill the session. */
    private val reuseGrace = Duration.ofSeconds(30)

    @Transactional
    fun issue(user: UserRow, userAgent: String?, familyId: UUID = UUID.randomUUID()): TokenPair {
        val now = Instant.now()
        val accessExpires = now.plus(props.auth.accessTokenTtl)
        val claims = JwtClaimsSet.builder()
            .issuer(props.auth.issuer)
            .subject(user.id.toString())
            .issuedAt(now)
            .expiresAt(accessExpires)
            .claim("role", user.role.wire)
            .build()
        val access = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).tokenValue

        val refresh = newRefreshToken()
        val refreshExpires = now.plus(props.auth.refreshTokenTtl)
        jdbc.update(
            """
            INSERT INTO refresh_tokens (user_id, family_id, token_hash, user_agent, expires_at)
            VALUES (:user, :family, :hash, CAST(:ua AS text), CAST(:expires AS timestamptz))
            """.trimIndent(),
            params {
                uuid("user", user.id); uuid("family", familyId)
                str("ua", userAgent?.take(500)); str("expires", refreshExpires.toString())
            }.addValue("hash", sha256(refresh)),
        )
        return TokenPair(access, accessExpires.atOffset(ZoneOffset.UTC), refresh, refreshExpires.atOffset(ZoneOffset.UTC), user.toDto())
    }

    // noRollbackFor: revoking a stolen token family must be committed even though we answer 401.
    @Transactional(noRollbackFor = [ApiException::class])
    fun refresh(refreshToken: String, userAgent: String?): TokenPair {
        val row = jdbc.query(
            """
            SELECT id, user_id, family_id, expires_at, revoked_at
              FROM refresh_tokens
             WHERE token_hash = :hash
               FOR UPDATE
            """.trimIndent(),
            params { }.addValue("hash", sha256(refreshToken)),
        ) { rs, _ ->
            StoredToken(rs.uuid("id"), rs.uuid("user_id"), rs.uuid("family_id"), rs.odt("expires_at"), rs.odtOrNull("revoked_at"))
        }.firstOrNull() ?: throw unauthorized("Недействительный refresh token")

        val now = OffsetDateTime.now()
        if (row.revokedAt != null) {
            if (row.revokedAt.isAfter(now.minus(reuseGrace))) throw unauthorized("Токен уже обновлён")
            // Reuse of a rotated token long after rotation: treat as theft, end the whole session chain.
            jdbc.update(
                "UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = :family AND revoked_at IS NULL",
                params { uuid("family", row.familyId) },
            )
            throw unauthorized("Недействительный refresh token")
        }
        if (row.expiresAt.isBefore(now)) throw unauthorized("Срок refresh token истёк")

        val user = users.findById(row.userId) ?: throw unauthorized()
        if (user.status != UserStatus.ACTIVE) throw unauthorized("Учётная запись заблокирована")

        jdbc.update("UPDATE refresh_tokens SET revoked_at = now() WHERE id = :id", params { uuid("id", row.id) })
        return issue(user, userAgent, row.familyId)
    }

    @Transactional
    fun revoke(refreshToken: String) {
        jdbc.update(
            "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = :hash AND revoked_at IS NULL",
            params { }.addValue("hash", sha256(refreshToken)),
        )
    }

    private data class StoredToken(
        val id: UUID,
        val userId: UUID,
        val familyId: UUID,
        val expiresAt: OffsetDateTime,
        val revokedAt: OffsetDateTime?,
    )

    private fun newRefreshToken(): String {
        val bytes = ByteArray(32).also { random.nextBytes(it) }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun sha256(value: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
}
