package com.alproutes.config

import com.alproutes.common.ErrorHandler
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.GrantedAuthority
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtValidators
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter
import org.springframework.security.web.AuthenticationEntryPoint
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.access.AccessDeniedHandler
import org.springframework.web.cors.CorsConfiguration
import org.springframework.web.cors.CorsConfigurationSource
import org.springframework.web.cors.UrlBasedCorsConfigurationSource
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/** Key for our own HS256 access tokens; shared by the encoder (TokenService) and the decoder below. */
class AccessTokenKey(val key: SecretKey)

@Configuration
@EnableMethodSecurity
class SecurityConfig(private val props: AppProperties, private val mapper: ObjectMapper) {

    @Bean
    fun accessTokenKey(): AccessTokenKey {
        val bytes = props.auth.jwtSecret.toByteArray(Charsets.UTF_8)
        require(bytes.size >= 32) { "alproutes.auth.jwt-secret must be at least 32 bytes (set JWT_SECRET)" }
        return AccessTokenKey(SecretKeySpec(bytes, "HmacSHA256"))
    }

    @Bean
    fun jwtDecoder(key: AccessTokenKey): JwtDecoder =
        NimbusJwtDecoder.withSecretKey(key.key).macAlgorithm(MacAlgorithm.HS256).build().apply {
            setJwtValidator(JwtValidators.createDefaultWithIssuer(props.auth.issuer))
        }

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        val entryPoint = AuthenticationEntryPoint { req, res, _ ->
            ErrorHandler.write(mapper, res, HttpStatus.UNAUTHORIZED, "unauthorized",
                "Требуется вход или токен недействителен", req.requestURI)
        }
        val deniedHandler = AccessDeniedHandler { req, res, _ ->
            ErrorHandler.write(mapper, res, HttpStatus.FORBIDDEN, "forbidden", "Недостаточно прав", req.requestURI)
        }
        http
            .csrf { it.disable() }   // stateless bearer tokens, no cookies
            .cors { }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers(HttpMethod.POST, "/auth/**").permitAll()
                    .requestMatchers(HttpMethod.GET, "/me").authenticated()
                    .requestMatchers("/moderation/**").authenticated()
                    .requestMatchers(HttpMethod.GET, "/**").permitAll()
                    .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                    .requestMatchers("/error").permitAll()
                    .anyRequest().authenticated()
            }
            .oauth2ResourceServer { rs ->
                rs.jwt { it.jwtAuthenticationConverter(jwtAuthenticationConverter()) }
                rs.authenticationEntryPoint(entryPoint)
                rs.accessDeniedHandler(deniedHandler)
            }
            .exceptionHandling {
                it.authenticationEntryPoint(entryPoint)
                it.accessDeniedHandler(deniedHandler)
            }
        return http.build()
    }

    /** Access token claim "role" -> ROLE_USER / ROLE_MODERATOR / ROLE_ADMIN. */
    private fun jwtAuthenticationConverter() = JwtAuthenticationConverter().apply {
        setJwtGrantedAuthoritiesConverter { jwt ->
            val role = (jwt.getClaimAsString("role") ?: "user").uppercase()
            listOf<GrantedAuthority>(SimpleGrantedAuthority("ROLE_$role"))
        }
    }

    @Bean
    fun corsConfigurationSource(): CorsConfigurationSource {
        val config = CorsConfiguration().apply {
            allowedOrigins = props.cors.allowedOrigins.filter { it.isNotBlank() }
            allowedMethods = listOf("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            allowedHeaders = listOf("Authorization", "Content-Type", "Accept-Language")
            maxAge = 3600
        }
        return UrlBasedCorsConfigurationSource().apply { registerCorsConfiguration("/**", config) }
    }
}
