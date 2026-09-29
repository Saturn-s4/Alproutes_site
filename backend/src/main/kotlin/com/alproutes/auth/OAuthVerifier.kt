package com.alproutes.auth

import com.alproutes.common.ApiException
import com.alproutes.common.unauthorized
import com.alproutes.config.AppProperties
import org.springframework.http.HttpStatus
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator
import org.springframework.security.oauth2.core.OAuth2Error
import org.springframework.security.oauth2.core.OAuth2TokenValidator
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.jwt.JwtException
import org.springframework.security.oauth2.jwt.JwtTimestampValidator
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.stereotype.Component
import java.security.MessageDigest

enum class OAuthProvider(val wire: String) { GOOGLE("google"), APPLE("apple") }

data class VerifiedIdentity(
    val provider: OAuthProvider,
    val subject: String,
    val email: String?,
    val emailVerified: Boolean,
    val name: String?,
)

/** Verifies ID tokens issued by Google / Apple against their published keys (RS256, JWKS). */
@Component
class OAuthVerifier(props: AppProperties) {

    private val googleClients = props.auth.googleClientIds.filter { it.isNotBlank() }
    private val appleClients = props.auth.appleClientIds.filter { it.isNotBlank() }

    private val google by lazy {
        decoder("https://www.googleapis.com/oauth2/v3/certs", setOf("https://accounts.google.com", "accounts.google.com"), googleClients)
    }
    private val apple by lazy {
        decoder("https://appleid.apple.com/auth/keys", setOf("https://appleid.apple.com"), appleClients)
    }

    fun verify(provider: OAuthProvider, idToken: String, nonce: String?): VerifiedIdentity {
        val (decoder, clients) = when (provider) {
            OAuthProvider.GOOGLE -> google to googleClients
            OAuthProvider.APPLE -> apple to appleClients
        }
        if (clients.isEmpty()) {
            throw ApiException(HttpStatus.FORBIDDEN, "forbidden", "Вход через ${provider.wire} не настроен на сервере")
        }
        val jwt = try {
            decoder.decode(idToken)
        } catch (e: JwtException) {
            throw unauthorized("ID token не прошёл проверку")
        }
        if (nonce != null) {
            // Apple native flows put SHA-256(nonce) into the request; web flows put the raw value.
            val claim = jwt.getClaimAsString("nonce")
            if (claim != nonce && claim != sha256Hex(nonce)) throw unauthorized("Nonce не совпадает")
        }
        return VerifiedIdentity(
            provider = provider,
            subject = jwt.subject ?: throw unauthorized("В ID token нет sub"),
            email = jwt.getClaimAsString("email"),
            // Google sends a boolean, Apple a string "true"/"false".
            emailVerified = jwt.claims["email_verified"]?.toString() == "true",
            name = jwt.getClaimAsString("name"),
        )
    }

    private fun decoder(jwks: String, issuers: Set<String>, audiences: List<String>): NimbusJwtDecoder =
        NimbusJwtDecoder.withJwkSetUri(jwks).build().apply {
            setJwtValidator(
                DelegatingOAuth2TokenValidator(
                    JwtTimestampValidator(),
                    claimValidator("iss") { jwt -> jwt.getClaimAsString("iss") in issuers },
                    claimValidator("aud") { jwt -> jwt.audience.orEmpty().any { it in audiences } },
                ),
            )
        }

    private fun claimValidator(claim: String, ok: (Jwt) -> Boolean) = OAuth2TokenValidator<Jwt> { jwt ->
        if (ok(jwt)) OAuth2TokenValidatorResult.success()
        else OAuth2TokenValidatorResult.failure(OAuth2Error("invalid_token", "Invalid $claim", null))
    }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
