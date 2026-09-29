-- Routes and their full-snapshot revisions.
--
-- `routes` holds only identity (id, slug) and lifecycle. Every descriptive attribute,
-- including area, grades and geometry, lives in `route_revisions`: each edit inserts a
-- new snapshot, nothing is overwritten. The published state is the single revision
-- with is_current = true. Rollback = a new revision copied from an old one
-- (reverted_from_id), so history stays linear and auditable.
--
-- Geometry is not a fixed pair of columns: a revision carries any combination of
-- points (start, summit, bivouac, descent start) and 2D lines (route, approach,
-- descent) in route_revision_features (V9). A revision may have none of them.
-- Catalog geo search runs on route_geo (V9), a cache of the current revision's geometry.
--
-- NULL in any factual column means "no data". Clients must show it as such;
-- the service must never substitute a guess or a default.

CREATE TABLE routes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- draft: no approved revision yet; published: visible; hidden: removed by moderation.
    status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'hidden')),
    created_by  uuid NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Bumped whenever the current revision changes: offline sync relies on it.
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX routes_updated_idx ON routes (updated_at);

CREATE TRIGGER routes_updated_at BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE route_revisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id            uuid NOT NULL REFERENCES routes (id),
    revision_number     integer NOT NULL CHECK (revision_number > 0),
    -- Revision the author started editing from: detects concurrent edits.
    base_revision_id    uuid REFERENCES route_revisions (id),
    -- Set when a moderator restores an older snapshot.
    reverted_from_id    uuid REFERENCES route_revisions (id),
    author_id           uuid NOT NULL REFERENCES users (id),
    change_summary      text CHECK (length(change_summary) <= 500),
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- Review state: the only columns allowed to change after insert.
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
    is_current          boolean NOT NULL DEFAULT false,
    reviewed_by         uuid REFERENCES users (id),
    reviewed_at         timestamptz,
    review_note         text CHECK (length(review_note) <= 2000),

    -- Snapshot of the route.
    area_id             uuid NOT NULL REFERENCES areas (id),
    name                jsonb NOT NULL CHECK (is_localized_text(name)),
    description         jsonb CHECK (is_localized_text(description)),
    -- Route type as in the Russian classification.
    route_type          text CHECK (route_type IN ('rock', 'snow_ice', 'combined')),
    is_traverse         boolean,
    elevation_gain_m    integer CHECK (elevation_gain_m > 0 AND elevation_gain_m < 9000),
    length_m            integer CHECK (length_m > 0),
    season_months       smallint[] CHECK (
                            cardinality(season_months) BETWEEN 1 AND 12
                            AND season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
                        ),
    first_ascent_party  text CHECK (length(first_ascent_party) <= 1000),
    first_ascent_year   smallint CHECK (first_ascent_year BETWEEN 1700 AND 2100),
    -- Where the facts come from: classifier entry, ascent report, guidebook...
    data_sources        text CHECK (length(data_sources) <= 2000),

    search_text         text GENERATED ALWAYS AS (localized_search_text(name)) STORED,

    UNIQUE (route_id, revision_number),
    CHECK (NOT is_current OR status = 'approved'),
    CHECK ((status = 'pending') = (reviewed_at IS NULL)),
    CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL),
    CHECK (reverted_from_id IS NULL OR reverted_from_id <> id)
);

-- Exactly one published snapshot per route.
CREATE UNIQUE INDEX route_revisions_one_current ON route_revisions (route_id) WHERE is_current;

-- Catalog queries only ever touch current revisions: partial indexes keep
-- history out of the search indexes. Geo search uses the route_geo cache (V9).
CREATE INDEX route_revisions_current_area_idx  ON route_revisions (area_id) WHERE is_current;
CREATE INDEX route_revisions_current_trgm      ON route_revisions USING gin (search_text gin_trgm_ops) WHERE is_current;
CREATE INDEX route_revisions_pending_idx       ON route_revisions (created_at) WHERE status = 'pending';
CREATE INDEX route_revisions_author_idx        ON route_revisions (author_id);

CREATE TRIGGER route_revisions_append_only BEFORE UPDATE OR DELETE ON route_revisions
    FOR EACH ROW EXECUTE FUNCTION enforce_append_only('status', 'is_current', 'reviewed_by', 'reviewed_at', 'review_note');

-- Grades belong to a revision; at most one grade per system.
CREATE TABLE route_revision_grades (
    revision_id  uuid NOT NULL REFERENCES route_revisions (id),
    system_code  text NOT NULL,
    value        text NOT NULL,
    PRIMARY KEY (revision_id, system_code),
    FOREIGN KEY (system_code, value) REFERENCES grade_values (system_code, value)
);

CREATE INDEX route_revision_grades_value_idx ON route_revision_grades (system_code, value);

-- Child rows of a revision (grades here, features in V9) are part of the snapshot:
-- they can be written only while the revision is pending (i.e. in the same flow that
-- creates it) and never changed afterwards. Works for any table with a revision_id column.
CREATE FUNCTION route_revision_child_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rows of % are part of a revision snapshot and immutable', TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM route_revisions WHERE id = NEW.revision_id AND status = 'pending') THEN
        RAISE EXCEPTION 'rows of % can be added only to a pending revision', TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER route_revision_grades_immutable BEFORE INSERT OR UPDATE OR DELETE ON route_revision_grades
    FOR EACH ROW EXECUTE FUNCTION route_revision_child_guard();
