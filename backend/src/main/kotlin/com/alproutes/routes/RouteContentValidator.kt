package com.alproutes.routes

import com.alproutes.areas.AreaRepository
import com.alproutes.common.ApiException
import com.alproutes.common.Validator
import com.alproutes.common.conflict
import com.alproutes.common.lineString
import com.alproutes.common.localized
import com.alproutes.common.params
import com.alproutes.common.point
import com.alproutes.common.uuid
import com.alproutes.grades.GradeRepository
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Component
import java.time.Year
import java.util.UUID

/**
 * Service-level validation of a route snapshot. The database enforces the same rules again;
 * this layer exists to return precise field errors instead of a generic constraint violation.
 */
@Component
class RouteContentValidator(
    private val areas: AreaRepository,
    private val grades: GradeRepository,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    /** [routeId] is null for a brand-new route (then GPX import is impossible: no tracks yet). */
    fun validate(content: RouteContent, routeId: UUID?, prefix: String = "content") {
        val v = Validator()
        v.check(areas.exists(content.areaId), "$prefix.areaId", "Район не найден")
        v.localized(content.name, "$prefix.name", required = true, maxLength = 200)
        v.localized(content.description, "$prefix.description", required = false, maxLength = 100_000)

        v.check(content.grades.size <= 10, "$prefix.grades", "Не больше 10 категорий")
        val seen = mutableSetOf<String>()
        content.grades.forEachIndexed { i, g ->
            val field = "$prefix.grades[$i]"
            if (!seen.add(g.system)) v.error("$field.system", "Система ${g.system} указана дважды: не больше одной категории на систему")
            if (!grades.systemExists(g.system)) {
                v.error("$field.system", "Неизвестная система категорий")
            } else if (grades.sortOrder(g.system, g.value) == null) {
                // Typical case: Latin "5B" instead of Cyrillic "5Б". Values must come from GET /grade-systems.
                v.error("$field.value", "Нет значения «${g.value}» в системе ${g.system}")
            }
        }

        content.elevationGainM?.let { v.check(it in 1..8999, "$prefix.elevationGainM", "От 1 до 8999 м") }
        content.lengthM?.let { v.check(it in 1..1_000_000, "$prefix.lengthM", "От 1 м") }
        content.seasonMonths?.let { months ->
            v.check(months.isNotEmpty(), "$prefix.seasonMonths", "Пустой список: для «нет данных» передайте null")
            v.check(months.all { it in 1..12 }, "$prefix.seasonMonths", "Месяцы от 1 до 12")
            v.check(months.toSet().size == months.size, "$prefix.seasonMonths", "Месяцы повторяются")
        }
        content.firstAscentParty?.let { v.check(it.isNotBlank() && it.length <= 1000, "$prefix.firstAscentParty", "До 1000 символов") }
        content.firstAscentYear?.let {
            v.check(it in 1700..Year.now().value, "$prefix.firstAscentYear", "От 1700 до текущего года")
        }
        content.dataSources?.let { v.check(it.isNotBlank() && it.length <= 2000, "$prefix.dataSources", "До 2000 символов") }

        v.check(content.features.size <= 50, "$prefix.features", "Не больше 50 объектов")
        content.features.forEachIndexed { i, f -> feature(v, f, "$prefix.features[$i]", routeId) }
        v.throwIfAny()

        // Checks whose failure is not a field format problem (409/400 with their own type).
        content.features.forEachIndexed { i, f ->
            if (f.sourceTrackId != null && f.line == null) checkTrackImport(f.sourceTrackId, routeId!!, "$prefix.features[$i]")
        }
    }

    private fun feature(v: Validator, f: RouteFeature, field: String, routeId: UUID?) {
        if (f.kind.isPoint) {
            v.check(f.line == null, "$field.line", "Для «${f.kind.wire}» нужна точка, не линия")
            v.check(f.sourceTrackId == null, "$field.sourceTrackId", "Импорт из трека — только для линий")
            if (f.point == null) v.error("$field.point", "Обязательно для «${f.kind.wire}»") else v.point(f.point, "$field.point")
            f.elevationM?.let { v.check(it in -500..9000, "$field.elevationM", "От -500 до 9000") }
        } else {
            v.check(f.point == null, "$field.point", "Для «${f.kind.wire}» нужна линия, не точка")
            v.check(f.elevationM == null, "$field.elevationM", "Высота указывается только у точек")
            when {
                f.line != null -> v.lineString(f.line, "$field.line")
                f.sourceTrackId == null -> v.error("$field.line", "Нужна линия или sourceTrackId")
                routeId == null -> v.error("$field.sourceTrackId", "Импорт из трека возможен только в существующий маршрут")
            }
        }
        v.localized(f.note, "$field.note", required = false, maxLength = 1000)
    }

    private fun checkTrackImport(trackId: UUID, routeId: UUID, field: String) {
        val track = jdbc.query(
            """
            SELECT route_id, processing_status, deleted_at IS NOT NULL AS deleted,
                   ST_GeometryType(ST_LineMerge(geometry)) AS merged_type
              FROM tracks WHERE id = :id
            """.trimIndent(),
            params { uuid("id", trackId) },
        ) { rs, _ ->
            TrackInfo(rs.uuid("route_id"), rs.getString("processing_status"), rs.getBoolean("deleted"), rs.getString("merged_type"))
        }.firstOrNull()

        if (track == null || track.deleted || track.routeId != routeId) {
            throw com.alproutes.common.fieldError("$field.sourceTrackId", "Трек этого маршрута не найден")
        }
        if (track.processingStatus != "ready") throw conflict("invalid-state", "Трек ещё обрабатывается или обработка не удалась")
        if (track.mergedType != "ST_LineString") {
            throw ApiException(HttpStatus.BAD_REQUEST, "track-not-contiguous",
                "Сегменты трека не склеиваются в одну линию: обрежьте трек в редакторе и пришлите линию")
        }
    }

    private data class TrackInfo(val routeId: UUID, val processingStatus: String, val deleted: Boolean, val mergedType: String?)
}
