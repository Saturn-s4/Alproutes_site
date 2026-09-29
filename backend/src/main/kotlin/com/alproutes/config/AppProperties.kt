package com.alproutes.config

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties("alproutes")
data class AppProperties(
    val auth: Auth,
    val cors: Cors = Cors(),
    val s3: S3,
) {
    data class Auth(
        val jwtSecret: String,
        val issuer: String = "alproutes",
        val accessTokenTtl: Duration = Duration.ofMinutes(15),
        val refreshTokenTtl: Duration = Duration.ofDays(60),
        val googleClientIds: List<String> = emptyList(),
        val appleClientIds: List<String> = emptyList(),
    )

    data class Cors(val allowedOrigins: List<String> = emptyList())

    data class S3(
        val endpoint: String,
        val publicEndpoint: String,
        val region: String,
        val bucket: String,
        val accessKey: String,
        val secretKey: String,
        val pathStyle: Boolean = true,
        val uploadUrlTtl: Duration = Duration.ofMinutes(15),
    )
}
