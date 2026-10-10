package com.alproutes.routes

import com.alproutes.common.GeoJsonLineString
import com.alproutes.common.GeoJsonPoint
import com.alproutes.common.boolOrNull
import com.alproutes.common.geo
import com.alproutes.common.intOrNull
import com.alproutes.common.localized
import com.alproutes.common.odt
import com.alproutes.common.odtOrNull
import com.alproutes.common.params
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.wireOf
import com.alproutes.grades.Grade
import com.alproutes.users.UserPublic
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.util.UUID

/** Lock row of a route, taken FOR UPDATE to serialize revision numbering and publication. */
data class RouteLock(val id: UUID, val status: String, val currentRevisionId: UUID?, val latestRevisionId: UUID?, val maxRevision: Int)

data class RevisionState(
    val id: UUID,
    val routeId: UUID,
    val revisionNumber: Int,
    val baseRevisionId: UUID?,
    val status: ReviewStatus,
    val isCurrent: Boolean,
    val authorId: UUID,
)

@Repository
class RouteRepository(private val jdbc: NamedParameterJdbcTemplate, private val mapper: ObjectMapper) {

    // ------------------------------------------------------------------ reads

    /** Columns of the route snapshot; expects the revision aliased as rv. */
    val contentColumns = """
        rv.area_id, rv.name::text AS name, rv.description::text AS description, rv.route_type, rv.is_traverse,
        rv.elevation_gain_m, rv.length_m, array_to_json(rv.season_months)::text AS season_months,
        rv.first_ascent_party, rv.first_ascent_year, rv.data_sources
    """.trimIndent()

    /** Content without grades and features; those are loaded in bulk by [attachChildren]. */
    fun contentBase(rs: ResultSet) = RouteContent(
        areaId = rs.uuid("area_id"),
        name = mapper.localized(rs.getString("name"))!!,
        description = mapper.localized(rs.getString("description")),
        grades = emptyList(),
        routeType = rs.getString("route_type")?.let { wireOf<RouteType>(it) },
        isTraverse = rs.boolOrNull("is_traverse"),
        elevationGainM = rs.intOrNull("elevation_gain_m"),
        lengthM = rs.intOrNull("length_m"),
        seasonMonths = rs.getString("season_months")?.let { mapper.readValue<List<Int>>(it) },
        firstAscentParty = rs.getString("first_ascent_party"),
        firstAscentYear = rs.intOrNull("first_ascent_year"),
        dataSources = rs.getString("data_sources"),
    )

    fun gradesOf(revisionIds: Collection<UUID>): Map<UUID, List<Grade>> {
        if (revisionIds.isEmpty()) return emptyMap()
        return jdbc.query(
            """
            SELECT g.revision_id, g.system_code, g.value
              FROM route_revision_grades g
              JOIN grade_systems s ON s.code = g.system_code
             WHERE g.revision_id IN (:ids)
             ORDER BY s.sort_order
            """.trimIndent(),
            params { uuids("ids", revisionIds) },
        ) { rs, _ -> rs.uuid("revision_id") to Grade(rs.getString("system_code"), rs.getString("value")) }
            .groupBy({ it.first }, { it.second })
    }

    fun featuresOf(revisionIds: Collection<UUID>): Map<UUID, List<RouteFeature>> {
        if (revisionIds.isEmpty()) return emptyMap()
        return jdbc.query(
            """
            SELECT revision_id, kind, ST_AsGeoJSON(geometry) AS geom, elevation_m, note::text AS note, source_track_id
              FROM route_revision_features
             WHERE revision_id IN (:ids)
             ORDER BY revision_id, position
            """.trimIndent(),
            params { uuids("ids", revisionIds) },
        ) { rs, _ ->
            val kind = wireOf<RouteFeatureKind>(rs.getString("kind"))
            val geom = rs.getString("geom")
            rs.uuid("revision_id") to RouteFeature(
                kind = kind,
                point = if (kind.isPoint) mapper.geo<GeoJsonPoint>(geom) else null,
                line = if (kind.isPoint) null else mapper.geo<GeoJsonLineString>(geom),
                elevationM = rs.intOrNull("elevation_m"),
                note = mapper.localized(rs.getString("note")),
                sourceTrackId = rs.uuidOrNull("source_track_id"),
            )
        }.groupBy({ it.first }, { it.second })
    }

    fun photosOf(revisionIds: Collection<UUID>): Map<UUID, List<RouteContentPhoto>> {
        if (revisionIds.isEmpty()) return emptyMap()
        return jdbc.query(
            """
            SELECT revision_id, photo_id, caption::text AS caption
              FROM route_revision_photos
             WHERE revision_id IN (:ids)
             ORDER BY revision_id, position
            """.trimIndent(),
            params { uuids("ids", revisionIds) },
        ) { rs, _ -> rs.uuid("revision_id") to RouteContentPhoto(rs.uuid("photo_id"), mapper.localized(rs.getString("caption"))) }
            .groupBy({ it.first }, { it.second })
    }

    fun attachChildren(revisionId: UUID, base: RouteContent): RouteContent = base.copy(
        grades = gradesOf(listOf(revisionId))[revisionId].orEmpty(),
        features = featuresOf(listOf(revisionId))[revisionId].orEmpty(),
        photos = photosOf(listOf(revisionId))[revisionId].orEmpty(),
    )

    private val revisionSummaryColumns = """
        rv.id, rv.route_id, rv.revision_number, rv.base_revision_id, rv.reverted_from_id, rv.change_summary,
        rv.created_at, rv.status, rv.is_current, rv.reviewed_at, rv.review_note,
        au.id AS author_id, au.display_name AS author_name,
        rb.id AS reviewer_id, rb.display_name AS reviewer_name
    """.trimIndent()

    private val revisionJoins = """
        FROM route_revisions rv
        JOIN users au ON au.id = rv.author_id
        LEFT JOIN users rb ON rb.id = rv.reviewed_by
    """.trimIndent()

    private fun revisionSummary(rs: ResultSet) = RouteRevisionSummary(
        id = rs.uuid("id"),
        routeId = rs.uuid("route_id"),
        revisionNumber = rs.getInt("revision_number"),
        baseRevisionId = rs.uuidOrNull("base_revision_id"),
        revertedFromId = rs.uuidOrNull("reverted_from_id"),
        author = UserPublic(rs.uuid("author_id"), rs.getString("author_name"), null),
        changeSummary = rs.getString("change_summary"),
        createdAt = rs.odt("created_at"),
        status = wireOf(rs.getString("status")),
        isCurrent = rs.getBoolean("is_current"),
        reviewedBy = rs.uuidOrNull("reviewer_id")?.let { UserPublic(it, rs.getString("reviewer_name"), null) },
        reviewedAt = rs.odtOrNull("reviewed_at"),
        reviewNote = rs.getString("review_note"),
    )

    fun revision(id: UUID): RouteRevision? {
        val row = jdbc.query(
            "SELECT $revisionSummaryColumns, $contentColumns $revisionJoins WHERE rv.id = :id",
            params { uuid("id", id) },
        ) { rs, _ -> revisionSummary(rs) to contentBase(rs) }.firstOrNull() ?: return null
        return RouteRevision(row.first, attachChildren(id, row.second))
    }

    /**
     * Revisions of a route, newest first. [visibleTo]: null = moderator (sees everything);
     * otherwise approved revisions plus the caller's own (or only approved for anonymous).
     */
    fun revisions(
        routeId: UUID, status: ReviewStatus?, moderator: Boolean, callerId: UUID?, afterNumber: Int?, limit: Int,
    ): List<RouteRevisionSummary> {
        val where = mutableListOf("rv.route_id = :routeId")
        if (!moderator) where += if (callerId != null) "(rv.status = 'approved' OR rv.author_id = :caller)" else "rv.status = 'approved'"
        if (status != null) where += "rv.status = :status"
        if (afterNumber != null) where += "rv.revision_number < :after"
        return jdbc.query(
            "SELECT $revisionSummaryColumns $revisionJoins WHERE ${where.joinToString(" AND ")} ORDER BY rv.revision_number DESC LIMIT :limit",
            params {
                uuid("routeId", routeId); uuid("caller", callerId); str("status", status?.wire)
                int("after", afterNumber); int("limit", limit + 1)
            },
        ) { rs, _ -> revisionSummary(rs) }
    }

    /** Moderation queue: pending revisions, oldest first. Cursor = (created_at, id). */
    fun pending(afterCreated: String?, afterId: UUID?, limit: Int): List<RouteRevisionSummary> {
        val cursorCond = if (afterCreated != null) "AND (rv.created_at, rv.id) > (CAST(:c AS timestamptz), CAST(:cid AS uuid))" else ""
        return jdbc.query(
            """
            SELECT $revisionSummaryColumns $revisionJoins
             WHERE rv.status = 'pending' $cursorCond
             ORDER BY rv.created_at, rv.id
             LIMIT :limit
            """.trimIndent(),
            params { str("c", afterCreated); uuid("cid", afterId); int("limit", limit + 1) },
        ) { rs, _ -> revisionSummary(rs) }
    }

    /** created_at as text with full precision, for the keyset cursor. */
    fun createdAtText(revisionId: UUID): String = jdbc.queryForObject(
        "SELECT created_at::text FROM route_revisions WHERE id = :id", params { uuid("id", revisionId) }, String::class.java,
    )!!

    fun revisionState(id: UUID, forUpdate: Boolean): RevisionState? = jdbc.query(
        """
        SELECT id, route_id, revision_number, base_revision_id, status, is_current, author_id
          FROM route_revisions WHERE id = :id ${if (forUpdate) "FOR UPDATE" else ""}
        """.trimIndent(),
        params { uuid("id", id) },
    ) { rs, _ ->
        RevisionState(
            rs.uuid("id"), rs.uuid("route_id"), rs.getInt("revision_number"), rs.uuidOrNull("base_revision_id"),
            wireOf(rs.getString("status")), rs.getBoolean("is_current"), rs.uuid("author_id"),
        )
    }.firstOrNull()

    fun routeIdBySlug(slug: String): UUID? = jdbc.query(
        "SELECT id FROM routes WHERE slug = :slug", params { str("slug", slug) },
    ) { rs, _ -> rs.uuid("id") }.firstOrNull()

    fun routeStatus(id: UUID): String? = jdbc.query(
        "SELECT status FROM routes WHERE id = :id", params { uuid("id", id) },
    ) { rs, _ -> rs.getString("status") }.firstOrNull()

    fun lockRoute(id: UUID): RouteLock? = jdbc.query(
        """
        SELECT r.id, r.status,
               (SELECT rv.id FROM route_revisions rv WHERE rv.route_id = r.id AND rv.is_current) AS current_id,
               (SELECT rv.id FROM route_revisions rv WHERE rv.route_id = r.id ORDER BY rv.revision_number DESC LIMIT 1) AS latest_id,
               (SELECT COALESCE(max(rv.revision_number), 0) FROM route_revisions rv WHERE rv.route_id = r.id) AS max_revision
          FROM routes r
         WHERE r.id = :id
           FOR UPDATE OF r
        """.trimIndent(),
        params { uuid("id", id) },
    ) { rs, _ ->
        RouteLock(rs.uuid("id"), rs.getString("status"), rs.uuidOrNull("current_id"), rs.uuidOrNull("latest_id"), rs.getInt("max_revision"))
    }.firstOrNull()

    fun slugsStartingWith(base: String): Set<String> = jdbc.query(
        "SELECT slug FROM routes WHERE slug = :base OR slug LIKE :prefix",
        params { str("base", base); str("prefix", "$base-%") },
    ) { rs, _ -> rs.getString("slug") }.toSet()

    // ----------------------------------------------------------------- writes

    fun insertRoute(id: UUID, slug: String, createdBy: UUID) {
        jdbc.update(
            "INSERT INTO routes (id, slug, created_by) VALUES (:id, :slug, :by)",
            params { uuid("id", id); str("slug", slug); uuid("by", createdBy) },
        )
    }

    /** Inserts a pending revision with its grades and features: the whole snapshot at once. */
    fun insertRevision(
        id: UUID,
        routeId: UUID,
        number: Int,
        baseRevisionId: UUID?,
        revertedFromId: UUID?,
        authorId: UUID,
        changeSummary: String?,
        content: RouteContent,
    ) {
        jdbc.update(
            """
            INSERT INTO route_revisions (
                id, route_id, revision_number, base_revision_id, reverted_from_id, author_id, change_summary,
                area_id, name, description, route_type, is_traverse, elevation_gain_m, length_m, season_months,
                first_ascent_party, first_ascent_year, data_sources)
            VALUES (
                :id, :routeId, :number, CAST(:base AS uuid), CAST(:reverted AS uuid), :author, CAST(:summary AS text),
                :areaId, CAST(:name AS jsonb), CAST(:description AS jsonb), CAST(:routeType AS text),
                CAST(:traverse AS boolean), CAST(:gain AS integer), CAST(:length AS integer), CAST(:months AS smallint[]),
                CAST(:party AS text), CAST(:year AS smallint), CAST(:sources AS text))
            """.trimIndent(),
            params {
                uuid("id", id); uuid("routeId", routeId); int("number", number); uuid("base", baseRevisionId)
                uuid("reverted", revertedFromId); uuid("author", authorId); str("summary", changeSummary)
                uuid("areaId", content.areaId); str("name", mapper.writeValueAsString(content.name))
                str("description", content.description?.let { mapper.writeValueAsString(it) })
                str("routeType", content.routeType?.wire); bool("traverse", content.isTraverse)
                int("gain", content.elevationGainM); int("length", content.lengthM)
                str("months", content.seasonMonths?.joinToString(",", "{", "}"))
                str("party", content.firstAscentParty); int("year", content.firstAscentYear); str("sources", content.dataSources)
            },
        )
        for (g in content.grades) {
            jdbc.update(
                "INSERT INTO route_revision_grades (revision_id, system_code, value) VALUES (:rev, :sys, :val)",
                params { uuid("rev", id); str("sys", g.system); str("val", g.value) },
            )
        }
        content.features.forEachIndexed { position, f ->
            val common = params {
                uuid("rev", id); int("pos", position); str("kind", f.kind.wire); int("elevation", f.elevationM)
                str("note", f.note?.let { mapper.writeValueAsString(it) }); uuid("track", f.sourceTrackId)
            }
            if (f.point == null && f.line == null) {
                // Import from a GPX track: the geometry is copied into the snapshot (validated by the service).
                jdbc.update(
                    """
                    INSERT INTO route_revision_features (revision_id, position, kind, geometry, elevation_m, note, source_track_id)
                    SELECT :rev, :pos, :kind, ST_Force2D(ST_LineMerge(t.geometry)), CAST(:elevation AS integer),
                           CAST(:note AS jsonb), t.id
                      FROM tracks t WHERE t.id = CAST(:track AS uuid)
                    """.trimIndent(),
                    common,
                )
            } else {
                val geometry = mapper.writeValueAsString(f.point ?: f.line)
                jdbc.update(
                    """
                    INSERT INTO route_revision_features (revision_id, position, kind, geometry, elevation_m, note, source_track_id)
                    VALUES (:rev, :pos, :kind, ST_SetSRID(ST_GeomFromGeoJSON(CAST(:geom AS text)), 4326),
                            CAST(:elevation AS integer), CAST(:note AS jsonb), CAST(:track AS uuid))
                    """.trimIndent(),
                    common.addValue("geom", geometry),
                )
            }
        }
        content.photos.forEachIndexed { position, ph ->
            jdbc.update(
                """
                INSERT INTO route_revision_photos (revision_id, position, photo_id, caption)
                VALUES (:rev, :pos, :photo, CAST(:caption AS jsonb))
                """.trimIndent(),
                params {
                    uuid("rev", id); int("pos", position); uuid("photo", ph.photoId)
                    str("caption", ph.caption?.let { mapper.writeValueAsString(it) })
                },
            )
        }
    }

    /** Copies grades, features and description photos of [fromRevision] into the pending [toRevision] (used by revert). */
    fun copyRevision(fromRevision: UUID, toRevision: UUID, routeId: UUID, number: Int, baseRevisionId: UUID?, authorId: UUID, summary: String) {
        jdbc.update(
            """
            INSERT INTO route_revisions (
                id, route_id, revision_number, base_revision_id, reverted_from_id, author_id, change_summary,
                area_id, name, description, route_type, is_traverse, elevation_gain_m, length_m, season_months,
                first_ascent_party, first_ascent_year, data_sources)
            SELECT :to, route_id, :number, CAST(:base AS uuid), id, :author, :summary,
                   area_id, name, description, route_type, is_traverse, elevation_gain_m, length_m, season_months,
                   first_ascent_party, first_ascent_year, data_sources
              FROM route_revisions WHERE id = :from AND route_id = :routeId
            """.trimIndent(),
            params {
                uuid("to", toRevision); int("number", number); uuid("base", baseRevisionId); uuid("author", authorId)
                str("summary", summary); uuid("from", fromRevision); uuid("routeId", routeId)
            },
        )
        jdbc.update(
            """
            INSERT INTO route_revision_grades (revision_id, system_code, value)
            SELECT :to, system_code, value FROM route_revision_grades WHERE revision_id = :from
            """.trimIndent(),
            params { uuid("to", toRevision); uuid("from", fromRevision) },
        )
        jdbc.update(
            """
            INSERT INTO route_revision_features (revision_id, position, kind, geometry, elevation_m, note, source_track_id)
            SELECT :to, position, kind, geometry, elevation_m, note, source_track_id
              FROM route_revision_features WHERE revision_id = :from
            """.trimIndent(),
            params { uuid("to", toRevision); uuid("from", fromRevision) },
        )
        jdbc.update(
            """
            INSERT INTO route_revision_photos (revision_id, position, photo_id, caption)
            SELECT :to, position, photo_id, caption FROM route_revision_photos WHERE revision_id = :from
            """.trimIndent(),
            params { uuid("to", toRevision); uuid("from", fromRevision) },
        )
    }

    /** Makes [revisionId] the published snapshot. The caller holds the route lock. */
    fun publish(routeId: UUID, revisionId: UUID, previousCurrent: UUID?, reviewerId: UUID, note: String?) {
        if (previousCurrent != null) {
            jdbc.update("UPDATE route_revisions SET is_current = false WHERE id = :id", params { uuid("id", previousCurrent) })
        }
        jdbc.update(
            """
            UPDATE route_revisions
               SET status = 'approved', is_current = true, reviewed_by = :reviewer, reviewed_at = now(),
                   review_note = CAST(:note AS text)
             WHERE id = :id
            """.trimIndent(),
            params { uuid("id", revisionId); uuid("reviewer", reviewerId); str("note", note) },
        )
        // A hidden route stays hidden; its content is still updated. updated_at is bumped by trigger.
        jdbc.update(
            "UPDATE routes SET status = CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'published' END WHERE id = :id",
            params { uuid("id", routeId) },
        )
    }

    fun reject(revisionId: UUID, reviewerId: UUID, note: String) {
        jdbc.update(
            """
            UPDATE route_revisions
               SET status = 'rejected', reviewed_by = :reviewer, reviewed_at = now(), review_note = :note
             WHERE id = :id
            """.trimIndent(),
            params { uuid("id", revisionId); uuid("reviewer", reviewerId); str("note", note) },
        )
    }
}
