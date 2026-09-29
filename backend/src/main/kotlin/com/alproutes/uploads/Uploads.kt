package com.alproutes.uploads

import com.alproutes.auth.Caller
import com.alproutes.common.ApiException
import com.alproutes.common.params
import com.alproutes.common.validate
import com.alproutes.config.AppProperties
import com.alproutes.users.UserRepository
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest
import java.net.URI
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID

data class UploadRequest(val purpose: String, val contentType: String, val sizeBytes: Long, val fileName: String? = null)

data class UploadSlot(
    val uploadId: UUID,
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val expiresAt: OffsetDateTime,
)

private data class Rule(val maxBytes: Long, val types: Map<String, String>)   // content type -> extension

private const val MB = 1024L * 1024L

private val RULES = mapOf(
    "photo" to Rule(30 * MB, mapOf("image/jpeg" to ".jpg", "image/png" to ".png", "image/webp" to ".webp", "image/heic" to ".heic")),
    "track" to Rule(20 * MB, mapOf("application/gpx+xml" to ".gpx", "application/vnd.google-earth.kml+xml" to ".kml")),
    "document" to Rule(100 * MB, mapOf("application/pdf" to ".pdf")),
    "avatar" to Rule(5 * MB, mapOf("image/jpeg" to ".jpg", "image/png" to ".png", "image/webp" to ".webp")),
)

@Configuration
class S3Config(private val props: AppProperties) {
    /**
     * Presigning is a local computation (no network call). URLs are signed for the PUBLIC endpoint:
     * the one the browser or the app will actually send the file to.
     */
    @Bean(destroyMethod = "close")
    fun s3Presigner(): S3Presigner = S3Presigner.builder()
        .region(Region.of(props.s3.region))
        .endpointOverride(URI(props.s3.publicEndpoint))
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(props.s3.accessKey, props.s3.secretKey)))
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(props.s3.pathStyle).build())
        .build()
}

@Service
class UploadService(
    private val presigner: S3Presigner,
    private val props: AppProperties,
    private val jdbc: NamedParameterJdbcTemplate,
    private val users: UserRepository,
) {
    @Transactional
    fun create(caller: Caller, req: UploadRequest): UploadSlot {
        users.requireActive(caller.userId)
        val rule = RULES[req.purpose]
        validate {
            check(rule != null, "purpose", "Допустимые значения: " + RULES.keys.joinToString())
            if (rule != null) {
                check(req.contentType in rule.types, "contentType", "Для ${req.purpose}: " + rule.types.keys.joinToString())
            }
            check(req.sizeBytes > 0, "sizeBytes", "Размер должен быть больше нуля")
            req.fileName?.let { check(it.length <= 255, "fileName", "Не длиннее 255 символов") }
        }
        if (req.sizeBytes > rule!!.maxBytes) {
            throw ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "payload-too-large",
                "Максимальный размер для ${req.purpose}: ${rule.maxBytes / MB} МБ")
        }

        val id = UUID.randomUUID()
        val now = Instant.now()
        val date = now.atOffset(ZoneOffset.UTC)
        val key = "%s/%04d/%02d/%s%s".format(req.purpose, date.year, date.monthValue, id, rule.types.getValue(req.contentType))
        val expires = now.plus(props.s3.uploadUrlTtl)

        val put = PutObjectRequest.builder()
            .bucket(props.s3.bucket)
            .key(key)
            .contentType(req.contentType)
            .contentLength(req.sizeBytes)   // signed: S3 rejects a body of a different size
            .build()
        val presigned = presigner.presignPutObject(
            PutObjectPresignRequest.builder().signatureDuration(props.s3.uploadUrlTtl).putObjectRequest(put).build(),
        )

        jdbc.update(
            """
            INSERT INTO uploads (id, user_id, purpose, storage_key, content_type, size_bytes, expires_at)
            VALUES (:id, :user, :purpose, :key, :ct, :size, CAST(:expires AS timestamptz))
            """.trimIndent(),
            params {
                uuid("id", id); uuid("user", caller.userId); str("purpose", req.purpose); str("key", key)
                str("ct", req.contentType); long("size", req.sizeBytes); str("expires", expires.toString())
            },
        )

        // Host and Content-Length are set by the HTTP client itself (browsers forbid setting them).
        val headers = presigned.signedHeaders()
            .filterKeys { !it.equals("host", ignoreCase = true) && !it.equals("content-length", ignoreCase = true) }
            .mapValues { (_, values) -> values.joinToString(",") }

        return UploadSlot(id, presigned.url().toString(), "PUT", headers, expires.atOffset(ZoneOffset.UTC))
    }
}

@RestController
class UploadController(private val uploads: UploadService) {

    @PostMapping("/uploads")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody body: UploadRequest): UploadSlot = uploads.create(Caller.current(), body)
}
