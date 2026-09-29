package com.alproutes.common

import com.fasterxml.jackson.annotation.JsonInclude
import org.springframework.http.HttpStatus
import java.util.UUID

/** RFC 9457 body, see Problem in /shared/openapi.yaml. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class Problem(
    val type: String,
    val title: String,
    val status: Int,
    val detail: String? = null,
    val instance: String? = null,
    val errors: List<FieldError>? = null,
    val currentRevisionId: UUID? = null,
)

data class FieldError(val field: String, val message: String)

/** Any expected failure. Mapped to problem+json by [ErrorHandler]; user-facing text is Russian. */
class ApiException(
    val status: HttpStatus,
    val type: String,
    override val message: String,
    val errors: List<FieldError>? = null,
    val currentRevisionId: UUID? = null,
) : RuntimeException(message)

fun badRequest(message: String, errors: List<FieldError>? = null) =
    ApiException(HttpStatus.BAD_REQUEST, "validation-error", message, errors)

fun fieldError(field: String, message: String) =
    badRequest("Некорректные данные", listOf(FieldError(field, message)))

fun unauthorized(message: String = "Требуется вход") =
    ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", message)

fun forbidden(message: String = "Недостаточно прав") =
    ApiException(HttpStatus.FORBIDDEN, "forbidden", message)

fun notFound(message: String = "Не найдено") =
    ApiException(HttpStatus.NOT_FOUND, "not-found", message)

fun conflict(type: String, message: String, currentRevisionId: UUID? = null) =
    ApiException(HttpStatus.CONFLICT, type, message, currentRevisionId = currentRevisionId)

/** Collects field errors and throws them all at once, so the form can highlight every problem. */
class Validator {
    private val errors = mutableListOf<FieldError>()

    fun check(condition: Boolean, field: String, message: String) {
        if (!condition) errors += FieldError(field, message)
    }

    fun error(field: String, message: String) {
        errors += FieldError(field, message)
    }

    val hasErrors: Boolean get() = errors.isNotEmpty()

    fun throwIfAny() {
        if (errors.isNotEmpty()) throw badRequest("Некорректные данные", errors.toList())
    }
}

inline fun validate(block: Validator.() -> Unit) {
    Validator().apply(block).throwIfAny()
}
