package com.alproutes

import com.alproutes.users.UserRole
import com.fasterxml.jackson.databind.JsonNode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
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
    @Autowired lateinit var maintenance: com.alproutes.maintenance.MaintenanceJob
    @Autowired lateinit var storage: com.alproutes.media.MediaStorage

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

        // A new route cannot take photos of another route, only the author's unattached ones.
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

    @Test
    fun `new route takes the author's unattached photos into revision 1`() {
        val user = token()
        val other = token()
        val areaId = createArea(token(UserRole.MODERATOR))

        val cover = UUID.randomUUID()
        val second = UUID.randomUUID()
        for (id in listOf(cover, second)) {
            val uploadId = upload(user, "photo", "image/png", png(64, 48))
            post("/photos", user, mapOf("id" to id, "uploadId" to uploadId, "kind" to "overview")).expect(201)
            awaitReady(id, user)
        }
        // Unattached: the author sees it, nobody else does; ascent photos need a route.
        assertTrue(get("/photos/$cover", user).expect(200).json["routeId"].isNull)
        get("/photos/$cover").expect(404)
        get("/photos/$cover", other).expect(404)
        post("/photos", user, mapOf("id" to UUID.randomUUID(), "uploadId" to UUID.randomUUID(), "kind" to "overview",
            "ascentId" to UUID.randomUUID())).expect(400)

        // Someone else cannot take them.
        val photos = listOf(mapOf("photoId" to cover, "caption" to mapOf("ru" to "Титульное (тест)")), mapOf("photoId" to second))
        val stolen = post("/routes", other, mapOf("content" to content(areaId, extra = mapOf("photos" to photos)))).expect(400)
        assertEquals("content.photos[0].photoId", stolen.json["errors"][0]["field"].asText())

        val created = post("/routes", user, mapOf("content" to content(areaId, extra = mapOf("photos" to photos)))).expect(201).json
        val routeId = created["routeId"].asText()
        assertEquals(routeId, get("/photos/$cover", user).expect(200).json["routeId"].asText())
        assertEquals(listOf(cover.toString(), second.toString()),
            get("/route-revisions/${created["id"].asText()}", user).expect(200).json["content"]["photos"].map { it["photoId"].asText() })

        // Once attached, the photos cannot go into yet another new route; a repeated POST /photos is idempotent.
        post("/routes", user, mapOf("content" to content(areaId, extra = mapOf("photos" to photos)))).expect(400)
        post("/photos", user, mapOf("id" to cover, "uploadId" to UUID.randomUUID(), "kind" to "overview")).expect(200)

        // After approval the first photo is the cover.
        post("/route-revisions/${created["id"].asText()}/approve", token(UserRole.MODERATOR)).expect(200)
        val summary = get("/routes?areaId=$areaId").expect(200).json["items"].first { it["id"].asText() == routeId }
        assertTrue(summary["coverPhotoUrl"].asText().endsWith("/photos/$cover/thumbnail.jpg"))
    }

    // -------------------------------------------------------------------- topo

    @Test
    fun `topo line versions are moderated like route revisions`() {
        val mod = token(UserRole.MODERATOR)
        val user = token()
        val routeId = post("/routes", mod, mapOf("content" to content(createArea(mod)), "publish" to true)).expect(201).json["routeId"].asText()
        val photoId = readyPhoto(user, routeId)
        val versions = "/photos/$photoId/topo-lines/$routeId/versions"
        fun drawing(x: Double = 0.2, dashed: Boolean = false) = mapOf(
            "formatVersion" to 1,
            "paths" to listOf(mapOf("id" to "p1", "style" to "main", "dashed" to dashed,
                "points" to listOf(mapOf("x" to x, "y" to 0.9), mapOf("x" to 0.5, "y" to 0.5), mapOf("x" to 0.6, "y" to 0.1)))),
            "labels" to listOf(mapOf("x" to 0.5, "y" to 0.5, "text" to "Ключ (тест)", "pathId" to "p1")),
        )

        // Only a topo photo takes a drawing; the author switches the type.
        post(versions, user, mapOf("drawing" to drawing())).expect(409)
        patch("/photos/$photoId", user, mapOf("kind" to "topo")).expect(200)

        val bad = post(versions, user, mapOf("drawing" to drawing(x = 1.5))).expect(400)
        assertEquals("drawing.paths[0].points[0]", bad.json["errors"][0]["field"].asText())
        post(versions, user, mapOf("drawing" to drawing(), "publish" to true)).expect(403)

        val v1 = post(versions, user, mapOf("drawing" to drawing(dashed = true))).expect(201).json
        assertEquals(1, v1["version"].asInt())
        assertEquals("pending", v1["status"].asText())
        assertTrue(v1["drawing"]["paths"][0]["dashed"].asBoolean())
        assertTrue(v1["drawing"]["paths"][0]["smooth"].asBoolean())

        // A second first version is a conflict: the base is now v1.
        val stale = post(versions, user, mapOf("drawing" to drawing())).expect(409)
        assertEquals(v1["id"].asText(), stale.json["currentRevisionId"].asText())

        assertEquals(0, get(versions).expect(200).json["items"].size())
        assertEquals(1, get(versions, user).expect(200).json["items"].size())
        assertEquals(1, get("/moderation/topo-lines", mod).expect(200).json["items"].count { it["id"] == v1["id"] })
        get("/moderation/topo-lines", user).expect(403)

        post("/topo-lines/${v1["id"].asText()}/approve", user).expect(403)
        post("/topo-lines/${v1["id"].asText()}/approve", mod).expect(200)
        val shown = get("/photos/$photoId").expect(200).json["topoLines"]
        assertEquals(listOf(v1["id"].asText()), shown.map { it["id"].asText() })
        assertEquals("Ключ (тест)", shown[0]["drawing"]["labels"][0]["text"].asText())

        // v2 by the user waits; a moderator publishes v3 on the same base, so v2 becomes stale.
        val v2 = post(versions, user, mapOf("baseVersionId" to v1["id"], "drawing" to drawing(x = 0.3))).expect(201).json
        val v3 = post(versions, mod, mapOf("baseVersionId" to v1["id"], "drawing" to drawing(x = 0.4), "publish" to true)).expect(201).json
        assertTrue(v3["isCurrent"].asBoolean())
        val staleApprove = post("/topo-lines/${v2["id"].asText()}/approve", mod).expect(409)
        assertEquals("revision-stale", staleApprove.json["type"].asText())
        post("/topo-lines/${v2["id"].asText()}/reject", mod, mapOf<String, Any>()).expect(400)
        assertEquals("rejected", post("/topo-lines/${v2["id"].asText()}/reject", mod, mapOf("note" to "тест")).expect(200).json["status"].asText())

        assertEquals(listOf(3, 1), get(versions).expect(200).json["items"].map { it["version"].asInt() })
        assertEquals(listOf(v3["id"].asText()), get("/photos/$photoId").expect(200).json["topoLines"].map { it["id"].asText() })

        // An empty drawing is a version too: it removes the line, and the history keeps it.
        val removed = post(versions, mod, mapOf("baseVersionId" to v3["id"], "publish" to true,
            "drawing" to mapOf("formatVersion" to 1, "paths" to emptyList<Any>()))).expect(201).json
        val current = get("/photos/$photoId").expect(200).json["topoLines"].single()
        assertEquals(removed["id"].asText(), current["id"].asText())
        assertEquals(0, current["drawing"]["paths"].size())
        assertEquals(listOf(4, 3, 1), get(versions).expect(200).json["items"].map { it["version"].asInt() })
    }

    // ---------------------------------------------------------------- comments

    @Test
    fun `route comments carry the author's photos and take them along when deleted`() {
        val user = token()
        val other = token()
        val routeId = publishedRoute()
        val comments = "/routes/$routeId/comments"
        val p1 = readyPhoto(user, routeId)
        val p2 = readyPhoto(user, routeId)
        val foreign = readyPhoto(other, routeId)

        // Only one's own photos of this route.
        val c1 = UUID.randomUUID()
        val stolen = post(comments, user, mapOf("id" to c1, "body" to "Чужое фото (тест)", "photoIds" to listOf(foreign))).expect(400)
        assertEquals("photoIds[0]", stolen.json["errors"][0]["field"].asText())
        post(comments, user, mapOf("id" to c1, "body" to "   ")).expect(400)

        val created = post(comments, user, mapOf("id" to c1, "body" to " Были вчера, лёд хороший (тест) ", "language" to "ru",
            "photoIds" to listOf(p1, p2))).expect(201).json
        assertEquals("Были вчера, лёд хороший (тест)", created["body"].asText())
        assertEquals(listOf(p1, p2), created["photos"].map { it["id"].asText() })
        assertEquals(c1.toString(), get("/photos/$p1").expect(200).json["commentId"].asText())
        // A retry of the same request is the same comment.
        post(comments, user, mapOf("id" to c1, "body" to "Были вчера, лёд хороший (тест)", "photoIds" to listOf(p1, p2))).expect(200)

        // A photo belongs to one comment; the failed comment is not saved at all.
        post(comments, user, mapOf("id" to UUID.randomUUID(), "body" to "Ещё раз (тест)", "photoIds" to listOf(p1))).expect(400)
        assertEquals(1, get(comments).expect(200).json["items"].size())

        // One level of replies.
        val reply = post(comments, other, mapOf("id" to UUID.randomUUID(), "body" to "Спасибо (тест)", "parentId" to c1)).expect(201).json
        post(comments, user, mapOf("id" to UUID.randomUUID(), "body" to "Ответ на ответ (тест)", "parentId" to reply["id"])).expect(400)

        val list = get(comments).expect(200).json["items"]
        assertEquals(listOf(c1.toString(), reply["id"].asText()), list.map { it["id"].asText() })
        assertEquals(2, list[0]["photos"].size())
        assertEquals(c1.toString(), list[1]["parentId"].asText())

        patch("/comments/$c1", other, mapOf("body" to "Подмена (тест)")).expect(403)
        assertNotNull(patch("/comments/$c1", user, mapOf("body" to "Были вчера (тест)")).expect(200).json["editedAt"].textValue())

        delete("/comments/$c1", other).expect(403)
        delete("/comments/$c1", user).expect(204)
        val after = get(comments).expect(200).json["items"]
        assertTrue(after[0]["isDeleted"].asBoolean())
        assertTrue(after[0]["body"].isNull)
        assertEquals(0, after[0]["photos"].size())
        assertEquals(reply["id"].asText(), after[1]["id"].asText())
        get("/photos/$p1").expect(404)
        assertEquals(listOf(foreign), photoIds(get("/routes/$routeId/photos?inDescription=false").expect(200).json))
    }

    // ------------------------------------------------------------- maintenance

    @Test
    fun `daily maintenance removes expired slots, stale unattached photos and duplicate documents`() {
        val user = token()
        val routeId = publishedRoute()

        // An expired slot that was never claimed: its object and row go.
        val slot = post("/uploads", user, mapOf("purpose" to "photo", "contentType" to "image/png", "sizeBytes" to 10)).expect(201).json
        val slotKey = jdbc.queryForObject("SELECT storage_key FROM uploads WHERE id = :id", mapOf("id" to UUID.fromString(slot["uploadId"].asText())), String::class.java)!!
        jdbc.update("UPDATE uploads SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = :id",
            mapOf("id" to UUID.fromString(slot["uploadId"].asText())))

        // An unattached photo older than the TTL goes; a fresh one stays.
        val stale = UUID.randomUUID()
        val fresh = UUID.randomUUID()
        for (id in listOf(stale, fresh)) {
            post("/photos", user, mapOf("id" to id, "uploadId" to upload(user, "photo", "image/png", png(32, 24)), "kind" to "overview")).expect(201)
            awaitReady(id, user)
        }
        jdbc.update("UPDATE photos SET created_at = now() - interval '8 days' WHERE id = :id", mapOf("id" to stale))
        val staleKey = jdbc.queryForObject("SELECT storage_key FROM photos WHERE id = :id", mapOf("id" to stale), String::class.java)!!

        // The same PDF sent twice (a retry after a lost response), plus a different one: one copy goes.
        val pdf = minimalPdf()
        val first = post("/routes/$routeId/documents", user, documentBody(upload(user, "document", "application/pdf", pdf))).expect(201).json
        val retry = post("/routes/$routeId/documents", user, documentBody(upload(user, "document", "application/pdf", pdf))).expect(201).json
        val other = post("/routes/$routeId/documents", user,
            documentBody(upload(user, "document", "application/pdf", pdf + "% other\n".toByteArray()))).expect(201).json

        val report = maintenance.runOnce()
        assertTrue(report.expiredUploads >= 1)
        assertTrue(report.unattachedPhotos >= 1)
        assertEquals(1, report.duplicateDocuments)

        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM uploads WHERE storage_key = :k", mapOf("k" to slotKey), Int::class.java))
        get("/photos/$stale", user).expect(404)
        get("/photos/$fresh", user).expect(200)
        assertNull(storage.sizeOf(staleKey))
        get("/documents/${first["id"].asText()}", user).expect(200)
        get("/documents/${retry["id"].asText()}", user).expect(404)
        get("/documents/${other["id"].asText()}", user).expect(200)

        // A second run finds nothing new.
        assertEquals(0, maintenance.runOnce().duplicateDocuments)
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


    // ------------------------------------------------------------------ tracks

    @Test
    fun `gpx track is parsed with a smoothed profile and can be imported as a route line`() {
        val user = token()
        val mod = token(UserRole.MODERATOR)
        val areaId = createArea(mod)
        val created = post("/routes", mod, mapOf("content" to content(areaId), "publish" to true)).expect(201).json
        val routeId = created["routeId"].asText()

        // Synthetic test track: ~1.1 km north, steady climb of 200 m with ±2 m sensor jitter.
        val points = (0..100).map { i ->
            val jitter = if (i % 2 == 0) 2.0 else -2.0
            Triple(10.0, 10.0 + i * 0.0001, 1000.0 + i * 2.0 + jitter)
        }
        val trackId = UUID.randomUUID()
        val uploadId = upload(user, "track", "application/gpx+xml", gpx(listOf(points)), "тестовый трек.gpx")
        post("/routes/$routeId/tracks", user, mapOf("id" to trackId, "uploadId" to uploadId, "note" to "Тест")).expect(201)
        val track = awaitTrack(trackId, user)

        assertEquals("gpx", track["format"].asText())
        assertEquals("тестовый трек.gpx", track["originalFilename"].asText())
        assertTrue(track["lengthM"].asInt() in 1080..1150, "length ${track["lengthM"]}")
        // Raw jitter sums to ~600 m of "gain"; smoothing must bring it close to the real 200 m.
        assertTrue(track["elevationGainM"].asInt() in 180..220, "gain ${track["elevationGainM"]}")
        assertTrue(track["elevationSource"].isNull)                     // unknown, not guessed
        assertEquals("2026-07-01", track["recordedOn"].asText())

        val profile = get("/tracks/$trackId/profile").expect(200).json
        assertTrue(profile["points"].size() > 10)
        val geometry = get("/tracks/$trackId/geometry").expect(200).json
        assertEquals(3, geometry["coordinates"][0][0].size())
        assertEquals(302, get("/tracks/$trackId/download").status)

        // Import: the line is copied into the revision; the track stays the provenance.
        val rev = post("/routes/$routeId/revisions", mod, mapOf(
            "baseRevisionId" to created["id"].asText(),
            "content" to content(areaId, features = listOf(mapOf("kind" to "route_line", "sourceTrackId" to trackId))),
            "publish" to true,
        )).expect(201).json
        val feature = rev["content"]["features"][0]
        assertEquals(trackId.toString(), feature["sourceTrackId"].asText())
        assertEquals(101, feature["line"]["coordinates"].size())
        assertEquals(2, feature["line"]["coordinates"][0].size())        // route geometry is 2D

        assertEquals(listOf(trackId.toString()), get("/routes/$routeId/tracks").expect(200).json["items"].map { it["id"].asText() })
        delete("/tracks/$trackId", token()).expect(403)
        delete("/tracks/$trackId", user).expect(204)
        assertEquals(0, get("/routes/$routeId/tracks").expect(200).json["items"].size())
        assertEquals(1, get("/routes/$routeId").expect(200).json["features"].size())   // the copy survives
    }

    @Test
    fun `kml without heights has no profile, gapped track cannot be imported whole, xxe is refused`() {
        val user = token()
        val mod = token(UserRole.MODERATOR)
        val areaId = createArea(mod)
        val created = post("/routes", mod, mapOf("content" to content(areaId), "publish" to true)).expect(201).json
        val routeId = created["routeId"].asText()

        val kml = """<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString>
            <coordinates>10.0,10.0 10.001,10.001 10.002,10.003</coordinates></LineString></Placemark></kml>""".toByteArray()
        val kmlId = UUID.randomUUID()
        post("/routes/$routeId/tracks", user, mapOf("id" to kmlId, "uploadId" to upload(user, "track", "application/vnd.google-earth.kml+xml", kml))).expect(201)
        val k = awaitTrack(kmlId, user)
        assertEquals("kml", k["format"].asText())
        assertTrue(k["elevationGainM"].isNull)
        get("/tracks/$kmlId/profile").expect(404)
        assertEquals(2, get("/tracks/$kmlId/geometry").expect(200).json["coordinates"][0][0].size())   // no fake Z

        // Two segments 5 km apart do not merge into one line.
        val seg1 = (0..5).map { Triple(10.0, 10.0 + it * 0.0001, 1000.0) }
        val seg2 = (0..5).map { Triple(10.05, 10.0 + it * 0.0001, 1000.0) }
        val gapId = UUID.randomUUID()
        post("/routes/$routeId/tracks", user, mapOf("id" to gapId, "uploadId" to upload(user, "track", "application/gpx+xml", gpx(listOf(seg1, seg2))))).expect(201)
        awaitTrack(gapId, user)
        val res = post("/routes/$routeId/revisions", mod, mapOf(
            "baseRevisionId" to created["id"].asText(),
            "content" to content(areaId, features = listOf(mapOf("kind" to "route_line", "sourceTrackId" to gapId))),
        )).expect(400)
        assertEquals("track-not-contiguous", res.json["type"].asText())

        val xxe = """<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>
            <gpx><trk><trkseg><trkpt lat="10" lon="10"><name>&x;</name></trkpt><trkpt lat="10.1" lon="10"/></trkseg></trk></gpx>""".toByteArray()
        val xxeId = UUID.randomUUID()
        post("/routes/$routeId/tracks", user, mapOf("id" to xxeId, "uploadId" to upload(user, "track", "application/gpx+xml", xxe))).expect(201)
        assertEquals("failed", awaitTrack(xxeId, user, allowFailed = true)["processingStatus"].asText())
    }

    private fun gpx(segments: List<List<Triple<Double, Double, Double>>>): ByteArray {
        val segs = segments.joinToString("") { seg ->
            "<trkseg>" + seg.mapIndexed { i, (lon, lat, ele) ->
                "<trkpt lat=\"$lat\" lon=\"$lon\"><ele>$ele</ele><time>2026-07-01T05:%02d:00Z</time></trkpt>".format(i % 60)
            }.joinToString("") + "</trkseg>"
        }
        return "<?xml version=\"1.0\"?><gpx version=\"1.1\" xmlns=\"http://www.topografix.com/GPX/1/1\"><trk>$segs</trk></gpx>".toByteArray()
    }

    private fun awaitTrack(id: UUID, token: String, allowFailed: Boolean = false): JsonNode {
        repeat(100) {
            val t = get("/tracks/$id", token).expect(200).json
            when (t["processingStatus"].asText()) {
                "ready" -> return t
                "failed" -> if (allowFailed) return t else throw AssertionError("Track failed: ${t["processingError"]}")
            }
            Thread.sleep(100)
        }
        throw AssertionError("Track was not processed in time")
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
    private fun upload(token: String, purpose: String, contentType: String, bytes: ByteArray, fileName: String? = null): String {
        val slot = post("/uploads", token, mapOf("purpose" to purpose, "contentType" to contentType, "sizeBytes" to bytes.size, "fileName" to fileName)).expect(201).json
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
