package com.alproutes

import com.alproutes.users.UserRole
import com.fasterxml.jackson.databind.JsonNode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException
import software.amazon.awssdk.services.s3.model.CreateBucketRequest
import java.awt.Color
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import javax.imageio.ImageIO

class MediaTest : IntegrationTest() {
    @Autowired lateinit var s3: S3Client

    private val http = HttpClient.newHttpClient()

    @BeforeEach
    fun buckets() {
        if (bucketsReady) return
        // SeaweedFS accepts connections a moment before its filer is ready.
        repeat(30) { attempt ->
            try {
                for (b in listOf("alproutes-media", "alproutes-public")) {
                    try {
                        s3.createBucket(CreateBucketRequest.builder().bucket(b).build())
                    } catch (e: BucketAlreadyOwnedByYouException) {
                        // fine
                    }
                }
                bucketsReady = true
                return
            } catch (e: Exception) {
                if (attempt == 29) throw e
                Thread.sleep(500)
            }
        }
    }

    // ------------------------------------------------------------------ photos

    @Test
    fun `photo upload is processed into upright EXIF-free public derivatives`() {
        val user = token()
        val routeId = publishedRoute()
        // 300x100 pixels stored sideways: EXIF orientation 6 means "rotate 90° clockwise to view".
        val uploadId = upload(user, "photo", "image/jpeg", jpegWithOrientation(300, 100, 6))
        val photoId = UUID.randomUUID()
        val body = mapOf("id" to photoId, "uploadId" to uploadId, "kind" to "overview", "caption" to "Тест", "captionLanguage" to "ru")

        val created = post("/routes/$routeId/photos", user, body).expect(201).json
        assertEquals("processing", created["processingStatus"].asText())
        post("/routes/$routeId/photos", user, body).expect(200)                     // idempotent repeat
        post("/routes/$routeId/photos", token(), body).expect(409)                  // same id, another user

        val ready = awaitReady(photoId, user)
        assertEquals(100, ready["widthPx"].asInt())
        assertEquals(300, ready["heightPx"].asInt())

        val full = fetch(ready["urls"]["full"].asText())
        assertEquals(200, full.statusCode())                                         // anonymous read
        val image = ImageIO.read(ByteArrayInputStream(full.body()))
        assertEquals(100, image.width)
        assertEquals(300, image.height)
        assertFalse(String(full.body(), Charsets.ISO_8859_1).contains("Exif"))

        val thumb = ImageIO.read(ByteArrayInputStream(fetch(ready["urls"]["thumbnail"].asText()).body()))
        assertTrue(maxOf(thumb.width, thumb.height) <= 400)

        // An upload can back only one entity.
        post("/routes/$routeId/photos", user, body + ("id" to UUID.randomUUID())).expect(409)
    }

    @Test
    fun `upload must be in storage and belong to the caller`() {
        val user = token()
        val routeId = publishedRoute()
        val slot = post("/uploads", user, mapOf("purpose" to "photo", "contentType" to "image/jpeg", "sizeBytes" to 1000)).expect(201)
        val notUploaded = mapOf("id" to UUID.randomUUID(), "uploadId" to slot.json["uploadId"].asText(), "kind" to "detail")
        post("/routes/$routeId/photos", user, notUploaded).expect(409)
        post("/routes/$routeId/photos", token(), notUploaded).expect(400)
    }

    @Test
    fun `description photos are versioned with the revision and split the gallery`() {
        val mod = token(UserRole.MODERATOR)
        val user = token()
        val areaId = createArea(mod)
        val created = post("/routes", mod, mapOf("content" to content(areaId), "publish" to true)).expect(201).json
        val routeId = created["routeId"].asText()

        val inDescription = readyPhoto(mod, routeId)
        val userPhoto = readyPhoto(user, routeId)
        val otherRoute = post("/routes", mod, mapOf("content" to content(areaId), "publish" to true)).expect(201).json["routeId"].asText()
        val foreign = readyPhoto(user, otherRoute)

        // A new route cannot reference photos: they are uploaded to an existing route.
        post("/routes", mod, mapOf("content" to content(areaId, extra = mapOf("photos" to listOf(mapOf("photoId" to inDescription)))))).expect(400)

        val photos = listOf(mapOf("photoId" to inDescription, "caption" to mapOf("ru" to "Общий вид (тест)")))
        val rejected = post("/routes/$routeId/revisions", mod, mapOf(
            "baseRevisionId" to created["id"].asText(),
            "content" to content(areaId, extra = mapOf("photos" to listOf(mapOf("photoId" to foreign)))),
        )).expect(400)
        assertEquals("content.photos[0].photoId", rejected.json["errors"][0]["field"].asText())

        val withPhotos = post("/routes/$routeId/revisions", mod, mapOf(
            "baseRevisionId" to created["id"].asText(),
            "content" to content(areaId, extra = mapOf("photos" to photos)),
            "publish" to true,
        )).expect(201).json

        val detail = get("/routes/$routeId").expect(200).json
        assertEquals(inDescription, detail["photos"][0]["photoId"].asText())
        assertEquals("Общий вид (тест)", detail["photos"][0]["caption"]["ru"].asText())
        assertEquals(listOf(inDescription), detail["descriptionPhotos"].map { it["id"].asText() })
        assertNotNull(detail["descriptionPhotos"][0]["urls"]["medium"].textValue())

        assertEquals(listOf(inDescription), photoIds(get("/routes/$routeId/photos?inDescription=true").expect(200).json))
        assertEquals(listOf(userPhoto), photoIds(get("/routes/$routeId/photos?inDescription=false").expect(200).json))
        assertEquals(2, get("/routes/$routeId/photos").expect(200).json["items"].size())

        val summary = get("/routes?areaId=$areaId").expect(200).json["items"].first { it["id"].asText() == routeId }
        assertTrue(summary["coverPhotoUrl"].asText().endsWith("/photos/$inDescription/thumbnail.jpg"))

        // Revert to revision 1 brings back the empty set; reverting again restores the photo.
        post("/route-revisions/${created["id"].asText()}/revert", mod, mapOf("note" to "тест")).expect(201)
        assertEquals(0, get("/routes/$routeId").expect(200).json["descriptionPhotos"].size())
        post("/route-revisions/${withPhotos["id"].asText()}/revert", mod, mapOf("note" to "тест")).expect(201)
        assertEquals(1, get("/routes/$routeId").expect(200).json["descriptionPhotos"].size())

        // A deleted photo stays in the revision but is no longer shown.
        delete("/photos/$inDescription", user).expect(403)
        delete("/photos/$inDescription", mod).expect(204)
        val afterDelete = get("/routes/$routeId").expect(200).json
        assertEquals(1, afterDelete["photos"].size())
        assertEquals(0, afterDelete["descriptionPhotos"].size())
    }

    // --------------------------------------------------------------- documents

    @Test
    fun `document stays hidden until a moderator clears its rights`() {
        val user = token()
        val mod = token(UserRole.MODERATOR)
        val routeId = publishedRoute()

        val notPdf = upload(user, "document", "application/pdf", "plain text, not a pdf".toByteArray())
        post("/routes/$routeId/documents", user, documentBody(notPdf)).expect(400)

        val pdf = upload(user, "document", "application/pdf", minimalPdf())
        val doc = post("/routes/$routeId/documents", user, documentBody(pdf)).expect(201).json
        val docId = doc["id"].asText()
        assertEquals("hidden", doc["visibility"].asText())
        assertEquals("unknown", doc["rightsStatus"].asText())

        assertEquals(0, get("/routes/$routeId/documents").expect(200).json["items"].size())   // anonymous
        assertEquals(1, get("/routes/$routeId/documents", user).expect(200).json["items"].size()) // uploader
        get("/documents/$docId").expect(404)
        assertEquals(451, get("/documents/$docId/download").status)
        assertEquals(302, get("/documents/$docId/download", user).status)
        assertTrue(get("/moderation/documents", mod).expect(200).json["items"].any { it["id"].asText() == docId })

        put("/documents/$docId/rights", user, mapOf("rightsStatus" to "own_work", "visibility" to "visible")).expect(403)
        put("/documents/$docId/rights", mod, mapOf("rightsStatus" to "unknown", "visibility" to "visible")).expect(400)
        put("/documents/$docId/rights", mod, mapOf("rightsStatus" to "licensed", "visibility" to "visible")).expect(400)
        put("/documents/$docId/rights", mod, mapOf("rightsStatus" to "own_work", "visibility" to "visible")).expect(200)

        assertEquals(listOf(docId), get("/routes/$routeId/documents").expect(200).json["items"].map { it["id"].asText() })
        assertEquals(1, get("/routes/$routeId").expect(200).json["stats"]["documentCount"].asInt())
        val download = get("/documents/$docId/download").expect(302)
        val file = fetch(download.result.response.getHeader("Location")!!)
        assertEquals(200, file.statusCode())
        assertTrue(String(file.body(), Charsets.ISO_8859_1).startsWith("%PDF-"))
        assertFalse(get("/moderation/documents", mod).expect(200).json["items"].any { it["id"].asText() == docId })
    }

    // ----------------------------------------------------------------- helpers

    private fun publishedRoute(): String {
        val mod = token(UserRole.MODERATOR)
        return post("/routes", mod, mapOf("content" to content(createArea(mod)), "publish" to true)).expect(201).json["routeId"].asText()
    }

    private fun readyPhoto(token: String, routeId: String): String {
        val id = UUID.randomUUID()
        val uploadId = upload(token, "photo", "image/png", png(64, 48))
        post("/routes/$routeId/photos", token, mapOf("id" to id, "uploadId" to uploadId, "kind" to "overview")).expect(201)
        awaitReady(id, token)
        return id.toString()
    }

    private fun photoIds(page: JsonNode) = page["items"].map { it["id"].asText() }

    private fun documentBody(uploadId: String) = mapOf(
        "uploadId" to uploadId,
        "title" to mapOf("ru" to "Тестовый документ"),
        "sourceType" to "other",
        "sourceDescription" to "Сгенерирован тестом",
        "claimedRightsStatus" to "own_work",
    )

    /** Requests an upload slot and PUTs the bytes exactly as a client would. */
    private fun upload(token: String, purpose: String, contentType: String, bytes: ByteArray): String {
        val slot = post("/uploads", token, mapOf("purpose" to purpose, "contentType" to contentType, "sizeBytes" to bytes.size)).expect(201).json
        val req = HttpRequest.newBuilder(URI(slot["url"].asText())).PUT(HttpRequest.BodyPublishers.ofByteArray(bytes))
        slot["headers"].properties().forEach { (k, v) -> req.header(k, v.asText()) }
        val res = http.send(req.build(), HttpResponse.BodyHandlers.ofString())
        assertEquals(200, res.statusCode(), res.body())
        return slot["uploadId"].asText()
    }

    private fun fetch(url: String): HttpResponse<ByteArray> =
        http.send(HttpRequest.newBuilder(URI(url)).GET().build(), HttpResponse.BodyHandlers.ofByteArray())

    private fun awaitReady(photoId: Any, token: String): JsonNode {
        repeat(100) {
            val photo = get("/photos/$photoId", token).expect(200).json
            when (photo["processingStatus"].asText()) {
                "ready" -> return photo
                "failed" -> throw AssertionError("Photo processing failed")
            }
            Thread.sleep(100)
        }
        throw AssertionError("Photo was not processed in time")
    }

    private fun image(w: Int, h: Int) = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB).apply {
        createGraphics().apply { color = Color(70, 110, 160); fillRect(0, 0, w, h); dispose() }
    }

    private fun png(w: Int, h: Int) = ByteArrayOutputStream().also { ImageIO.write(image(w, h), "png", it) }.toByteArray()

    /** JPEG with a minimal EXIF APP1 segment carrying only the orientation tag. */
    private fun jpegWithOrientation(w: Int, h: Int, orientation: Int): ByteArray {
        val jpeg = ByteArrayOutputStream().also { ImageIO.write(image(w, h), "jpeg", it) }.toByteArray()
        val tiff = byteArrayOf(
            0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,          // big-endian TIFF, IFD0 at offset 8
            0x00, 0x01,                                              // one entry
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,          // Orientation, SHORT, count 1
            0x00, orientation.toByte(), 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,                                  // no next IFD
        )
        val payload = "Exif".toByteArray() + byteArrayOf(0, 0) + tiff
        val len = payload.size + 2
        val app1 = byteArrayOf(0xFF.toByte(), 0xE1.toByte(), (len shr 8).toByte(), len.toByte()) + payload
        return jpeg.copyOfRange(0, 2) + app1 + jpeg.copyOfRange(2, jpeg.size)
    }

    /** The smallest valid one-page PDF. */
    private fun minimalPdf(): ByteArray {
        val objects = listOf(
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
        )
        val out = StringBuilder("%PDF-1.4\n")
        val offsets = objects.mapIndexed { i, o -> out.length.also { out.append("${i + 1} 0 obj\n$o\nendobj\n") } }
        val xref = out.length
        out.append("xref\n0 ${objects.size + 1}\n0000000000 65535 f \n")
        offsets.forEach { out.append("%010d 00000 n \n".format(it)) }
        out.append("trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
        return out.toString().toByteArray(Charsets.ISO_8859_1)
    }

    companion object {
        @Volatile private var bucketsReady = false
    }
}
