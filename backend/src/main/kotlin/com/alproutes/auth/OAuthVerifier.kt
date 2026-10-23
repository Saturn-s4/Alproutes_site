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

enum class OAuthProvider(val wire: String) { GOOGLE("google") }

data class VerifiedIdentity(
    val provider: OAuthProvider,
    val subject: String,
    val email: String?,
    val emailVerified: Boolean,
    val name: String?,
)

/** Verifies ID tokens issued by Google against their published keys (RS256, JWKS). */
@Component
class OAuthVerifier(props: AppProperties) {

    private val googleClients = props.auth.googleClientIds.filter { it.isNotBlank() }

    private val google by lazy {
        decoder("https://www.googleapis.com/oauth2/v3/certs", setOf("https://accounts.google.com", "accounts.google.com"), googleClients)
    }

    fun verify(provider: OAuthProvider, idToken: String, nonce: String?): VerifiedIdentity {
        val (decoder, clients) = when (provider) {
            OAuthProvider.GOOGLE -> google to googleClients
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
            if (jwt.getClaimAsString("nonce") != nonce) throw unauthorized("Nonce не совпадает")
        }
        return VerifiedIdentity(
            provider = provider,
            subject = jwt.subject ?: throw unauthorized("В ID token нет sub"),
            email = jwt.getClaimAsString("email"),
            // A boolean in Google tokens; compared as text to accept a "true" string as well.
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
}
