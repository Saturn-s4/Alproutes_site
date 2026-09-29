-- Media: uploads, photos, topo drawings, GPS tracks, archival documents.
--
-- Files never pass through the backend and never live in the database:
--  1. client asks for an upload slot  -> row in `uploads` + pre-signed PUT URL to S3;
--  2. client uploads directly to S3;
--  3. client creates the entity (photo/track/document) referencing the upload;
--  4. a background job reads the object from S3, extracts metadata/geometry,
--     builds derivatives and sets processing_status = 'ready'.

CREATE TABLE uploads (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id),
    purpose       text NOT NULL CHECK (purpose IN ('photo', 'track', 'document', 'avatar')),
    storage_key   text NOT NULL UNIQUE,
    content_type  text NOT NULL,
    size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    -- Set when an entity claims the upload; unclaimed expired objects are garbage-collected.
    claimed_at    timestamptz,
    CHECK (expires_at > created_at)
);

CREATE INDEX uploads_unclaimed_idx ON uploads (expires_at) WHERE claimed_at IS NULL;

CREATE TABLE photos (
    id                 uuid PRIMARY KEY,   -- client-generated, see V6
    route_id           uuid REFERENCES routes (id),
    area_id            uuid REFERENCES areas (id),
    ascent_id          uuid,
    author_id          uuid NOT NULL REFERENCES users (id),
    kind               text NOT NULL CHECK (kind IN ('overview', 'topo', 'detail')),
    storage_key        text NOT NULL UNIQUE REFERENCES uploads (storage_key),
    content_type       text NOT NULL,
    -- Dimensions AFTER applying EXIF orientation. Topo coordinates are relative to them.
    width_px           integer CHECK (width_px > 0),
    height_px          integer CHECK (height_px > 0),
    taken_at           timestamptz,
    -- From EXIF. Public derivatives are served with EXIF stripped.
    location           geometry(Point, 4326),
    caption            text CHECK (length(caption) <= 1000),
    caption_language   text CHECK (caption_language ~ '^[a-z]{2}$'),
    processing_status  text NOT NULL DEFAULT 'processing'
                       CHECK (processing_status IN ('processing', 'ready', 'failed')),
    visibility         text NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
    deleted_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(route_id, area_id) = 1),
    CHECK (ascent_id IS NULL OR route_id IS NOT NULL),
    CHECK (processing_status <> 'ready' OR (width_px IS NOT NULL AND height_px IS NOT NULL)),
    FOREIGN KEY (ascent_id, route_id) REFERENCES ascents (id, route_id)
);

CREATE INDEX photos_route_idx ON photos (route_id, created_at) WHERE route_id IS NOT NULL;
CREATE INDEX photos_area_idx ON photos (area_id, created_at) WHERE area_id IS NOT NULL;
CREATE INDEX photos_ascent_idx ON photos (ascent_id) WHERE ascent_id IS NOT NULL;
CREATE INDEX photos_updated_idx ON photos (updated_at);

CREATE TRIGGER photos_updated_at BEFORE UPDATE ON photos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Route line drawn over a photo. One photo can show several routes, so the key is
-- (photo, route). Versioned exactly like route revisions: append-only, moderated,
-- one current version. The drawing format is TopoDrawing in /shared/openapi.yaml:
-- coordinates normalized to 0..1 of the oriented image, never source pixels.
CREATE TABLE topo_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id        uuid NOT NULL REFERENCES photos (id),
    route_id        uuid NOT NULL REFERENCES routes (id),
    version         integer NOT NULL CHECK (version > 0),
    base_version_id uuid REFERENCES topo_lines (id),
    drawing         jsonb NOT NULL CHECK (
                        jsonb_typeof(drawing) = 'object'
                        -- IS NOT DISTINCT FROM: a missing key yields NULL, which a plain "=" would let through.
                        AND jsonb_typeof(drawing -> 'formatVersion') IS NOT DISTINCT FROM 'number'
                    ),
    author_id       uuid NOT NULL REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    is_current      boolean NOT NULL DEFAULT false,
    reviewed_by     uuid REFERENCES users (id),
    reviewed_at     timestamptz,
    review_note     text CHECK (length(review_note) <= 2000),
    UNIQUE (photo_id, route_id, version),
    CHECK (NOT is_current OR status = 'approved'),
    CHECK ((status = 'pending') = (reviewed_at IS NULL)),
    CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL)
);

CREATE UNIQUE INDEX topo_lines_one_current ON topo_lines (photo_id, route_id) WHERE is_current;
CREATE INDEX topo_lines_route_current_idx ON topo_lines (route_id) WHERE is_current;
CREATE INDEX topo_lines_pending_idx ON topo_lines (created_at) WHERE status = 'pending';

CREATE TRIGGER topo_lines_append_only BEFORE UPDATE OR DELETE ON topo_lines
    FOR EACH ROW EXECUTE FUNCTION enforce_append_only('status', 'is_current', 'reviewed_by', 'reviewed_at', 'review_note');

CREATE TABLE tracks (
    id                 uuid PRIMARY KEY,   -- client-generated
    route_id           uuid NOT NULL REFERENCES routes (id),
    ascent_id          uuid,
    author_id          uuid NOT NULL REFERENCES users (id),
    storage_key        text NOT NULL UNIQUE REFERENCES uploads (storage_key),
    original_filename  text CHECK (length(original_filename) <= 255),
    format             text NOT NULL CHECK (format IN ('gpx', 'kml')),
    recorded_on        date,
    note               text CHECK (length(note) <= 2000),
    -- Filled by processing. A file may hold several segments.
    geometry           geometry(MultiLineStringZ, 4326),
    length_m           integer CHECK (length_m >= 0),
    -- Computed from the smoothed (and, when possible, DEM-checked) profile, not raw points.
    elevation_gain_m   integer CHECK (elevation_gain_m >= 0),
    elevation_loss_m   integer CHECK (elevation_loss_m >= 0),
    min_elevation_m    integer,
    max_elevation_m    integer,
    elevation_source   text CHECK (elevation_source IN ('gps', 'barometric', 'dem', 'mixed')),
    -- Smoothed profile: [[distance_m, elevation_m], ...].
    elevation_profile  jsonb CHECK (elevation_profile IS NULL OR jsonb_typeof(elevation_profile) = 'array'),
    processing_status  text NOT NULL DEFAULT 'processing'
                       CHECK (processing_status IN ('processing', 'ready', 'failed')),
    processing_error   text,
    visibility         text NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
    deleted_at         timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (processing_status <> 'ready' OR geometry IS NOT NULL),
    CHECK (min_elevation_m IS NULL OR max_elevation_m IS NULL OR min_elevation_m <= max_elevation_m),
    FOREIGN KEY (ascent_id, route_id) REFERENCES ascents (id, route_id)
);

CREATE INDEX tracks_route_idx ON tracks (route_id, created_at);
CREATE INDEX tracks_geometry_gix ON tracks USING gist (geometry);
CREATE INDEX tracks_updated_idx ON tracks (updated_at);

CREATE TRIGGER tracks_updated_at BEFORE UPDATE ON tracks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Archival PDF descriptions. Most classifier materials are copyrighted:
-- a document stays hidden until a moderator has established its rights status,
-- and the database refuses to make it visible otherwise.
CREATE TABLE documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id            uuid REFERENCES routes (id),
    area_id             uuid REFERENCES areas (id),
    uploaded_by         uuid NOT NULL REFERENCES users (id),
    storage_key         text NOT NULL UNIQUE REFERENCES uploads (storage_key),
    content_type        text NOT NULL DEFAULT 'application/pdf' CHECK (content_type = 'application/pdf'),
    page_count          integer CHECK (page_count > 0),
    title               jsonb NOT NULL CHECK (is_localized_text(title)),
    source_type         text NOT NULL
                        CHECK (source_type IN ('classifier', 'ascent_report', 'guidebook', 'periodical', 'other')),
    -- Mandatory: exactly where the document comes from.
    source_description  text NOT NULL CHECK (btrim(source_description) <> '' AND length(source_description) <= 2000),
    year                smallint CHECK (year BETWEEN 1800 AND 2100),
    rights_status       text NOT NULL DEFAULT 'unknown'
                        CHECK (rights_status IN ('unknown', 'public_domain', 'licensed',
                                                 'permission_granted', 'own_work', 'restricted')),
    -- What the uploader asserts; informational for the moderator, never trusted as is.
    claimed_rights_status text CHECK (claimed_rights_status IN ('unknown', 'public_domain', 'licensed',
                                                                'permission_granted', 'own_work', 'restricted')),
    rights_note         text CHECK (length(rights_note) <= 2000),
    rights_reviewed_by  uuid REFERENCES users (id),
    rights_reviewed_at  timestamptz,
    processing_status   text NOT NULL DEFAULT 'processing'
                        CHECK (processing_status IN ('processing', 'ready', 'failed')),
    visibility          text NOT NULL DEFAULT 'hidden' CHECK (visibility IN ('visible', 'hidden')),
    deleted_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(route_id, area_id) = 1),
    CHECK (rights_status NOT IN ('licensed', 'permission_granted') OR COALESCE(btrim(rights_note), '') <> ''),
    CHECK (rights_reviewed_at IS NULL OR rights_reviewed_by IS NOT NULL),
    CONSTRAINT documents_visible_requires_cleared_rights CHECK (
        visibility = 'hidden'
        OR (rights_status IN ('public_domain', 'licensed', 'permission_granted', 'own_work')
            AND rights_reviewed_at IS NOT NULL)
    )
);

CREATE INDEX documents_route_idx ON documents (route_id) WHERE route_id IS NOT NULL;
CREATE INDEX documents_area_idx ON documents (area_id) WHERE area_id IS NOT NULL;
CREATE INDEX documents_rights_queue_idx ON documents (created_at) WHERE rights_reviewed_at IS NULL;

CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
