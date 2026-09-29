package com.alproutes

import com.alproutes.auth.TokenPair
import com.alproutes.auth.TokenService
import com.alproutes.users.UserRepository
import com.alproutes.users.UserRole
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.MvcResult
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertEquals

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfig {
    /** Real PostGIS: the geo parts of the schema cannot be tested on plain PostgreSQL. */
    @Bean
    @ServiceConnection
    fun postgres(): PostgreSQLContainer<*> =
        PostgreSQLContainer<Nothing>(DockerImageName.parse("postgis/postgis:16-3.4").asCompatibleSubstituteFor("postgres"))
}

@SpringBootTest(properties = ["alproutes.auth.jwt-secret=test-secret-0123456789abcdef0123456789"])
@AutoConfigureMockMvc
@Import(TestcontainersConfig::class)
abstract class IntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var users: UserRepository
    @Autowired lateinit var tokens: TokenService
    @Autowired lateinit var jdbc: NamedParameterJdbcTemplate

    fun login(role: UserRole = UserRole.USER): TokenPair {
        val user = users.insert("user-${UUID.randomUUID()}@test.local", "Тест", role)
        return tokens.issue(user, null)
    }

    fun token(role: UserRole = UserRole.USER): String = login(role).accessToken

    fun get(path: String, token: String? = null): Response = call(MockMvcRequestBuilders.get(path), token, null)
    fun post(path: String, token: String?, body: Any? = null): Response = call(MockMvcRequestBuilders.post(path), token, body)
    fun patch(path: String, token: String?, body: Any): Response = call(MockMvcRequestBuilders.patch(path), token, body)

    private fun call(builder: MockHttpServletRequestBuilder, token: String?, body: Any?): Response {
        token?.let { builder.header("Authorization", "Bearer $it") }
        if (body != null) builder.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
        return Response(mvc.perform(builder).andReturn(), mapper)
    }

    class Response(val result: MvcResult, private val mapper: ObjectMapper) {
        val status: Int get() = result.response.status
        val json: JsonNode by lazy {
            val text = result.response.getContentAsString(Charsets.UTF_8)
            if (text.isEmpty()) mapper.nullNode() else mapper.readTree(text)
        }

        fun expect(status: Int): Response {
            assertEquals(status, this.status, "Unexpected status. Body: ${result.response.getContentAsString(Charsets.UTF_8)}")
            return this
        }
    }

    // ---- fixtures

    fun point(lon: Double, lat: Double) = mapOf("type" to "Point", "coordinates" to listOf(lon, lat))
    fun line(vararg pts: Pair<Double, Double>) = mapOf("type" to "LineString", "coordinates" to pts.map { listOf(it.first, it.second) })

    fun createArea(moderatorToken: String, name: String = "Тестовый район"): UUID {
        val res = post("/areas", moderatorToken, mapOf(
            "type" to "region",
            "slug" to "area-${UUID.randomUUID().toString().take(8)}",
            "name" to mapOf("ru" to name),
            "status" to "published",
        )).expect(201)
        return UUID.fromString(res.json["id"].asText())
    }

    fun content(areaId: UUID, name: String = "Тестовый маршрут", grades: List<Map<String, String>> = listOf(mapOf("system" to "RU", "value" to "5Б")),
                features: List<Map<String, Any?>> = emptyList(), extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("areaId" to areaId, "name" to mapOf("ru" to name), "grades" to grades, "features" to features) + extra
}
