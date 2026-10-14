package com.alproutes.places

import com.alproutes.common.ApiException
import com.alproutes.common.Bbox
import com.alproutes.common.GeoJsonPoint
import com.alproutes.common.Page
import com.alproutes.common.fieldError
import com.alproutes.common.validLat
import com.alproutes.common.validLon
import com.alproutes.config.AppProperties
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.Instant
import kotlin.math.floor

/** A place from OpenStreetMap, only for moving the map (contract Place). */
data class Place(
    val id: String,
    val name: String,
    val label: String,
    val category: String,
    val location: GeoJsonPoint,
    val bbox: List<Double>?,
)

data class PlaceQuery(val q: String, val lang: String, val bbox: Bbox?, val limit: Int)

class GeocoderUnavailable(message: String, cause: Throwable? = null) : IOException(message, cause)

/** Talks to a Nominatim server (`/search`, jsonv2). Knows nothing about caching or rate limits. */
@Component
class NominatimClient(private val props: AppProperties, private val mapper: ObjectMapper) {
    private val http: HttpClient = HttpClient.newBuilder()
        .connectTimeout(props.places.timeout)
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()

    val enabled: Boolean get() = props.places.url.isNotBlank()

    fun search(query: PlaceQuery): List<Place> {
        val params = buildMap {
            put("q", query.q)
            put("format", "jsonv2")
            put("limit", query.limit.toString())
            put("accept-language", query.lang)
            // A preference, not a filter: places in view come first, the rest of the world still matches.
            query.bbox?.let { put("viewbox", "${it.minLon},${it.maxLat},${it.maxLon},${it.minLat}"); put("bounded", "0") }
            props.places.email.takeIf { it.isNotBlank() }?.let { put("email", it) }
        }
        val qs = params.entries.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, Charsets.UTF_8)}" }
        val request = HttpRequest.newBuilder(URI.create("${props.places.url.trimEnd('/')}/search?$qs"))
            .timeout(props.places.timeout)
            .header("User-Agent", props.places.userAgent)
            .header("Accept", "application/json")
            .GET()
            .build()
        val response = try {
            http.send(request, HttpResponse.BodyHandlers.ofString())
        } catch (e: IOException) {
            throw GeocoderUnavailable("Nominatim request failed", e)
        }
        if (response.statusCode() != 200) throw GeocoderUnavailable("Nominatim answered ${response.statusCode()}")
        val body = try {
            mapper.readTree(response.body())
        } catch (e: IOException) {
            throw GeocoderUnavailable("Nominatim answered with something other than JSON", e)
        }
        return body.mapNotNull(::toPlace)
    }

    private fun toPlace(n: JsonNode): Place? {
        val lon = n.path("lon").asText().toDoubleOrNull() ?: return null
        val lat = n.path("lat").asText().toDoubleOrNull() ?: return null
        if (!validLon(lon) || !validLat(lat)) return null
        val osmType = n.path("osm_type").asText()
        val label = n.path("display_name").asText()
        // Nominatim's boundingbox is [minLat, maxLat, minLon, maxLon]; a node's box is only padding around the point.
        val box = n.path("boundingbox").map { it.asText().toDoubleOrNull() }
        val bbox = if (osmType != "node" && box.size == 4 && box.all { it != null }) {
            listOf(box[2]!!, box[0]!!, box[3]!!, box[1]!!)
        } else null
        return Place(
            id = "$osmType/${n.path("osm_id").asText()}",
            name = n.path("name").asText().ifBlank { label.substringBefore(',') },
            label = label,
            category = "${n.path("category").asText()}:${n.path("type").asText()}",
            location = GeoJsonPoint("Point", listOf(lon, lat)),
            bbox = bbox,
        )
    }
}

/**
 * Validation, cache and the request rate the geocoder allows. The public Nominatim server takes
 * one request per second from the whole application, so requests queue for their turn and
 * repeated searches (typing, panning back) are served from the cache.
 */
@Service
class PlaceService(private val client: NominatimClient, private val props: AppProperties) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val cache = object : LinkedHashMap<String, Pair<Instant, List<Place>>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Instant, List<Place>>>) =
            size > props.places.cacheSize
    }
    private val turnLock = Any()
    private var nextTurn = Instant.EPOCH

    fun search(q: String, lang: String?, bbox: String?, limit: Int?): Page<Place> {
        val text = q.trim().replace(Regex("\\s+"), " ")
        if (text.length < 2 || text.length > 100) throw fieldError("q", "От 2 до 100 символов")
        val language = lang ?: "ru"
        if (language !in setOf("ru", "en")) throw fieldError("lang", "Допустимо ru или en")
        val size = limit ?: 8
        if (size < 1 || size > 10) throw fieldError("limit", "Допустимо от 1 до 10")
        val box = bbox?.let { Bbox.parse(it) }
        if (!client.enabled) throw unavailable()

        // Ask for more than shown: shops and offices named after a summit are dropped, the rest reordered.
        val query = PlaceQuery(text, language, box, minOf(size * 3, 40))
        val key = cacheKey(query)
        synchronized(cache) {
            cache[key]?.let { (at, places) -> if (at.plus(props.places.cacheTtl).isAfter(Instant.now())) return Page(places.take(size), null) }
        }
        waitForTurn()
        val places = try {
            forMountains(client.search(query))
        } catch (e: GeocoderUnavailable) {
            log.warn("Place search failed: {}", e.message)
            throw unavailable()
        }
        synchronized(cache) { cache[key] = Instant.now() to places }
        return Page(places.take(size), null)
    }

    /**
     * Relevance for a mountaineer: terrain and settlements first, huts and parks next, and nothing
     * from shops, offices or roads (a summit's name is a popular shop name). Nominatim's own order
     * is kept within each group.
     */
    private fun forMountains(places: List<Place>): List<Place> =
        places.mapNotNull { p -> rank(p.category)?.let { it to p } }.sortedBy { it.first }.map { it.second }

    private fun rank(category: String): Int? {
        val (cls, type) = category.split(":", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        return when {
            cls == "natural" || cls == "mountain_pass" || (cls == "place" && type in TERRAIN_PLACES) -> 0
            cls == "place" -> 1
            cls == "tourism" && type in setOf("alpine_hut", "wilderness_hut", "camp_site", "viewpoint") -> 2
            cls == "waterway" || cls == "boundary" || cls == "leisure" || cls == "landuse" -> 3
            cls in DROPPED || cls == "tourism" -> null
            else -> 4
        }
    }

    /** The view only reorders results, so nearby views share a cache entry (a 0.5° grid). */
    private fun cacheKey(q: PlaceQuery): String {
        val grid = { v: Double -> floor(v * 2) / 2 }
        val box = q.bbox?.let { "${grid(it.minLon)},${grid(it.minLat)},${grid(it.maxLon)},${grid(it.maxLat)}" } ?: "-"
        return "${q.lang}|${q.limit}|$box|${q.q.lowercase()}"
    }

    private fun waitForTurn() {
        val wait = synchronized(turnLock) {
            val now = Instant.now()
            val turn = if (nextTurn.isAfter(now)) nextTurn else now
            val wait = Duration.between(now, turn)
            if (wait > props.places.maxWait) {
                throw ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate-limited", "Слишком много запросов к поиску мест, повторите через несколько секунд")
            }
            nextTurn = turn.plus(props.places.minInterval)
            wait
        }
        if (!wait.isZero) Thread.sleep(wait.toMillis())
    }

    private fun unavailable() =
        ApiException(HttpStatus.SERVICE_UNAVAILABLE, "geocoder-unavailable", "Поиск мест OpenStreetMap сейчас недоступен")
}

private val TERRAIN_PLACES = setOf("locality", "isolated_dwelling", "island", "islet")
private val DROPPED = setOf(
    "shop", "amenity", "office", "craft", "building", "highway", "railway", "healthcare", "club",
    "emergency", "man_made", "power", "aeroway", "public_transport", "historic", "military",
)

@RestController
class PlaceController(private val places: PlaceService) {

    @GetMapping("/places")
    fun search(
        @RequestParam q: String,
        @RequestParam(required = false) lang: String?,
        @RequestParam(required = false) bbox: String?,
        @RequestParam(required = false) limit: Int?,
    ) = places.search(q, lang, bbox, limit)
}
