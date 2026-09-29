package com.alproutes.common

import com.fasterxml.jackson.databind.ObjectMapper

// GeoJSON DTOs. Coordinates are [lon, lat]; route features and points are strictly 2D.

data class GeoJsonPoint(val type: String, val coordinates: List<Double>)

data class GeoJsonLineString(val type: String, val coordinates: List<List<Double>>)

data class GeoJsonMultiPolygon(val type: String, val coordinates: List<List<List<List<Double>>>>)

data class LonLat(val lon: Double, val lat: Double)

data class Bbox(val minLon: Double, val minLat: Double, val maxLon: Double, val maxLat: Double) {
    companion object {
        /** `minLon,minLat,maxLon,maxLat`. Boxes crossing the antimeridian are not supported. */
        fun parse(value: String, field: String = "bbox"): Bbox {
            val parts = value.split(",").map { it.trim().toDoubleOrNull() }
            if (parts.size != 4 || parts.any { it == null }) {
                throw fieldError(field, "Ожидается minLon,minLat,maxLon,maxLat")
            }
            val (minLon, minLat, maxLon, maxLat) = parts.map { it!! }
            val v = Validator()
            v.check(validLon(minLon) && validLon(maxLon), field, "Долгота вне диапазона -180..180")
            v.check(validLat(minLat) && validLat(maxLat), field, "Широта вне диапазона -90..90")
            v.check(minLon < maxLon && minLat < maxLat, field, "Минимум должен быть меньше максимума")
            v.throwIfAny()
            return Bbox(minLon, minLat, maxLon, maxLat)
        }
    }
}

fun parseLonLat(value: String, field: String): LonLat {
    val parts = value.split(",").map { it.trim().toDoubleOrNull() }
    if (parts.size != 2 || parts.any { it == null }) throw fieldError(field, "Ожидается lon,lat")
    val lon = parts[0]!!
    val lat = parts[1]!!
    if (!validLon(lon) || !validLat(lat)) throw fieldError(field, "Координаты вне диапазона")
    return LonLat(lon, lat)
}

fun validLon(v: Double) = v.isFinite() && v >= -180.0 && v <= 180.0
fun validLat(v: Double) = v.isFinite() && v >= -90.0 && v <= 90.0

private fun Validator.position(pos: List<Double>, field: String) {
    if (pos.size != 2) {
        error(field, "Ожидается [lon, lat]; высоты не хранятся")
        return
    }
    check(validLon(pos[0]) && validLat(pos[1]), field, "Координаты вне диапазона (порядок — [lon, lat])")
}

fun Validator.point(p: GeoJsonPoint, field: String) {
    check(p.type == "Point", "$field.type", "Ожидается Point")
    position(p.coordinates, "$field.coordinates")
}

fun Validator.lineString(l: GeoJsonLineString, field: String, maxPoints: Int = 10_000) {
    check(l.type == "LineString", "$field.type", "Ожидается LineString")
    check(l.coordinates.size in 2..maxPoints, "$field.coordinates", "От 2 до $maxPoints точек")
    l.coordinates.forEachIndexed { i, pos -> position(pos, "$field.coordinates[$i]") }
}

/** Structure only; topological validity (self-intersections) is checked by ST_IsValid in the database. */
fun Validator.multiPolygon(mp: GeoJsonMultiPolygon, field: String) {
    check(mp.type == "MultiPolygon", "$field.type", "Ожидается MultiPolygon")
    check(mp.coordinates.isNotEmpty(), "$field.coordinates", "Пустой контур")
    mp.coordinates.forEachIndexed { pi, polygon ->
        check(polygon.isNotEmpty(), "$field.coordinates[$pi]", "Пустой полигон")
        polygon.forEachIndexed { ri, ring ->
            val f = "$field.coordinates[$pi][$ri]"
            check(ring.size >= 4, f, "Кольцо — минимум 4 точки")
            check(ring.isEmpty() || ring.first() == ring.last(), f, "Кольцо должно быть замкнуто")
            ring.forEachIndexed { i, pos -> position(pos, "$f[$i]") }
        }
    }
}

/** Reads ST_AsGeoJSON output; null stays null. */
inline fun <reified T> ObjectMapper.geo(json: String?): T? = json?.let { readValue(it, T::class.java) }
