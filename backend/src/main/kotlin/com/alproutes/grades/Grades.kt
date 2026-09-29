package com.alproutes.grades

import com.alproutes.common.Cursor
import com.alproutes.common.LocalizedText
import com.alproutes.common.Page
import com.alproutes.common.localized
import com.alproutes.common.pageLimit
import com.alproutes.common.params
import com.alproutes.common.toPage
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** A grade in a specific system. Always shown together with the system; never converted. */
data class Grade(val system: String, val value: String)

data class GradeValue(val value: String, val sortOrder: Int)

data class GradeSystem(
    val code: String,
    val kind: String,
    val name: LocalizedText,
    val values: List<GradeValue>,
)

@Repository
class GradeRepository(private val jdbc: NamedParameterJdbcTemplate, private val mapper: ObjectMapper) {

    fun page(cursor: String?, limit: Int): Page<GradeSystem> {
        val after = Cursor.decode(cursor, 1)?.get(0)?.toIntOrNull()
        val systems = jdbc.query(
            """
            SELECT code, kind, name::text AS name, sort_order
              FROM grade_systems
             WHERE sort_order > :after
             ORDER BY sort_order
             LIMIT :limit
            """.trimIndent(),
            params { int("after", after ?: Int.MIN_VALUE); int("limit", limit + 1) },
        ) { rs, _ -> Triple(rs.getString("code"), rs.getString("kind"), rs.getString("name")) to rs.getInt("sort_order") }

        val codes = systems.map { it.first.first }
        val values = if (codes.isEmpty()) emptyMap() else jdbc.query(
            "SELECT system_code, value, sort_order FROM grade_values WHERE system_code IN (:codes) ORDER BY sort_order",
            params { }.addValue("codes", codes),
        ) { rs, _ -> rs.getString("system_code") to GradeValue(rs.getString("value"), rs.getInt("sort_order")) }
            .groupBy({ it.first }, { it.second })

        return toPage(systems, limit, cursorOf = { listOf(it.second.toString()) }) { (s, _) ->
            GradeSystem(s.first, s.second, mapper.localized(s.third)!!, values[s.first].orEmpty())
        }
    }

    /** sort_order of a value within its system, or null if the pair does not exist. */
    fun sortOrder(system: String, value: String): Int? = jdbc.query(
        "SELECT sort_order FROM grade_values WHERE system_code = :s AND value = :v",
        params { str("s", system); str("v", value) },
    ) { rs, _ -> rs.getInt("sort_order") }.firstOrNull()

    fun systemExists(system: String): Boolean = jdbc.queryForObject(
        "SELECT EXISTS (SELECT 1 FROM grade_systems WHERE code = :s)",
        params { str("s", system) },
        Boolean::class.java,
    ) == true
}

@RestController
class GradeController(private val grades: GradeRepository) {

    @GetMapping("/grade-systems")
    fun list(@RequestParam(required = false) cursor: String?, @RequestParam(required = false) limit: Int?) =
        grades.page(cursor, pageLimit(limit))
}
