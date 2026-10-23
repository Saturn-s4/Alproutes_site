package com.alproutes

import com.alproutes.common.params
import com.alproutes.users.UserRole
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.security.MessageDigest

class AuthAndMiscTest : IntegrationTest() {

    private fun sha256(v: String) = MessageDigest.getInstance("SHA-256").digest(v.toByteArray())

    @Test
    fun `refresh rotates tokens and detects reuse`() {
        val first = login()
        val second = post("/auth/refresh", null, mapOf("refreshToken" to first.refreshToken)).expect(200).json
        val secondRefresh = second["refreshToken"].asText()
        assertNotEquals(first.refreshToken, secondRefresh)

        // Parallel refresh from the same client within the grace period: 401, session survives.
        post("/auth/refresh", null, mapOf("refreshToken" to first.refreshToken)).expect(401)
        val third = post("/auth/refresh", null, mapOf("refreshToken" to secondRefresh)).expect(200).json

        // Reuse long after rotation = theft: the whole chain is revoked.
        jdbc.update(
            """
            UPDATE refresh_tokens SET created_at = now() - interval '2 hours', revoked_at = now() - interval '1 hour'
             WHERE token_hash = :h
            """.trimIndent(),
            params { }.addValue("h", sha256(secondRefresh)),
        )
        post("/auth/refresh", null, mapOf("refreshToken" to secondRefresh)).expect(401)
        post("/auth/refresh", null, mapOf("refreshToken" to third["refreshToken"].asText())).expect(401)
    }

    @Test
    fun `me requires a valid token and problem json is returned`() {
        val res = get("/me").expect(401)
        assertEquals("unauthorized", res.json["type"].asText())
        assertEquals("application/problem+json", res.result.response.contentType?.substringBefore(';'))
        get("/me", "not-a-jwt").expect(401)
        val roles = get("/me", token(UserRole.MODERATOR)).expect(200).json["roles"].map { it.asText() }
        assertEquals(listOf("user", "moderator"), roles)
    }

    @Test
    fun `a user can hold several roles`() {
        val user = users.insert("multi-${java.util.UUID.randomUUID()}@test.local", "Тест", setOf(UserRole.MODERATOR, UserRole.ADMIN))
        val token = tokens.issue(user, null).accessToken
        assertEquals(listOf("user", "moderator", "admin"), get("/me", token).expect(200).json["roles"].map { it.asText() })
        // Moderator-only endpoint is open to the holder of both roles.
        get("/moderation/route-revisions", token).expect(200)
        get("/moderation/route-revisions", token()).expect(403)
    }

    @Test
    fun `refresh token lives 35 days from issue`() {
        val pair = login()
        val days = java.time.Duration.between(pair.accessTokenExpiresAt, pair.refreshTokenExpiresAt).toDays()
        assertEquals(34, days) // 35 days minus the 15-minute access token lifetime, truncated
    }

    @Test
    fun `blocked account cannot refresh or write and deleted account is hidden`() {
        val pair = login()
        val id = pair.user.id
        jdbc.update("UPDATE users SET blocked_at = now() WHERE id = :id", params { uuid("id", id) })
        post("/auth/refresh", null, mapOf("refreshToken" to pair.refreshToken)).expect(401)
        patch("/me", pair.accessToken, mapOf("displayName" to "Новое имя")).expect(403)
        get("/users/$id").expect(200)

        jdbc.update("UPDATE users SET deleted_at = now() WHERE id = :id", params { uuid("id", id) })
        get("/users/$id").expect(404)
    }

    @Test
    fun `apple sign-in is not available`() {
        post("/auth/oauth/apple", null, mapOf("idToken" to "x")).expect(404)
    }

    @Test
    fun `logout revokes the refresh token`() {
        val pair = login()
        post("/auth/logout", null, mapOf("refreshToken" to pair.refreshToken)).expect(204)
        post("/auth/refresh", null, mapOf("refreshToken" to pair.refreshToken)).expect(401)
    }

    @Test
    fun `dev login does not exist outside the dev profile`() {
        post("/auth/dev-login", null, mapOf("email" to "x@test.local")).expect(404)
    }

    @Test
    fun `upload slot is a presigned PUT with size and type limits`() {
        val user = token()
        val slot = post("/uploads", user, mapOf("purpose" to "photo", "contentType" to "image/jpeg", "sizeBytes" to 1_000_000)).expect(201).json
        val url = slot["url"].asText()
        assertTrue(url.contains("/alproutes-media/photo/"), url)
        assertTrue(url.contains("X-Amz-Signature="), url)
        assertEquals("PUT", slot["method"].asText())
        assertEquals("image/jpeg", slot["headers"]["content-type"]?.asText() ?: slot["headers"]["Content-Type"].asText())

        post("/uploads", user, mapOf("purpose" to "photo", "contentType" to "image/jpeg", "sizeBytes" to 31L * 1024 * 1024)).expect(413)
        post("/uploads", user, mapOf("purpose" to "photo", "contentType" to "application/pdf", "sizeBytes" to 1000)).expect(400)
        post("/uploads", null, mapOf("purpose" to "photo", "contentType" to "image/jpeg", "sizeBytes" to 1000)).expect(401)
    }

    @Test
    fun `grade systems come from the reference table`() {
        val items = get("/grade-systems").expect(200).json["items"]
        assertEquals(listOf("RU", "IFAS", "UIAA", "FR_FREE", "YDS", "AID", "WI"), items.map { it["code"].asText() })
        assertTrue(items[0]["values"].any { it["value"].asText() == "5Б" })
    }

    @Test
    fun `areas are editable by moderators only and form a hierarchy`() {
        val mod = token(UserRole.MODERATOR)
        val root = createArea(mod, "Корень")
        val child = post("/areas", mod, mapOf("parentId" to root, "type" to "summit", "slug" to "summit-${root.toString().take(8)}",
            "name" to mapOf("ru" to "Вершина"), "elevationM" to 5000, "status" to "published")).expect(201).json
        assertEquals(root.toString(), child["ancestors"].last()["id"].asText())

        post("/areas", token(), mapOf("type" to "region", "slug" to "nope", "name" to mapOf("ru" to "x"))).expect(403)
        // Cycle: the root cannot be moved under its own child.
        patch("/areas/$root", mod, mapOf("parentId" to child["id"].asText())).expect(400)
        // Elevation is only for summits.
        patch("/areas/$root", mod, mapOf("elevationM" to 3000)).expect(400)
        val renamed = patch("/areas/${child["id"].asText()}", mod, mapOf("name" to mapOf("ru" to "Вершина", "en" to "Summit"))).expect(200).json
        assertEquals("Summit", renamed["name"]["en"].asText())
        assertEquals(1, get("/areas?parentId=$root").expect(200).json["items"].size())
    }
}
