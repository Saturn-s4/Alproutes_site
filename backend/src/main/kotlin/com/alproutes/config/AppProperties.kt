package com.alproutes.config

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties("alproutes")
data class AppProperties(
    val auth: Auth,
    val cors: Cors = Cors(),
    val s3: S3,
    val maintenance: Maintenance = Maintenance(),
    val places: Places = Places(),
) {
    data class Auth(
        val jwtSecret: String,
        val issuer: String = "alproutes",
        val accessTokenTtl: Duration = Duration.ofMinutes(15),
        val refreshTokenTtl: Duration = Duration.ofDays(60),
        val googleClientIds: List<String> = emptyList(),
        val appleClientIds: List<String> = emptyList(),
    )

    /** Daily cleanup (MaintenanceJob). */
    data class Maintenance(
        val enabled: Boolean = true,
        val cron: String = "0 30 3 * * *",
        /** Unattached photos (POST /photos) never taken by a new route are removed after this. */
        val unattachedPhotoTtl: Duration = Duration.ofDays(7),
        /** How far back duplicate documents (a retried POST) are looked for. */
        val duplicateDocumentWindow: Duration = Duration.ofDays(3),
        val batchSize: Int = 500,
    )

    /** Place search on the map (GET /places), proxied to a Nominatim server. */
    data class Places(
        /** Base URL of the Nominatim API; blank turns the search off (503). */
        val url: String = "",
        /** Nominatim usage policy: identify the application, give a contact. */
        val userAgent: String = "AlpRoutes",
        val email: String = "",
        /** The public server allows one request per second for the whole application. */
        val minInterval: Duration = Duration.ofMillis(1100),
        /** A request that would wait longer than this for its turn gets 429. */
        val maxWait: Duration = Duration.ofSeconds(3),
        val timeout: Duration = Duration.ofSeconds(5),
        val cacheTtl: Duration = Duration.ofHours(24),
        val cacheSize: Int = 2000,
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
        /** Anonymous-read bucket for EXIF-stripped photo derivatives. */
        val publicBucket: String,
        /** Base URL of [publicBucket] as seen by clients (a CDN in production). */
        val publicBaseUrl: String,
        /** Lifetime of pre-signed download links (documents). */
        val downloadUrlTtl: Duration = Duration.ofMinutes(10),
    )
}
