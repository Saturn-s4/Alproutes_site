package com.alproutes.media

import com.alproutes.config.AppProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.HeadObjectRequest
import software.amazon.awssdk.services.s3.model.NoSuchKeyException
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.s3.model.S3Exception
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest
import java.net.URI

@Configuration
class S3ClientConfig(private val props: AppProperties) {
    /** Server-side client: talks to the INTERNAL endpoint (inside Docker it differs from the public one). */
    @Bean(destroyMethod = "close")
    fun s3Client(): S3Client = S3Client.builder()
        .region(Region.of(props.s3.region))
        .endpointOverride(URI(props.s3.endpoint))
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(props.s3.accessKey, props.s3.secretKey)))
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(props.s3.pathStyle).build())
        .build()
}

/**
 * Object storage as the services see it. Uploads go straight from clients to the private bucket
 * via pre-signed URLs; the backend only reads them back for processing and writes derivatives.
 */
@Component
class MediaStorage(
    private val s3: S3Client,
    private val presigner: S3Presigner,
    private val props: AppProperties,
) {
    /** Size of an uploaded object, or null when the client has not uploaded it (yet). */
    fun sizeOf(key: String): Long? = try {
        s3.headObject(HeadObjectRequest.builder().bucket(props.s3.bucket).key(key).build()).contentLength()
    } catch (e: NoSuchKeyException) {
        null
    } catch (e: S3Exception) {
        if (e.statusCode() == 404) null else throw e
    }

    fun read(key: String): ByteArray =
        s3.getObjectAsBytes(GetObjectRequest.builder().bucket(props.s3.bucket).key(key).build()).asByteArray()

    fun readPrefix(key: String, bytes: Int): ByteArray =
        s3.getObjectAsBytes(GetObjectRequest.builder().bucket(props.s3.bucket).key(key).range("bytes=0-${bytes - 1}").build()).asByteArray()

    /** Writes a derivative to the public bucket. Keys are per content, so caching forever is safe. */
    fun putPublic(key: String, bytes: ByteArray, contentType: String) {
        s3.putObject(
            PutObjectRequest.builder()
                .bucket(props.s3.publicBucket)
                .key(key)
                .contentType(contentType)
                .cacheControl("public, max-age=31536000, immutable")
                .build(),
            RequestBody.fromBytes(bytes),
        )
    }

    fun publicUrl(key: String): String = props.s3.publicBaseUrl.trimEnd('/') + "/" + key

    /** Short-lived link to a private object: shown inline (PDF viewer) or saved as a file. */
    fun presignedDownload(key: String, contentType: String, fileName: String, attachment: Boolean = false): String {
        val get = GetObjectRequest.builder()
            .bucket(props.s3.bucket)
            .key(key)
            .responseContentType(contentType)
            .responseContentDisposition(contentDisposition(if (attachment) "attachment" else "inline", fileName))
            .build()
        return presigner.presignGetObject(
            GetObjectPresignRequest.builder().signatureDuration(props.s3.downloadUrlTtl).getObjectRequest(get).build(),
        ).url().toString()
    }
}

/** RFC 6266: an ASCII fallback name plus the exact UTF-8 one (Cyrillic file names are common). */
internal fun contentDisposition(type: String, fileName: String): String {
    val ascii = fileName.map { if (it.code in 0x20..0x7e && it != '"' && it.code != 0x5c) it else '_' }.joinToString("")
    val utf8 = java.net.URLEncoder.encode(fileName, Charsets.UTF_8).replace("+", "%20")
    return "$type; filename=\"$ascii\"; filename*=UTF-8''$utf8"
}
