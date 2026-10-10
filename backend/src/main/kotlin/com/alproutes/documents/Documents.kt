package com.alproutes.documents

import com.alproutes.auth.Caller
import com.alproutes.common.ApiException
import com.alproutes.common.Cursor
import com.alproutes.common.LocalizedText
import com.alproutes.common.Page
import com.alproutes.common.Wire
import com.alproutes.common.fieldError
import com.alproutes.common.forbidden
import com.alproutes.common.intOrNull
import com.alproutes.common.localized
import com.alproutes.common.notFound
import com.alproutes.common.odt
import com.alproutes.common.pageLimit
import com.alproutes.common.params
import com.alproutes.common.parseWire
import com.alproutes.common.toPage
import com.alproutes.common.uuid
import com.alproutes.common.uuidOrNull
import com.alproutes.common.validate
import com.alproutes.common.wireOf
import com.alproutes.media.MediaStorage
import com.alproutes.moderation.ModerationLog
import com.alproutes.uploads.UploadService
import com.alproutes.users.UserPublic
import com.alproutes.users.UserRepository
import com.fasterxml.jackson.annotation.JsonValue
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.sql.ResultSet
import java.time.OffsetDateTime
import java.util.UUID

// ------------------------------------------------------------------- DTOs (contract: Document*)

enum class SourceType(@get:JsonValue override val wire: String) : Wire {
    CLASSIFIER("classifier"), ASCENT_REPORT("ascent_report"), GUIDEBOOK("guidebook"), PERIODICAL("periodical"), OTHER("other")
}

enum class RightsStatus(@get:JsonValue override val wire: String, val publishable: Boolean, val needsNote: Boolean) : Wire {
    UNKNOWN("unknown", false, false),
    PUBLIC_DOMAIN("public_domain", true, false),
    LICENSED("licensed", true, true),
    PERMISSION_GRANTED("permission_granted", true, true),
    OWN_WORK("own_work", true, false),
    RESTRICTED("restricted", false, false),
}

data class Document(
    val id: UUID,
    val routeId: UUID?,
    val areaId: UUID?,
    val title: LocalizedText,
    val sourceType: SourceType,
    val sourceDescription: String,
    val year: Int?,
    val pageCount: Int?,
    val rightsStatus: RightsStatus,
    val rightsNote: String?,
    val visibility: String,
    val processingStatus: String,
    val uploadedBy: UserPublic,
    val createdAt: OffsetDateTime,
)

data class DocumentCreate(
    val uploadId: UUID,
    val title: LocalizedText,
    val sourceType: String,
    val sourceDescription: String,
    val year: Int? = null,
    val claimedRightsStatus: String? = null,
    val rightsNote: String? = null,
)

data class DocumentRightsUpdate(val rightsStatus: String, val rightsNote: String? = null, val visibility: String)

// ------------------------------------------------------------------- repository

internal data class DocumentRow(val doc: Document, val storageKey: String, val deleted: Boolean, val createdAtText: String)

@Repository
class DocumentRepository(private val jdbc: NamedParameterJdbcTemplate, private val mapper: ObjectMapper) {
    private val columns = """
        d.id, d.route_id, d.area_id, d.title::text AS title, d.source_type, d.source_description, d.year, d.page_count,
        d.rights_status, d.rights_note, d.visibility, d.processing_status, d.storage_key, d.deleted_at IS NOT NULL AS deleted,
        d.created_at, d.created_at::text AS created_at_text, u.id AS uploader_id, u.display_name AS uploader_name
    """.trimIndent()

    private val from = "FROM documents d JOIN users u ON u.id = d.uploaded_by"

    private fun row(rs: ResultSet) = DocumentRow(
        Document(
            id = rs.uuid("id"),
            routeId = rs.uuidOrNull("route_id"),
            areaId = rs.uuidOrNull("area_id"),
            title = mapper.localized(rs.getString("title"))!!,
            sourceType = wireOf(rs.getString("source_type")),
            sourceDescription = rs.getString("source_description"),
            year = rs.intOrNull("year"),
            pageCount = rs.intOrNull("page_count"),
            rightsStatus = wireOf(rs.getString("rights_status")),
            rightsNote = rs.getString("rights_note"),
            visibility = rs.getString("visibility"),
            processingStatus = rs.getString("processing_status"),
            uploadedBy = UserPublic(rs.uuid("uploader_id"), rs.getString("uploader_name"), null),
            createdAt = rs.odt("created_at"),
        ),
        rs.getString("storage_key"),
        rs.getBoolean("deleted"),
        rs.getString("created_at_text"),
    )

    internal fun find(id: UUID): DocumentRow? =
        jdbc.query("SELECT $columns $from WHERE d.id = :id", params { uuid("id", id) }) { rs, _ -> row(rs) }.firstOrNull()

    /** Newest first. Visible ones for everybody, plus the caller's own; moderators see all. */
    internal fun listForRoute(routeId: UUID, callerId: UUID?, moderator: Boolean, after: Pair<String, UUID>?, limit: Int): List<DocumentRow> {
        val where = mutableListOf("d.route_id = :routeId", "d.deleted_at IS NULL")
        if (!moderator) where += if (callerId != null) "(d.visibility = 'visible' OR d.uploaded_by = :caller)" else "d.visibility = 'visible'"
        if (after != null) where += "(d.created_at, d.id) < (CAST(:afterCreated AS timestamptz), CAST(:afterId AS uuid))"
        return jdbc.query(
            "SELECT $columns $from WHERE ${where.joinToString(" AND ")} ORDER BY d.created_at DESC, d.id DESC LIMIT :limit",
            params {
                uuid("routeId", routeId); uuid("caller", callerId)
                str("afterCreated", after?.first); uuid("afterId", after?.second); int("limit", limit + 1)
            },
        ) { rs, _ -> row(rs) }
    }

    /** Moderation queue: rights never reviewed, oldest first. */
    internal fun awaitingRights(after: Pair<String, UUID>?, limit: Int): List<DocumentRow> {
        val cursorCond = if (after != null) "AND (d.created_at, d.id) > (CAST(:afterCreated AS timestamptz), CAST(:afterId AS uuid))" else ""
        return jdbc.query(
            """
            SELECT $columns $from
             WHERE d.rights_reviewed_at IS NULL AND d.deleted_at IS NULL $cursorCond
             ORDER BY d.created_at, d.id
             LIMIT :limit
            """.trimIndent(),
            params { str("afterCreated", after?.first); uuid("afterId", after?.second); int("limit", limit + 1) },
        ) { rs, _ -> row(rs) }
    }

    fun insert(id: UUID, routeId: UUID, uploaderId: UUID, storageKey: String, req: DocumentCreate, claimed: RightsStatus?) {
        jdbc.update(
            """
            INSERT INTO documents (id, route_id, uploaded_by, storage_key, title, source_type, source_description, year,
                                   claimed_rights_status, rights_note, processing_status)
            VALUES (:id, :routeId, :by, :key, CAST(:title AS jsonb), :sourceType, :sourceDescription, CAST(:year AS smallint),
                    CAST(:claimed AS text), CAST(:note AS text), 'ready')
            """.trimIndent(),
            params {
                uuid("id", id); uuid("routeId", routeId); uuid("by", uploaderId); str("key", storageKey)
                str("title", mapper.writeValueAsString(req.title)); str("sourceType", req.sourceType)
                str("sourceDescription", req.sourceDescription.trim()); int("year", req.year)
                str("claimed", claimed?.wire); str("note", req.rightsNote)
            },
        )
    }

    fun setRights(id: UUID, status: RightsStatus, note: String?, visibility: String, reviewerId: UUID) {
        jdbc.update(
            """
            UPDATE documents
               SET rights_status = :status, rights_note = CAST(:note AS text), visibility = :visibility,
                   rights_reviewed_by = :reviewer, rights_reviewed_at = now()
             WHERE id = :id
            """.trimIndent(),
            params { uuid("id", id); str("status", status.wire); str("note", note); str("visibility", visibility); uuid("reviewer", reviewerId) },
        )
    }
}

// ------------------------------------------------------------------- service

@Service
class DocumentService(
    private val documents: DocumentRepository,
    private val uploads: UploadService,
    private val storage: MediaStorage,
    private val users: UserRepository,
    private val log: ModerationLog,
    private val jdbc: NamedParameterJdbcTemplate,
) {
    /** Created hidden: publication requires a moderator to establish the rights status. */
    @Transactional
    fun createForRoute(routeId: UUID, req: DocumentCreate): Document {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        requireRoute(routeId, caller)
        parseWire<SourceType>(req.sourceType, "sourceType")
        val claimed = req.claimedRightsStatus?.let { parseWire<RightsStatus>(it, "claimedRightsStatus") }
        validate {
            localized(req.title, "title", required = true, maxLength = 300)
            check(req.sourceDescription.isNotBlank() && req.sourceDescription.length <= 2000, "sourceDescription",
                "Укажите источник точно и проверяемо, до 2000 символов")
            req.year?.let { check(it in 1800..2100, "year", "От 1800 до 2100") }
            req.rightsNote?.let { check(it.length <= 2000, "rightsNote", "До 2000 символов") }
        }

        val upload = uploads.claim(caller, req.uploadId, "document")
        // The declared content type is the client's word; check the file itself.
        val head = storage.readPrefix(upload.storageKey, 5)
        if (!head.contentEquals("%PDF-".toByteArray())) throw fieldError("uploadId", "Файл не является PDF")

        val id = UUID.randomUUID()
        documents.insert(id, routeId, caller.userId, upload.storageKey, req, claimed)
        return documents.find(id)!!.doc
    }

    fun list(routeId: UUID, cursor: String?, limit: Int): Page<Document> {
        val caller = Caller.currentOrNull()
        requireRoute(routeId, caller)
        val after = Cursor.decode(cursor, 2)?.let { it[0] to Cursor.uuid(it[1]) }
        val rows = documents.listForRoute(routeId, caller?.userId, caller?.isModerator == true, after, limit)
        return toPage(rows, limit, cursorOf = { listOf(it.createdAtText, it.doc.id.toString()) }) { it.doc }
    }

    fun get(id: UUID): Document {
        val caller = Caller.currentOrNull()
        val row = documents.find(id)?.takeUnless { it.deleted } ?: throw notFound("Документ не найден")
        if (!canSee(row, caller)) throw notFound("Документ не найден")
        return row.doc
    }

    @Transactional
    fun setRights(id: UUID, req: DocumentRightsUpdate): Document {
        val caller = Caller.current()
        users.requireActive(caller.userId)
        if (!caller.isModerator) throw forbidden("Действие доступно модераторам")
        val row = documents.find(id)?.takeUnless { it.deleted } ?: throw notFound("Документ не найден")
        val status = parseWire<RightsStatus>(req.rightsStatus, "rightsStatus")
        validate {
            check(req.visibility in setOf("visible", "hidden"), "visibility", "Допустимые значения: visible, hidden")
            check(req.visibility == "hidden" || status.publishable, "visibility",
                "Опубликовать можно только со статусом public_domain, licensed, permission_granted или own_work")
            check(!status.needsNote || !req.rightsNote.isNullOrBlank(), "rightsNote", "Для этого статуса укажите лицензию или разрешение")
            req.rightsNote?.let { check(it.length <= 2000, "rightsNote", "До 2000 символов") }
        }
        documents.setRights(id, status, req.rightsNote?.takeUnless { it.isBlank() }, req.visibility, caller.userId)
        log.record(caller.userId, "set_document_rights", "document", id, req.rightsNote,
            mapOf("rightsStatus" to status.wire, "visibility" to req.visibility, "previousVisibility" to row.doc.visibility))
        return documents.find(id)!!.doc
    }

    /** 302 to a short-lived link. Unpublished documents: 451 for everyone but the uploader and moderators. */
    fun downloadUrl(id: UUID): String {
        val caller = Caller.currentOrNull()
        val row = documents.find(id)?.takeUnless { it.deleted } ?: throw notFound("Документ не найден")
        if (!canSee(row, caller)) {
            throw ApiException(HttpStatus.UNAVAILABLE_FOR_LEGAL_REASONS, "rights-unclear",
                "Документ недоступен: правовой статус не выяснен или публикация запрещена")
        }
        return storage.presignedDownload(row.storageKey, "application/pdf", "document-${row.doc.id}.pdf")
    }

    fun awaitingRights(cursor: String?, limit: Int): Page<Document> {
        val caller = Caller.current()
        if (!caller.isModerator) throw forbidden("Действие доступно модераторам")
        val after = Cursor.decode(cursor, 2)?.let { it[0] to Cursor.uuid(it[1]) }
        val rows = documents.awaitingRights(after, limit)
        return toPage(rows, limit, cursorOf = { listOf(it.createdAtText, it.doc.id.toString()) }) { it.doc }
    }

    private fun canSee(row: DocumentRow, caller: Caller?) =
        row.doc.visibility == "visible" || caller?.isModerator == true || row.doc.uploadedBy.id == caller?.userId

    private fun requireRoute(routeId: UUID, caller: Caller?) {
        val status = jdbc.query("SELECT status FROM routes WHERE id = :id", params { uuid("id", routeId) }) { rs, _ -> rs.getString(1) }
            .firstOrNull()
        if (status == null || (status == "hidden" && caller?.isModerator != true)) throw notFound("Маршрут не найден")
    }
}

// ------------------------------------------------------------------- controller

@RestController
class DocumentController(private val service: DocumentService) {

    @GetMapping("/routes/{routeId}/documents")
    fun list(
        @PathVariable routeId: UUID,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.list(routeId, cursor, pageLimit(limit))

    @PostMapping("/routes/{routeId}/documents")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable routeId: UUID, @RequestBody body: DocumentCreate) = service.createForRoute(routeId, body)

    @GetMapping("/documents/{documentId}")
    fun get(@PathVariable documentId: UUID) = service.get(documentId)

    @PutMapping("/documents/{documentId}/rights")
    fun setRights(@PathVariable documentId: UUID, @RequestBody body: DocumentRightsUpdate) = service.setRights(documentId, body)

    @GetMapping("/documents/{documentId}/download")
    fun download(@PathVariable documentId: UUID): ResponseEntity<Void> =
        ResponseEntity.status(HttpStatus.FOUND).header(HttpHeaders.LOCATION, service.downloadUrl(documentId)).build()

    @GetMapping("/moderation/documents")
    fun awaitingRights(
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.awaitingRights(cursor, pageLimit(limit))
}
