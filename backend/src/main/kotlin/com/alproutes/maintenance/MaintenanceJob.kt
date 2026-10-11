package com.alproutes.maintenance

import com.alproutes.common.params
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.config.AppProperties
import com.alproutes.media.MediaStorage
import com.alproutes.photos.PhotoSize
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID

/** What one run removed: logged, and asserted in tests. */
data class MaintenanceReport(val expiredUploads: Int, val unattachedPhotos: Int, val duplicateDocuments: Int)

/**
 * Daily cleanup of what clients leave behind:
 * - upload slots that were never claimed (the client got a URL and gave up);
 * - photos uploaded for a route that was never created (POST /photos);
 * - documents created twice because the response to the first POST was lost (no client id there).
 *
 * Database rows go first, objects second: a failed S3 call leaves an orphan object, never a row
 * pointing at a missing file. A Postgres advisory lock keeps two backend instances from running
 * the same cleanup at once.
 */
@Component
class MaintenanceJob(
    private val jdbc: NamedParameterJdbcTemplate,
    private val tx: TransactionTemplate,
    private val storage: MediaStorage,
    private val props: AppProperties,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val cfg get() = props.maintenance

    @Scheduled(cron = "\${alproutes.maintenance.cron:0 30 3 * * *}")
    fun scheduled() {
        if (!cfg.enabled) return
        try {
            val report = runOnce()
            log.info("Maintenance: {}", report)
        } catch (e: Exception) {
            log.error("Maintenance failed", e)
        }
    }

    fun runOnce(): MaintenanceReport =
        MaintenanceReport(expiredUploads(), unattachedPhotos(), duplicateDocuments())

    // ------------------------------------------------------------------ expired upload slots

    private fun expiredUploads(): Int {
        val keys = locked("uploads") {
            jdbc.query(
                """
                DELETE FROM uploads
                 WHERE id IN (SELECT id FROM uploads
                               WHERE claimed_at IS NULL AND expires_at < now()
                               ORDER BY expires_at LIMIT :limit FOR UPDATE SKIP LOCKED)
                RETURNING storage_key
                """.trimIndent(),
                params { int("limit", cfg.batchSize) },
            ) { rs, _ -> rs.getString(1) }
        } ?: return 0
        keys.forEach { quietly(it) { storage.delete(it) } }
        return keys.size
    }

    // ------------------------------------------------------------------ unattached photos

    private fun unattachedPhotos(): Int {
        val rows = locked("photos") {
            jdbc.query(
                """
                UPDATE photos SET deleted_at = now(), updated_at = now()
                 WHERE id IN (SELECT id FROM photos
                               WHERE route_id IS NULL AND area_id IS NULL AND deleted_at IS NULL
                                 AND created_at < now() - make_interval(secs => :ttl)
                               ORDER BY created_at LIMIT :limit FOR UPDATE SKIP LOCKED)
                RETURNING id, storage_key
                """.trimIndent(),
                params { long("ttl", cfg.unattachedPhotoTtl.seconds); int("limit", cfg.batchSize) },
            ) { rs, _ -> rs.uuid("id") to rs.getString("storage_key") }
        } ?: return 0
        for ((id, key) in rows) {
            quietly(key) { storage.delete(key) }
            PhotoSize.entries.forEach { size -> quietly(size.storageKey(id)) { storage.deletePublic(size.storageKey(id)) } }
        }
        return rows.size
    }

    // ------------------------------------------------------------------ duplicate documents

    private data class DocRow(
        val id: UUID, val key: String, val uploader: UUID, val routeId: UUID?, val areaId: UUID?, val size: Long,
        val reviewed: Boolean,
    )

    /**
     * Same uploader, same route or area, same bytes (size, then the MD5 from S3): the same document
     * sent twice. One stays: the one a moderator has already reviewed, otherwise the earliest.
     */
    private fun duplicateDocuments(): Int {
        val candidates = jdbc.query(
            """
            SELECT d.id, d.storage_key, d.uploaded_by, d.route_id, d.area_id, u.size_bytes, d.rights_reviewed_at IS NOT NULL AS reviewed
              FROM documents d JOIN uploads u ON u.storage_key = d.storage_key
             WHERE d.deleted_at IS NULL AND d.created_at > now() - make_interval(secs => :window)
             ORDER BY d.created_at, d.id
            """.trimIndent(),
            params { long("window", cfg.duplicateDocumentWindow.seconds) },
        ) { rs, _ ->
            DocRow(rs.uuid("id"), rs.getString("storage_key"), rs.uuid("uploaded_by"), rs.uuidOrNull("route_id"),
                rs.uuidOrNull("area_id"), rs.getLong("size_bytes"), rs.getBoolean("reviewed"))
        }
        val duplicates = candidates
            .groupBy { listOf(it.uploader, it.routeId, it.areaId, it.size) }
            .values.filter { it.size > 1 }
            .flatMap { sameSize ->
                // Only now ask S3: most groups are a single document.
                sameSize.mapNotNull { d -> storage.etagOf(d.key)?.let { d to it } }
                    .groupBy({ it.second }, { it.first })
                    .values.filter { it.size > 1 }
                    .flatMap { same -> (same.firstOrNull { it.reviewed } ?: same.first()).let { keep -> same.filter { it !== keep } } }
            }
        if (duplicates.isEmpty()) return 0

        val removed = locked("documents") {
            jdbc.query(
                "UPDATE documents SET deleted_at = now() WHERE id IN (:ids) AND deleted_at IS NULL RETURNING storage_key",
                params { uuids("ids", duplicates.map { it.id }) },
            ) { rs, _ -> rs.getString(1) }
        } ?: return 0
        removed.forEach { quietly(it) { storage.delete(it) } }
        return removed.size
    }

    // ------------------------------------------------------------------ helpers

    /** Runs [block] in a transaction holding an advisory lock; null when another instance holds it. */
    private fun <T> locked(task: String, block: () -> T): T? = tx.execute {
        val got = jdbc.queryForObject(
            "SELECT pg_try_advisory_xact_lock(hashtext(:k))", params { str("k", "maintenance:$task") }, Boolean::class.java,
        )
        if (got == true) block() else null
    }

    private fun quietly(key: String, action: () -> Unit) {
        try {
            action()
        } catch (e: Exception) {
            log.warn("Maintenance: could not delete object {}: {}", key, e.message)
        }
    }
}
