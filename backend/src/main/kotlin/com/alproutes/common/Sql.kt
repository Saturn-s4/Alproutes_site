package com.alproutes.common

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource
import java.sql.ResultSet
import java.sql.Types
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.UUID

/**
 * Typed SQL parameters. Every value carries an explicit JDBC type, so NULLs are sent with a
 * type too. Together with `CAST(:p AS <type>)` in SQL this avoids "could not determine data
 * type of parameter" errors from PostgreSQL for nullable parameters.
 */
class Params {
    val source = MapSqlParameterSource()

    fun str(name: String, value: String?) = apply { source.addValue(name, value, Types.VARCHAR) }
    fun int(name: String, value: Int?) = apply { source.addValue(name, value, Types.INTEGER) }
    fun long(name: String, value: Long?) = apply { source.addValue(name, value, Types.BIGINT) }
    fun double(name: String, value: Double?) = apply { source.addValue(name, value, Types.DOUBLE) }
    fun bool(name: String, value: Boolean?) = apply { source.addValue(name, value, Types.BOOLEAN) }
    fun uuid(name: String, value: UUID?) = apply { source.addValue(name, value, Types.OTHER) }

    /** For `IN (:name)`: Spring expands the collection into one placeholder per element. */
    fun uuids(name: String, values: Collection<UUID>) = apply { source.addValue(name, values) }
}

fun params(block: Params.() -> Unit): MapSqlParameterSource = Params().apply(block).source

fun ResultSet.uuid(column: String): UUID = getObject(column, UUID::class.java)
fun ResultSet.uuidOrNull(column: String): UUID? = getObject(column, UUID::class.java)
fun ResultSet.intOrNull(column: String): Int? = getInt(column).takeUnless { wasNull() }
fun ResultSet.longOrNull(column: String): Long? = getLong(column).takeUnless { wasNull() }
fun ResultSet.doubleOrNull(column: String): Double? = getDouble(column).takeUnless { wasNull() }
fun ResultSet.boolOrNull(column: String): Boolean? = getBoolean(column).takeUnless { wasNull() }
fun ResultSet.odt(column: String): OffsetDateTime = getObject(column, OffsetDateTime::class.java)
fun ResultSet.odtOrNull(column: String): OffsetDateTime? = getObject(column, OffsetDateTime::class.java)
fun ResultSet.localDateOrNull(column: String): LocalDate? = getObject(column, LocalDate::class.java)

/** Escapes LIKE wildcards; use with `ESCAPE '\'`. */
fun likePattern(query: String): String =
    "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
