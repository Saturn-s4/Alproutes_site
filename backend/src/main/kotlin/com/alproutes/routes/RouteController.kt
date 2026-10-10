package com.alproutes.routes

import com.alproutes.common.Bbox
import com.alproutes.common.fieldError
import com.alproutes.common.pageLimit
import com.alproutes.common.parseLonLat
import com.alproutes.common.parseWire
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
class RouteController(private val service: RouteService, private val search: RouteSearch) {

    @GetMapping("/routes")
    fun list(
        @RequestParam(required = false) bbox: String?,
        @RequestParam(required = false) near: String?,
        @RequestParam(required = false) radiusM: Int?,
        @RequestParam(required = false) areaId: UUID?,
        @RequestParam(required = false, defaultValue = "true") includeSubareas: Boolean,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) gradeSystem: String?,
        @RequestParam(required = false) gradeMin: String?,
        @RequestParam(required = false) gradeMax: String?,
        @RequestParam(required = false) routeType: String?,
        @RequestParam(required = false) gradeValues: List<String>?,
        @RequestParam(required = false) hasTrack: Boolean?,
        @RequestParam(required = false) hasDocument: Boolean?,
        @RequestParam(required = false) sort: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = search.search(
        query(bbox, near, radiusM, areaId, includeSubareas, q, gradeSystem, gradeMin, gradeMax, routeType, gradeValues, hasTrack, hasDocument)
            .copy(
                sort = sort?.let { s -> RouteSort.entries.firstOrNull { it.wire == s } ?: throw fieldError("sort", "Недопустимая сортировка") },
                cursor = cursor,
                limit = pageLimit(limit),
            ),
    )

    @GetMapping("/routes/facets")
    fun facets(
        @RequestParam(required = false) bbox: String?,
        @RequestParam(required = false) near: String?,
        @RequestParam(required = false) radiusM: Int?,
        @RequestParam(required = false) areaId: UUID?,
        @RequestParam(required = false, defaultValue = "true") includeSubareas: Boolean,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) gradeSystem: String?,
        @RequestParam(required = false) gradeMin: String?,
        @RequestParam(required = false) gradeMax: String?,
        @RequestParam(required = false) routeType: String?,
        @RequestParam(required = false) gradeValues: List<String>?,
        @RequestParam(required = false) hasTrack: Boolean?,
        @RequestParam(required = false) hasDocument: Boolean?,
        @RequestParam(required = false) areaParentId: UUID?,
    ) = search.facets(
        query(bbox, near, radiusM, areaId, includeSubareas, q, gradeSystem, gradeMin, gradeMax, routeType, gradeValues, hasTrack, hasDocument),
        areaParentId,
    )

    private fun query(
        bbox: String?, near: String?, radiusM: Int?, areaId: UUID?, includeSubareas: Boolean, q: String?,
        gradeSystem: String?, gradeMin: String?, gradeMax: String?, routeType: String?,
        gradeValues: List<String>?, hasTrack: Boolean?, hasDocument: Boolean?,
    ) = RouteQuery(
        bbox = bbox?.let { Bbox.parse(it) },
        near = near?.let { parseLonLat(it, "near") },
        radiusM = radiusM,
        areaId = areaId,
        includeSubareas = includeSubareas,
        q = q?.trim()?.takeIf { it.isNotEmpty() }?.also { if (it.length < 2) throw fieldError("q", "Минимум 2 символа") },
        gradeSystem = gradeSystem,
        gradeMin = gradeMin,
        gradeMax = gradeMax,
        routeType = routeType?.let { parseWire<RouteType>(it, "routeType") },
        gradeValues = gradeValues?.flatMap { it.split(',') }?.map { it.trim() }?.filter { it.isNotEmpty() }?.distinct()?.takeIf { it.isNotEmpty() },
        hasTrack = hasTrack,
        hasDocument = hasDocument,
        sort = null,
        cursor = null,
        limit = 20,
    )

    @GetMapping("/routes/map-points")
    fun mapPoints(
        @RequestParam bbox: String,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = search.mapPoints(Bbox.parse(bbox), cursor, pageLimit(limit, default = 200, max = 500))

    @PostMapping("/routes")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody body: RouteCreate) = service.create(body)

    @GetMapping("/routes/{routeId}")
    fun get(@PathVariable routeId: UUID) = service.detail(routeId, null)

    @GetMapping("/routes/by-slug/{slug}")
    fun bySlug(@PathVariable slug: String) = service.detail(null, slug)

    @GetMapping("/routes/{routeId}/revisions")
    fun revisions(
        @PathVariable routeId: UUID,
        @RequestParam(required = false) status: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ) = service.revisions(routeId, status, cursor, pageLimit(limit))

    @PostMapping("/routes/{routeId}/revisions")
    @ResponseStatus(HttpStatus.CREATED)
    fun propose(@PathVariable routeId: UUID, @RequestBody body: RouteRevisionCreate) = service.propose(routeId, body)

    @GetMapping("/route-revisions/{revisionId}")
    fun revision(@PathVariable revisionId: UUID) = service.revision(revisionId)

    @PostMapping("/route-revisions/{revisionId}/approve")
    fun approve(@PathVariable revisionId: UUID, @RequestBody(required = false) body: ReviewDecision?) =
        service.approve(revisionId, body?.note)

    @PostMapping("/route-revisions/{revisionId}/reject")
    fun reject(@PathVariable revisionId: UUID, @RequestBody body: ReviewDecision) = service.reject(revisionId, body.note)

    @PostMapping("/route-revisions/{revisionId}/revert")
    @ResponseStatus(HttpStatus.CREATED)
    fun revert(@PathVariable revisionId: UUID, @RequestBody body: ReviewDecision) = service.revert(revisionId, body.note)

    @GetMapping("/moderation/route-revisions")
    fun pending(@RequestParam(required = false) cursor: String?, @RequestParam(required = false) limit: Int?) =
        service.pending(cursor, pageLimit(limit))
}
