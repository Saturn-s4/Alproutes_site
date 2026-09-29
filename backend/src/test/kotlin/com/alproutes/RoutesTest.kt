package com.alproutes

import com.alproutes.users.UserRole
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.UUID

class RoutesTest : IntegrationTest() {

    private fun ids(res: Response): List<String> = res.json["items"].map { it["id"].asText() }

    @Test
    fun `route goes through moderation and is found by geo search`() {
        val mod = token(UserRole.MODERATOR)
        val user = token()
        val areaId = createArea(mod)
        // Test coordinates only; not real route data.
        val features = listOf(
            mapOf("kind" to "summit", "point" to point(10.02, 10.02), "elevationM" to 3800),
            mapOf("kind" to "start", "point" to point(10.0, 10.0)),
            mapOf("kind" to "approach", "line" to line(9.95 to 9.95, 10.0 to 10.0)),
        )
        val grades = listOf(mapOf("system" to "UIAA", "value" to "VI+"), mapOf("system" to "RU", "value" to "5Б"))
        val created = post("/routes", user, mapOf("content" to content(areaId, grades = grades, features = features))).expect(201)
        assertEquals("pending", created.json["status"].asText())
        val routeId = created.json["routeId"].asText()
        val revisionId = created.json["id"].asText()

        get("/routes/$routeId").expect(404)                       // nothing published yet
        post("/route-revisions/$revisionId/approve", user).expect(403)
        post("/route-revisions/$revisionId/approve", mod).expect(200)

        val detail = get("/routes/$routeId").expect(200).json
        assertEquals(3, detail["features"].size())
        assertEquals("RU", detail["grades"][0]["system"].asText())   // ordered by system, not by input
        assertEquals("5Б", detail["grades"][0]["value"].asText())
        assertEquals(3800, detail["features"][0]["elevationM"].asInt())
        assertTrue(detail["areaPath"].last()["id"].asText() == areaId.toString())

        // The window contains only the approach line: the route must still be found.
        val bbox = get("/routes?bbox=9.94,9.94,9.96,9.96").expect(200)
        val hit = bbox.json["items"].first { it["id"].asText() == routeId }
        assertEquals(listOf(10.0, 10.0), hit["anchorPoint"]["coordinates"].map { it.asDouble() })   // start wins

        val near = get("/routes?near=10.0,10.01&radiusM=2000").expect(200)
        val nearHit = near.json["items"].first { it["id"].asText() == routeId }
        assertTrue(nearHit["distanceM"].asDouble() in 1000.0..1200.0)
        assertFalse(ids(get("/routes?near=10.0,10.01&radiusM=500").expect(200)).contains(routeId))

        assertTrue(ids(get("/routes?areaId=$areaId&gradeSystem=RU&gradeMin=5А&gradeMax=6А").expect(200)).contains(routeId))
        assertFalse(ids(get("/routes?areaId=$areaId&gradeSystem=RU&gradeMin=6А").expect(200)).contains(routeId))
        assertTrue(ids(get("/routes/map-points?bbox=9.9,9.9,10.1,10.1").expect(200)).contains(routeId))
    }

    @Test
    fun `route without geometry is listed by area but not on the map`() {
        val mod = token(UserRole.MODERATOR)
        val areaId = createArea(mod)
        val created = post("/routes", mod, mapOf("content" to content(areaId), "publish" to true)).expect(201)
        val routeId = created.json["routeId"].asText()
        assertTrue(created.json["isCurrent"].asBoolean())
        assertTrue(ids(get("/routes?areaId=$areaId").expect(200)).contains(routeId))
        assertFalse(ids(get("/routes/map-points?bbox=-180,-90,180,90&limit=500").expect(200)).contains(routeId))
    }

    @Test
    fun `concurrent edits are detected`() {
        val mod = token(UserRole.MODERATOR)
        val areaId = createArea(mod)
        val first = post("/routes", mod, mapOf("content" to content(areaId), "publish" to true)).expect(201).json
        val routeId = first["routeId"].asText()
        val base = first["id"].asText()

        val a = post("/routes/$routeId/revisions", token(), mapOf("baseRevisionId" to base, "content" to content(areaId, name = "Правка А"))).expect(201).json
        val b = post("/routes/$routeId/revisions", token(), mapOf("baseRevisionId" to base, "content" to content(areaId, name = "Правка Б"))).expect(201).json
        post("/route-revisions/${a["id"].asText()}/approve", mod).expect(200)

        // B was based on the snapshot A replaced: approving it would silently undo A.
        val stale = post("/route-revisions/${b["id"].asText()}/approve", mod).expect(409).json
        assertEquals("revision-stale", stale["type"].asText())
        assertEquals(a["id"].asText(), stale["currentRevisionId"].asText())

        // A new edit from the outdated base is refused up front.
        val conflict = post("/routes/$routeId/revisions", token(), mapOf("baseRevisionId" to base, "content" to content(areaId))).expect(409).json
        assertEquals("revision-conflict", conflict["type"].asText())
        assertEquals(a["id"].asText(), conflict["currentRevisionId"].asText())
    }

    @Test
    fun `revert publishes a copy of an older revision`() {
        val mod = token(UserRole.MODERATOR)
        val areaId = createArea(mod)
        val v1 = post("/routes", mod, mapOf("content" to content(areaId, name = "Исходное"), "publish" to true)).expect(201).json
        val routeId = v1["routeId"].asText()
        post("/routes/$routeId/revisions", mod, mapOf("baseRevisionId" to v1["id"].asText(),
            "content" to content(areaId, name = "Вандализм"), "publish" to true)).expect(201)

        post("/route-revisions/${v1["id"].asText()}/revert", mod, mapOf<String, Any>()).expect(400)   // note is required
        val reverted = post("/route-revisions/${v1["id"].asText()}/revert", mod, mapOf("note" to "Откат вандализма")).expect(201).json
        assertEquals(3, reverted["revisionNumber"].asInt())
        assertEquals(v1["id"].asText(), reverted["revertedFromId"].asText())
        assertEquals("Исходное", get("/routes/$routeId").expect(200).json["name"]["ru"].asText())
        assertEquals(3, get("/routes/$routeId/revisions").expect(200).json["items"].size())
    }

    @Test
    fun `invalid content is rejected with field errors`() {
        val mod = token(UserRole.MODERATOR)
        val user = token()
        val areaId = createArea(mod)

        val latin = post("/routes", user, mapOf("content" to content(areaId, grades = listOf(mapOf("system" to "RU", "value" to "5B"))))).expect(400).json
        assertEquals("content.grades[0].value", latin["errors"][0]["field"].asText())

        val twice = post("/routes", user, mapOf("content" to content(areaId, grades = listOf(
            mapOf("system" to "RU", "value" to "5А"), mapOf("system" to "RU", "value" to "5Б"))))).expect(400).json
        assertEquals("content.grades[1].system", twice["errors"][0]["field"].asText())

        val wrongGeometry = post("/routes", user, mapOf("content" to content(areaId,
            features = listOf(mapOf("kind" to "summit", "line" to line(1.0 to 1.0, 2.0 to 2.0)))))).expect(400).json
        assertTrue(wrongGeometry["errors"].any { it["field"].asText() == "content.features[0].line" })

        val swapped = post("/routes", user, mapOf("content" to content(areaId,
            features = listOf(mapOf("kind" to "start", "point" to point(43.0, 143.0)))))).expect(400).json
        assertTrue(swapped["errors"].any { it["field"].asText() == "content.features[0].point.coordinates" })

        post("/routes", user, mapOf("content" to content(areaId), "publish" to true)).expect(403)
        post("/routes", null, mapOf("content" to content(areaId))).expect(401)
        post("/routes", user, mapOf("content" to content(UUID.randomUUID()))).expect(400)
    }

    @Test
    fun `slug is generated from the Russian name and kept unique`() {
        val mod = token(UserRole.MODERATOR)
        val areaId = createArea(mod)
        val name = "Пик Тестовый ${UUID.randomUUID().toString().take(4)}"
        val one = post("/routes", mod, mapOf("content" to content(areaId, name = name), "publish" to true)).expect(201).json
        val two = post("/routes", mod, mapOf("content" to content(areaId, name = name), "publish" to true)).expect(201).json
        val slug1 = get("/routes/${one["routeId"].asText()}").expect(200).json["slug"].asText()
        val slug2 = get("/routes/${two["routeId"].asText()}").expect(200).json["slug"].asText()
        assertTrue(slug1.startsWith("pik-testovyy-"))
        assertEquals("$slug1-2", slug2)
        assertEquals(one["routeId"].asText(), get("/routes/by-slug/$slug1").expect(200).json["id"].asText())
    }
}
