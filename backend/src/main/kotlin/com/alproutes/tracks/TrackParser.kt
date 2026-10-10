package com.alproutes.tracks

import java.io.ByteArrayInputStream
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import javax.xml.stream.XMLInputFactory
import javax.xml.stream.XMLStreamConstants
import javax.xml.stream.XMLStreamReader
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** One recorded point. [ele] is null when the file has no elevation for it. */
data class TrackPoint(val lon: Double, val lat: Double, val ele: Double?)

data class ParsedTrack(val format: String, val segments: List<List<TrackPoint>>, val firstTime: OffsetDateTime?)

class TrackFormatException(message: String) : RuntimeException(message)

private const val MAX_POINTS = 200_000

/**
 * GPX 1.0/1.1 (tracks, or routes when there are no tracks) and KML (LineString, gx:Track).
 * StAX with DTDs and external entities disabled: uploaded XML is untrusted (XXE).
 */
object TrackParser {
    private val factory: XMLInputFactory = XMLInputFactory.newFactory().apply {
        setProperty(XMLInputFactory.SUPPORT_DTD, false)
        setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false)
        setProperty(XMLInputFactory.IS_NAMESPACE_AWARE, true)
    }

    fun parse(bytes: ByteArray): ParsedTrack {
        val r = try {
            factory.createXMLStreamReader(ByteArrayInputStream(bytes))
        } catch (e: Exception) {
            throw TrackFormatException("Файл не является XML")
        }
        try {
            while (r.hasNext() && r.next() != XMLStreamConstants.START_ELEMENT) Unit
            if (!r.isStartElement) throw TrackFormatException("Пустой файл")
            val track = when (r.localName) {
                "gpx" -> gpx(r)
                "kml" -> kml(r)
                else -> throw TrackFormatException("Ожидается GPX или KML, а не <${r.localName}>")
            }
            val segments = track.segments.filter { it.size >= 2 }
            if (segments.isEmpty()) throw TrackFormatException("В файле нет линии хотя бы из двух точек")
            return track.copy(segments = segments)
        } catch (e: TrackFormatException) {
            throw e
        } catch (e: Exception) {
            throw TrackFormatException("Не удалось разобрать файл: ${e.message?.take(200)}")
        } finally {
            r.close()
        }
    }

    private fun gpx(r: XMLStreamReader): ParsedTrack {
        val trk = mutableListOf<List<TrackPoint>>()
        val rte = mutableListOf<List<TrackPoint>>()
        var current: MutableList<TrackPoint>? = null
        var firstTime: OffsetDateTime? = null
        var count = 0
        while (r.hasNext()) {
            when (r.next()) {
                XMLStreamConstants.START_ELEMENT -> when (r.localName) {
                    "trkseg" -> current = mutableListOf()
                    "rte" -> current = mutableListOf()
                    "trkpt", "rtept" -> {
                        val lat = r.getAttributeValue(null, "lat")?.toDoubleOrNull()
                        val lon = r.getAttributeValue(null, "lon")?.toDoubleOrNull()
                        var ele: Double? = null
                        // Read children of the point: <ele>, <time>.
                        var depth = 1
                        while (depth > 0 && r.hasNext()) {
                            when (r.next()) {
                                XMLStreamConstants.START_ELEMENT -> {
                                    when (r.localName) {
                                        "ele" -> { ele = r.elementText.trim().toDoubleOrNull(); continue }
                                        "time" -> {
                                            val t = r.elementText.trim()
                                            if (firstTime == null) firstTime = runCatching { OffsetDateTime.parse(t) }.getOrNull()
                                            continue
                                        }
                                    }
                                    depth++
                                }
                                XMLStreamConstants.END_ELEMENT -> depth--
                            }
                        }
                        if (lat != null && lon != null && validLonLat(lon, lat)) {
                            if (++count > MAX_POINTS) throw TrackFormatException("Слишком много точек (больше $MAX_POINTS)")
                            current?.add(TrackPoint(lon, lat, ele))
                        }
                    }
                }
                XMLStreamConstants.END_ELEMENT -> when (r.localName) {
                    "trkseg" -> { current?.let { trk += it }; current = null }
                    "rte" -> { current?.let { rte += it }; current = null }
                }
            }
        }
        // A recorded track wins over a planned route in the same file.
        return ParsedTrack("gpx", trk.ifEmpty { rte }, firstTime)
    }

    private fun kml(r: XMLStreamReader): ParsedTrack {
        val segments = mutableListOf<List<TrackPoint>>()
        var inLineString = false
        var gxTrack: MutableList<TrackPoint>? = null
        var firstTime: OffsetDateTime? = null
        var count = 0
        fun add(list: MutableList<TrackPoint>, p: TrackPoint?) {
            if (p == null) return
            if (++count > MAX_POINTS) throw TrackFormatException("Слишком много точек (больше $MAX_POINTS)")
            list += p
        }
        while (r.hasNext()) {
            when (r.next()) {
                XMLStreamConstants.START_ELEMENT -> when (r.localName) {
                    "LineString" -> inLineString = true
                    "coordinates" -> if (inLineString) {
                        val seg = mutableListOf<TrackPoint>()
                        r.elementText.trim().split(Regex("\\s+")).forEach { add(seg, kmlCoord(it.split(','))) }
                        segments += seg
                    }
                    "Track" -> gxTrack = mutableListOf()
                    "coord" -> gxTrack?.let { add(it, kmlCoord(r.elementText.trim().split(Regex("\\s+")))) }
                    "when" -> if (gxTrack != null && firstTime == null) {
                        firstTime = runCatching { OffsetDateTime.parse(r.elementText.trim()) }.getOrNull()
                    }
                }
                XMLStreamConstants.END_ELEMENT -> when (r.localName) {
                    "LineString" -> inLineString = false
                    "Track" -> { gxTrack?.let { segments += it }; gxTrack = null }
                }
            }
        }
        return ParsedTrack("kml", segments, firstTime)
    }

    /** KML order is lon, lat[, alt]. */
    private fun kmlCoord(parts: List<String>): TrackPoint? {
        val lon = parts.getOrNull(0)?.toDoubleOrNull() ?: return null
        val lat = parts.getOrNull(1)?.toDoubleOrNull() ?: return null
        if (!validLonLat(lon, lat)) return null
        return TrackPoint(lon, lat, parts.getOrNull(2)?.toDoubleOrNull())
    }

    private fun validLonLat(lon: Double, lat: Double) = lon in -180.0..180.0 && lat in -90.0..90.0
}

data class TrackStats(
    val elevationGainM: Int?,
    val elevationLossM: Int?,
    val minElevationM: Int?,
    val maxElevationM: Int?,
    /** [distanceM, elevationM] after resampling and smoothing; null without elevations. */
    val profile: List<List<Int>>?,
    val recordedOn: LocalDate?,
)

/**
 * Elevation statistics from a smoothed profile, never from raw points: GPS and barometric heights
 * jitter by metres, and summing raw differences inflates the gain several times over.
 *
 * Steps: distance along the track → resample every [STEP_M] → moving average over ±[WINDOW_M] →
 * gain/loss counted with a [HYSTERESIS_M] dead band. DEM checking is not done yet.
 */
object TrackStatsCalculator {
    private const val STEP_M = 10.0
    private const val WINDOW_M = 50.0
    private const val HYSTERESIS_M = 3.0
    private const val MAX_PROFILE_POINTS = 500

    fun compute(track: ParsedTrack): TrackStats {
        val recordedOn = track.firstTime?.withOffsetSameInstant(ZoneOffset.UTC)?.toLocalDate()
        // Segments are joined for the profile: distance keeps growing across gaps.
        val pts = track.segments.flatten()
        val withEle = pts.count { it.ele != null }
        if (withEle < pts.size / 2 || withEle < 2) return TrackStats(null, null, null, null, null, recordedOn)

        val dist = DoubleArray(pts.size)
        for (i in 1 until pts.size) dist[i] = dist[i - 1] + haversine(pts[i - 1], pts[i])
        val known = pts.indices.filter { pts[it].ele != null }
        val total = dist.last()
        if (total < STEP_M) return TrackStats(null, null, null, null, null, recordedOn)

        // Resample on a regular distance grid, interpolating elevation between known points.
        val n = (total / STEP_M).toInt() + 1
        val grid = DoubleArray(n)
        var k = 0
        for (s in 0 until n) {
            val d = s * STEP_M
            while (k < known.size - 2 && dist[known[k + 1]] < d) k++
            val a = known[k]
            val b = known[min(k + 1, known.size - 1)]
            val ea = pts[a].ele!!
            val eb = pts[b].ele!!
            grid[s] = if (dist[b] == dist[a]) ea else ea + (eb - ea) * ((d - dist[a]) / (dist[b] - dist[a])).coerceIn(0.0, 1.0)
        }

        val half = (WINDOW_M / STEP_M).toInt()
        val smooth = DoubleArray(n) { i ->
            var sum = 0.0
            var cnt = 0
            for (j in max(0, i - half)..min(n - 1, i + half)) { sum += grid[j]; cnt++ }
            sum / cnt
        }

        var gain = 0.0
        var loss = 0.0
        var ref = smooth[0]
        for (e in smooth) {
            val diff = e - ref
            if (diff >= HYSTERESIS_M) { gain += diff; ref = e } else if (diff <= -HYSTERESIS_M) { loss -= diff; ref = e }
        }

        val stride = max(1, (n + MAX_PROFILE_POINTS - 1) / MAX_PROFILE_POINTS)
        val profile = (0 until n step stride).map { listOf((it * STEP_M).roundToInt(), smooth[it].roundToInt()) }.toMutableList()
        if ((n - 1) % stride != 0) profile += listOf(total.roundToInt(), smooth[n - 1].roundToInt())

        return TrackStats(
            elevationGainM = gain.roundToInt(),
            elevationLossM = loss.roundToInt(),
            minElevationM = smooth.min().roundToInt(),
            maxElevationM = smooth.max().roundToInt(),
            profile = profile,
            recordedOn = recordedOn,
        )
    }

    fun haversine(a: TrackPoint, b: TrackPoint): Double {
        val r = 6_371_008.8
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLon = Math.toRadians(b.lon - a.lon)
        val h = sin(dLat / 2).let { it * it } + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2).let { it * it }
        return 2 * r * asin(sqrt(min(1.0, h)))
    }
}
