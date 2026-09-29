-- Geographic hierarchy: mountain system -> region -> ridge/massif -> summit.
-- Depth is not fixed; parent_id links any level to any other.

CREATE TABLE areas (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id    uuid REFERENCES areas (id),
    type         text NOT NULL
                 CHECK (type IN ('mountain_system', 'region', 'ridge', 'massif', 'summit', 'other')),
    slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name         jsonb NOT NULL CHECK (is_localized_text(name)),
    description  jsonb CHECK (is_localized_text(description)),
    center       geometry(Point, 4326),
    -- Summit height. NULL = unknown; never fill with an estimate.
    elevation_m  integer CHECK (elevation_m BETWEEN -500 AND 9000),
    -- Optional outline: area SEO pages and offline packages use it as the download extent.
    boundary     geometry(MultiPolygon, 4326) CHECK (boundary IS NULL OR ST_IsValid(boundary)),
    status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'hidden')),
    created_by   uuid REFERENCES users (id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    search_text  text GENERATED ALWAYS AS (localized_search_text(name)) STORED,
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (elevation_m IS NULL OR type = 'summit')
);

CREATE INDEX areas_parent_idx ON areas (parent_id);
CREATE INDEX areas_center_gix ON areas USING gist (center);
CREATE INDEX areas_boundary_gix ON areas USING gist (boundary);
CREATE INDEX areas_search_trgm ON areas USING gin (search_text gin_trgm_ops);

CREATE TRIGGER areas_updated_at BEFORE UPDATE ON areas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rejects parent changes that would make an area its own ancestor.
CREATE FUNCTION areas_prevent_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestors (id) AS (
            SELECT NEW.parent_id
            UNION   -- UNION, not UNION ALL: terminates even on corrupted data
            SELECT a.parent_id
            FROM areas a
            JOIN ancestors anc ON a.id = anc.id
            WHERE a.parent_id IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = NEW.id
    ) THEN
        RAISE EXCEPTION 'area % cannot be placed under its own descendant %', NEW.id, NEW.parent_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER areas_no_cycles BEFORE INSERT OR UPDATE OF parent_id ON areas
    FOR EACH ROW EXECUTE FUNCTION areas_prevent_cycle();
