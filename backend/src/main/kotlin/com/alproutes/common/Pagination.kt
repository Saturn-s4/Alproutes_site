package com.alproutes.common

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import java.util.Base64
import java.util.UUID

/** Every list endpoint returns this shape (see *Page schemas in the contract). */
data class Page<T>(val items: List<T>, val nextCursor: String?)

/**
 * Opaque keyset cursor: base64url of a JSON array of strings (sort key values, then id).
 * The SQL side casts the strings back to their types, so any sortable type round-trips.
 */
object Cursor {
    private val mapper = ObjectMapper()

    fun encode(values: List<String>): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(mapper.writeValueAsBytes(values))

    fun decode(cursor: String?, expectedSize: Int): List<String>? {
        if (cursor.isNullOrBlank()) return null
        val values: List<String> = try {
            mapper.readValue(Base64.getUrlDecoder().decode(cursor))
        } catch (e: Exception) {
            throw fieldError("cursor", "Некорректный курсор")
        }
        if (values.size != expectedSize) throw fieldError("cursor", "Курсор не подходит к этому запросу")
        return values
    }

    fun uuid(value: String): UUID = try {
        UUID.fromString(value)
    } catch (e: IllegalArgumentException) {
        throw fieldError("cursor", "Некорректный курсор")
    }
}

fun pageLimit(limit: Int?, default: Int = 20, max: Int = 100): Int {
    val value = limit ?: default
    if (value < 1 || value > max) throw fieldError("limit", "Допустимо от 1 до $max")
    return value
}

/**
 * Queries fetch limit + 1 rows: the extra row only tells whether there is a next page.
 */
fun <R, T> toPage(rows: List<R>, limit: Int, cursorOf: (R) -> List<String>, map: (R) -> T): Page<T> {
    val hasMore = rows.size > limit
    val kept = if (hasMore) rows.subList(0, limit) else rows
    return Page(kept.map(map), if (hasMore) Cursor.encode(cursorOf(kept.last())) else null)
}
