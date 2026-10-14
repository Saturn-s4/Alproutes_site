package com.alproutes

import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.util.concurrent.CopyOnWriteArrayList

/** Answers like Nominatim's /search (jsonv2) and records what it was asked. */
object FakeNominatim {
    val requests = CopyOnWriteArrayList<Map<String, String>>()
    val userAgents = CopyOnWriteArrayList<String>()
    @Volatile var status = 200
    @Volatile var body = "[]"

    private val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/search") { ex ->
            requests += ex.requestURI.rawQuery.split("&").associate {
                val (k, v) = it.split("=", limit = 2)
                k to URLDecoder.decode(v, Charsets.UTF_8)
            }
            userAgents += ex.requestHeaders.getFirst("User-Agent").orEmpty()
            val bytes = body.toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        start()
    }

    val url: String get() = "http://127.0.0.1:${server.address.port}"

    fun reset() {
        requests.clear()
        userAgents.clear()
        status = 200
        body = "[]"
    }
}

class PlacesTest : IntegrationTest() {

    @BeforeEach
    fun reset() = FakeNominatim.reset()

    @Test
    fun `place search maps Nominatim answers and caches them`() {
        FakeNominatim.body = """
            [
              {"osm_type":"node","osm_id":77,"lat":"51.67","lon":"39.19","category":"shop","type":"outdoor",
               "name":"Дых-Тау","display_name":"Дых-Тау, Воронеж, Россия"},
              {"osm_type":"node","osm_id":78,"lat":"43.5","lon":"43.6","category":"place","type":"village",
               "name":"Дых-Тау","display_name":"Дых-Тау, Россия"},
              {"osm_type":"node","osm_id":26862675,"lat":"43.0525","lon":"43.1314","category":"natural","type":"peak",
               "name":"Дых-Тау","display_name":"Дых-Тау, Кабардино-Балкария, Россия","boundingbox":["43.0","43.1","43.1","43.2"]},
              {"osm_type":"way","osm_id":123,"lat":"43.03","lon":"43.05","category":"natural","type":"glacier",
               "name":"","display_name":"Безенгийский ледник, Кабардино-Балкария, Россия","boundingbox":["43.0","43.1","42.9","43.2"]},
              {"osm_type":"node","osm_id":1,"lat":"oops","lon":"43"}
            ]
        """.trimIndent()

        val page = get("/places?q=Дых-Тау&lang=ru&bbox=42.9,43.0,43.3,43.2").expect(200).json
        val items = page["items"]
        assertEquals(listOf("node/26862675", "way/123", "node/78"), items.map { it["id"].asText() },
            "terrain first, then settlements; the shop and the result without valid coordinates are dropped")
        assertTrue(page["nextCursor"].isNull)
        assertEquals("node/26862675", items[0]["id"].asText())
        assertEquals("Дых-Тау", items[0]["name"].asText())
        assertEquals("natural:peak", items[0]["category"].asText())
        assertEquals(listOf(43.1314, 43.0525), items[0]["location"]["coordinates"].map { it.asDouble() })
        assertTrue(items[0]["bbox"].isNull, "a node gets no bounding box")
        assertEquals("Безенгийский ледник", items[1]["name"].asText(), "a missing name comes from the label")
        assertEquals(listOf(42.9, 43.0, 43.2, 43.1), items[1]["bbox"].map { it.asDouble() })

        val sent = FakeNominatim.requests.single()
        assertEquals("Дых-Тау", sent["q"])
        assertEquals("24", sent["limit"], "asks for more than shown, to have something left after filtering")
        assertEquals("ru", sent["accept-language"])
        assertEquals("42.9,43.2,43.3,43.0", sent["viewbox"])
        assertEquals("0", sent["bounded"])
        assertTrue(FakeNominatim.userAgents.single().startsWith("AlpRoutes"))

        // Same words, slightly moved view: served from the cache.
        get("/places?q=дых-тау&lang=ru&bbox=42.91,43.01,43.31,43.21").expect(200)
        assertEquals(1, FakeNominatim.requests.size)
    }

    @Test
    fun `place search validates input and reports an unavailable geocoder`() {
        assertEquals("validation-error", get("/places?q=x").expect(400).json["type"].asText())
        get("/places?q=Эльбрус&lang=de").expect(400)
        get("/places?q=Эльбрус&limit=11").expect(400)
        get("/places?q=Эльбрус&bbox=1,2,3").expect(400)
        assertEquals(0, FakeNominatim.requests.size)

        FakeNominatim.status = 500
        assertEquals("geocoder-unavailable", get("/places?q=Ушба${System.nanoTime()}").expect(503).json["type"].asText())
    }
}
