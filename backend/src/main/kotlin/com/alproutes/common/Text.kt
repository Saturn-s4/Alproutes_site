package com.alproutes.common

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

/** {"ru": "...", "en": "..."} — see LocalizedText in the contract. */
typealias LocalizedText = Map<String, String>

private val LANG = Regex("^[a-z]{2}$")

fun Validator.localized(text: LocalizedText?, field: String, required: Boolean, maxLength: Int) {
    if (text == null) {
        check(!required, field, "Обязательное поле")
        return
    }
    check(text.isNotEmpty(), field, "Нужен хотя бы один перевод")
    text.forEach { (lang, value) ->
        check(LANG.matches(lang), "$field.$lang", "Код языка — две строчные латинские буквы (ISO 639-1)")
        check(value.isNotBlank(), "$field.$lang", "Пустой текст")
        check(value.length <= maxLength, "$field.$lang", "Не длиннее $maxLength символов")
    }
}

fun ObjectMapper.localized(json: String?): LocalizedText? = json?.let { readValue(it) }

/**
 * Enum whose JSON/DB value differs from the Kotlin constant name. Implementations annotate
 * the constructor property with `@get:JsonValue`; Jackson uses it for both directions.
 */
interface Wire {
    val wire: String
}

inline fun <reified E> wireOf(value: String): E where E : Enum<E>, E : Wire =
    enumValues<E>().firstOrNull { it.wire == value }
        ?: throw IllegalStateException("Unknown ${E::class.simpleName} value in database: $value")

inline fun <reified E> parseWire(value: String, field: String): E where E : Enum<E>, E : Wire =
    enumValues<E>().firstOrNull { it.wire == value }
        ?: throw fieldError(field, "Допустимые значения: " + enumValues<E>().joinToString { it.wire })

object Slugs {
    val PATTERN = Regex("^[a-z0-9]+(-[a-z0-9]+)*$")
    const val MAX_LENGTH = 120

    private val ru = mapOf(
        'а' to "a", 'б' to "b", 'в' to "v", 'г' to "g", 'д' to "d", 'е' to "e", 'ё' to "e",
        'ж' to "zh", 'з' to "z", 'и' to "i", 'й' to "y", 'к' to "k", 'л' to "l", 'м' to "m",
        'н' to "n", 'о' to "o", 'п' to "p", 'р' to "r", 'с' to "s", 'т' to "t", 'у' to "u",
        'ф' to "f", 'х' to "kh", 'ц' to "ts", 'ч' to "ch", 'ш' to "sh", 'щ' to "shch",
        'ъ' to "", 'ы' to "y", 'ь' to "", 'э' to "e", 'ю' to "yu", 'я' to "ya",
    )

    /** "Дых-Тау, по Маммери" -> "dykh-tau-po-mammeri". Never empty. */
    fun fromText(text: String): String {
        val latin = buildString {
            for (ch in text.lowercase()) append(ru[ch] ?: ch.toString())
        }
        val slug = latin
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .take(MAX_LENGTH - 4)   // room for a "-NNN" uniqueness suffix
            .trim('-')
        return slug.ifEmpty { "route" }
    }
}
