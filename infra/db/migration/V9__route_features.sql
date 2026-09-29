-- Route geometry as an arbitrary set of features.
--
-- A revision may carry any combination (including none) of:
--   points: start, summit, bivouac, descent_start
--   lines:  route_line, approach, descent
-- Several features of the same kind are allowed (variants, several bivouacs, a traverse
-- over several summits). All geometry is 2D: elevation profiles come from DEM or GPX
-- tracks, never from drawn lines. A point may carry a stated elevation (elevation_m),
-- e.g. "bivouac at 4200 m" from a description; NULL means no data.
--
-- A line may be imported from an uploaded GPX track: the geometry is COPIED into the
-- feature (the revision stays a self-contained snapshot), source_track_id records provenance.

CREATE TABLE route_revision_features (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id      uuid NOT NULL REFERENCES route_revisions (id),
    -- Order within the revision: drawing order on the map and tie-break for the anchor.
    position         smallint NOT NULL CHECK (position >= 0),
    kind             text NOT NULL CHECK (kind IN (
                         'start', 'summit', 'bivouac', 'descent_start',
                         'route_line', 'approach', 'descent')),
    geometry         geometry(Geometry, 4326) NOT NULL,
    elevation_m      integer CHECK (elevation_m BETWEEN -500 AND 9000),
    note             jsonb CHECK (is_localized_text(note)),
    source_track_id  uuid REFERENCES tracks (id),
    UNIQUE (revision_id, position),
    CONSTRAINT route_features_geometry_matches_kind CHECK (
        CASE WHEN kind IN ('start', 'summit', 'bivouac', 'descent_start')
             THEN ST_GeometryType(geometry) = 'ST_Point'
             ELSE ST_GeometryType(geometry) = 'ST_LineString' AND ST_NPoints(geometry) >= 2
        END
    ),
    CONSTRAINT route_features_2d CHECK (ST_NDims(geometry) = 2),
    -- Catches out-of-range values, and some swapped lat/lon (latitude above 90).
    CONSTRAINT route_features_lonlat_range CHECK (
        ST_XMin(geometry) >= -180 AND ST_XMax(geometry) <= 180
        AND ST_YMin(geometry) >= -90 AND ST_YMax(geometry) <= 90
    ),
    CHECK (source_track_id IS NULL OR kind IN ('route_line', 'approach', 'descent')),
    CHECK (elevation_m IS NULL OR kind IN ('start', 'summit', 'bivouac', 'descent_start'))
);

CREATE INDEX route_revision_features_revision_idx ON route_revision_features (revision_id);

-- Immutable after insert, insertable only while the revision is pending (see V5).
CREATE TRIGGER route_revision_features_immutable BEFORE INSERT OR UPDATE OR DELETE ON route_revision_features
    FOR EACH ROW EXECUTE FUNCTION route_revision_child_guard();

-- A line may be imported only from a track of the same route.
CREATE FUNCTION route_revision_features_track_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_track_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM tracks t
        JOIN route_revisions r ON r.route_id = t.route_id
        WHERE t.id = NEW.source_track_id AND r.id = NEW.revision_id
    ) THEN
        RAISE EXCEPTION 'source track % does not belong to the route of revision %', NEW.source_track_id, NEW.revision_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER route_revision_features_track BEFORE INSERT ON route_revision_features
    FOR EACH ROW EXECUTE FUNCTION route_revision_features_track_check();

-- Map marker of a revision: first available of
--   start point -> summit point -> first vertex of a route line -> first point of any other feature
-- (ties broken by position). NULL when the revision has no features.
CREATE FUNCTION route_revision_anchor(rev uuid) RETURNS geometry
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN ST_GeometryType(geometry) = 'ST_Point' THEN geometry ELSE ST_StartPoint(geometry) END
    FROM route_revision_features
    WHERE revision_id = rev
    ORDER BY CASE kind WHEN 'start' THEN 1 WHEN 'summit' THEN 2 WHEN 'route_line' THEN 3 ELSE 4 END,
             position
    LIMIT 1
$$;

-- Geometry of the CURRENT revision of each route, for catalog geo search:
-- bbox (&& / ST_Intersects on geometry), radius (ST_DWithin on anchor_point::geography).
-- Pure cache, maintained by the trigger below. Routes without features have no row.
-- Safe because features of a revision can no longer change once it is approved.
CREATE TABLE route_geo (
    route_id      uuid PRIMARY KEY REFERENCES routes (id),
    revision_id   uuid NOT NULL UNIQUE REFERENCES route_revisions (id),
    anchor_point  geometry(Point, 4326) NOT NULL,
    geometry      geometry(Geometry, 4326) NOT NULL   -- ST_Collect of all features
);

CREATE INDEX route_geo_anchor_gix ON route_geo USING gist (anchor_point);
CREATE INDEX route_geo_geometry_gix ON route_geo USING gist (geometry);

CREATE FUNCTION route_geo_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_current AND NOT NEW.is_current THEN
        DELETE FROM route_geo WHERE revision_id = OLD.id;
    ELSIF NEW.is_current AND NOT OLD.is_current THEN
        DELETE FROM route_geo WHERE route_id = NEW.route_id;
        INSERT INTO route_geo (route_id, revision_id, anchor_point, geometry)
        SELECT NEW.route_id, NEW.id, route_revision_anchor(NEW.id), ST_Collect(f.geometry ORDER BY f.position)
        FROM route_revision_features f
        WHERE f.revision_id = NEW.id
        HAVING count(*) > 0;
    END IF;
    RETURN NULL;
END
$$;

CREATE TRIGGER route_revisions_geo_sync AFTER UPDATE OF is_current ON route_revisions
    FOR EACH ROW WHEN (OLD.is_current IS DISTINCT FROM NEW.is_current)
    EXECUTE FUNCTION route_geo_sync();
