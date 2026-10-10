package com.alproutes.routes

import com.alproutes.areas.AreaRef
import com.alproutes.areas.ContentStatus
import com.alproutes.common.GeoJsonLineString
import com.alproutes.common.GeoJsonPoint
import com.alproutes.common.LocalizedText
import com.alproutes.common.Wire
import com.alproutes.grades.Grade
import com.alproutes.photos.Photo
import com.alproutes.users.UserPublic
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonUnwrapped
import com.fasterxml.jackson.annotation.JsonValue
import java.time.OffsetDateTime
import java.util.UUID

enum class RouteType(@get:JsonValue override val wire: String) : Wire {
    ROCK("rock"), SNOW_ICE("snow_ice"), COMBINED("combined")
}

enum class ReviewStatus(@get:JsonValue override val wire: String) : Wire {
    PENDING("pending"), APPROVED("approved"), REJECTED("rejected")
}

enum class RouteFeatureKind(@get:JsonValue override val wire: String, val isPoint: Boolean) : Wire {
    START("start", true),
    SUMMIT("summit", true),
    BIVOUAC("bivouac", true),
    DESCENT_START("descent_start", true),
    ROUTE_LINE("route_line", false),
    APPROACH("approach", false),
    DESCENT("descent", false),
}

/** One point or one line of the route geometry (contract: RouteFeature). */
data class RouteFeature(
    val kind: RouteFeatureKind,
    val point: GeoJsonPoint? = null,
    val line: GeoJsonLineString? = null,
    val elevationM: Int? = null,
    val note: LocalizedText? = null,
    val sourceTrackId: UUID? = null,
)

/** A photo shown in the description itself (contract: RouteContentPhoto). */
data class RouteContentPhoto(
    val photoId: UUID,
    val caption: LocalizedText? = null,
)

/**
 * Full snapshot of a route description = one revision (contract: RouteContent).
 * Every factual field may be null: "no data", never a guess.
 */
data class RouteContent(
    val areaId: UUID,
    val name: LocalizedText,
    val description: LocalizedText? = null,
    val grades: List<Grade>,
    val routeType: RouteType? = null,
    @get:JsonProperty("isTraverse") @param:JsonProperty("isTraverse")
    val isTraverse: Boolean? = null,
    val elevationGainM: Int? = null,
    val lengthM: Int? = null,
    val seasonMonths: List<Int>? = null,
    val firstAscentParty: String? = null,
    val firstAscentYear: Int? = null,
    val dataSources: String? = null,
    val features: List<RouteFeature> = emptyList(),
    val photos: List<RouteContentPhoto> = emptyList(),
)

data class RouteCreate(
    val slug: String? = null,
    val content: RouteContent,
    val changeSummary: String? = null,
    val publish: Boolean = false,
)

data class RouteRevisionCreate(
    val baseRevisionId: UUID,
    val content: RouteContent,
    val changeSummary: String? = null,
    val publish: Boolean = false,
)

data class ReviewDecision(val note: String? = null)

data class RouteRevisionRef(val id: UUID, val revisionNumber: Int, val approvedAt: OffsetDateTime?)

data class RouteStats(
    val photoCount: Int,
    val trackCount: Int,
    val ascentCount: Int,
    val commentCount: Int,
    val documentCount: Int,
)

/** Contract RouteDetail = RouteContent (flattened) + identity and context. */
data class RouteDetail(
    @get:JsonUnwrapped val content: RouteContent,
    val id: UUID,
    val slug: String,
    val status: ContentStatus,
    val area: AreaRef,
    val areaPath: List<AreaRef>,
    val currentRevision: RouteRevisionRef,
    val descriptionPhotos: List<Photo>,
    val stats: RouteStats,
    val updatedAt: OffsetDateTime,
)

data class RouteSummary(
    val id: UUID,
    val slug: String,
    val status: ContentStatus,
    val name: LocalizedText,
    val area: AreaRef,
    val grades: List<Grade>,
    val routeType: RouteType?,
    val elevationGainM: Int?,
    val lengthM: Int?,
    val anchorPoint: GeoJsonPoint?,
    val distanceM: Double?,
    val coverPhotoUrl: String?,
    val updatedAt: OffsetDateTime,
)

data class RouteMapPoint(
    val id: UUID,
    val slug: String,
    val name: LocalizedText,
    val anchorPoint: GeoJsonPoint,
    val grades: List<Grade>,
)

data class RouteRevisionSummary(
    val id: UUID,
    val routeId: UUID,
    val revisionNumber: Int,
    val baseRevisionId: UUID?,
    val revertedFromId: UUID?,
    val author: UserPublic,
    val changeSummary: String?,
    val createdAt: OffsetDateTime,
    val status: ReviewStatus,
    @get:JsonProperty("isCurrent")
    val isCurrent: Boolean,
    val reviewedBy: UserPublic?,
    val reviewedAt: OffsetDateTime?,
    val reviewNote: String?,
)

/** Contract RouteRevision = RouteRevisionSummary (flattened) + content. */
data class RouteRevision(
    @get:JsonUnwrapped val summary: RouteRevisionSummary,
    val content: RouteContent,
)
