package com.alproutes.common

import com.fasterxml.jackson.databind.JsonMappingException
import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.DuplicateKeyException
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.AuthenticationException
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.servlet.resource.NoResourceFoundException

@RestControllerAdvice
class ErrorHandler {
    private val log = LoggerFactory.getLogger(javaClass)

    @ExceptionHandler(ApiException::class)
    fun api(ex: ApiException, req: HttpServletRequest) =
        problem(ex.status, ex.type, ex.message, req, ex.errors, ex.currentRevisionId)

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun unreadable(ex: HttpMessageNotReadableException, req: HttpServletRequest): ResponseEntity<Problem> {
        val mapping = ex.cause as? JsonMappingException
        val path = mapping?.path?.joinToString(".") { it.fieldName ?: "[${it.index}]" }?.replace(".[", "[")
        val errors = if (!path.isNullOrEmpty()) listOf(FieldError(path, "Отсутствует или имеет неверный формат")) else null
        return problem(HttpStatus.BAD_REQUEST, "validation-error", "Тело запроса не разобрано", req, errors)
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException::class)
    fun typeMismatch(ex: MethodArgumentTypeMismatchException, req: HttpServletRequest) =
        problem(HttpStatus.BAD_REQUEST, "validation-error", "Некорректный параметр", req,
            listOf(FieldError(ex.name, "Неверный формат значения")))

    @ExceptionHandler(MissingServletRequestParameterException::class)
    fun missingParam(ex: MissingServletRequestParameterException, req: HttpServletRequest) =
        problem(HttpStatus.BAD_REQUEST, "validation-error", "Не указан параметр", req,
            listOf(FieldError(ex.parameterName, "Обязательный параметр")))

    @ExceptionHandler(DuplicateKeyException::class)
    fun duplicate(ex: DuplicateKeyException, req: HttpServletRequest): ResponseEntity<Problem> {
        log.info("Unique violation: {}", ex.mostSpecificCause.message)
        return problem(HttpStatus.CONFLICT, "conflict", "Такой объект уже существует", req)
    }

    /** A CHECK/FK violation that got past service validation: the database is the last line of defence. */
    @ExceptionHandler(DataIntegrityViolationException::class)
    fun integrity(ex: DataIntegrityViolationException, req: HttpServletRequest): ResponseEntity<Problem> {
        log.warn("Integrity violation not caught by validation: {}", ex.mostSpecificCause.message)
        return problem(HttpStatus.BAD_REQUEST, "validation-error", "Данные нарушают ограничения базы", req)
    }

    @ExceptionHandler(AccessDeniedException::class)
    fun denied(ex: AccessDeniedException, req: HttpServletRequest) =
        problem(HttpStatus.FORBIDDEN, "forbidden", "Недостаточно прав", req)

    @ExceptionHandler(AuthenticationException::class)
    fun unauthenticated(ex: AuthenticationException, req: HttpServletRequest) =
        problem(HttpStatus.UNAUTHORIZED, "unauthorized", "Требуется вход", req)

    @ExceptionHandler(NoResourceFoundException::class)
    fun noResource(ex: NoResourceFoundException, req: HttpServletRequest) =
        problem(HttpStatus.NOT_FOUND, "not-found", "Не найдено", req)

    @ExceptionHandler(HttpRequestMethodNotSupportedException::class)
    fun method(ex: HttpRequestMethodNotSupportedException, req: HttpServletRequest) =
        problem(HttpStatus.METHOD_NOT_ALLOWED, "method-not-allowed", "Метод не поддерживается", req)

    @ExceptionHandler(Exception::class)
    fun unexpected(ex: Exception, req: HttpServletRequest): ResponseEntity<Problem> {
        log.error("Unhandled error on {} {}", req.method, req.requestURI, ex)
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "internal-error", "Внутренняя ошибка", req)
    }

    private fun problem(
        status: HttpStatus,
        type: String,
        detail: String,
        req: HttpServletRequest,
        errors: List<FieldError>? = null,
        currentRevisionId: java.util.UUID? = null,
    ): ResponseEntity<Problem> =
        ResponseEntity.status(status)
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(Problem(type, status.reasonPhrase, status.value(), detail, req.requestURI, errors, currentRevisionId))

    companion object {
        /** For filters that run before MVC (security entry point, access denied handler). */
        fun write(mapper: ObjectMapper, res: HttpServletResponse, status: HttpStatus, type: String, detail: String, instance: String) {
            res.status = status.value()
            res.contentType = MediaType.APPLICATION_PROBLEM_JSON_VALUE
            res.characterEncoding = "UTF-8"
            mapper.writeValue(res.outputStream, Problem(type, status.reasonPhrase, status.value(), detail, instance))
        }
    }
}
