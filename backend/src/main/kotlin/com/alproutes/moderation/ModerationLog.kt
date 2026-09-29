package com.alproutes.moderation

import com.alproutes.common.params
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import java.util.UUID

/** Append-only audit trail of moderator actions (table moderation_log). */
@Repository
class ModerationLog(private val jdbc: NamedParameterJdbcTemplate, private val mapper: ObjectMapper) {

    fun record(
        actorId: UUID,
        action: String,
        targetType: String,
        targetId: UUID,
        note: String? = null,
        details: Map<String, Any?>? = null,
        flagId: UUID? = null,
    ) {
        jdbc.update(
            """
            INSERT INTO moderation_log (actor_id, action, target_type, target_id, flag_id, note, details)
            VALUES (:actor, :action, :targetType, :targetId, CAST(:flag AS uuid), CAST(:note AS text), CAST(:details AS jsonb))
            """.trimIndent(),
            params {
                uuid("actor", actorId); str("action", action); str("targetType", targetType); uuid("targetId", targetId)
                uuid("flag", flagId); str("note", note); str("details", details?.let { mapper.writeValueAsString(it) })
            },
        )
    }
}
