-- PostGIS-specific checks: geometry types, SRID, validity, geo queries.
-- Requires a real PostGIS database (docker compose). Rolled back at the end.
--
--   psql -v ON_ERROR_STOP=1 -f infra/db/tests/postgis_test.sql
\set ON_ERROR_STOP 1
BEGIN;

CREATE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'OK   (rejected) %: %', label, SQLERRM; RETURN; END;
    RAISE EXCEPTION 'FAIL (accepted) %', label;
END $$;

INSERT INTO users (id, display_name) VALUES ('00000000-0000-0000-0000-000000000001', 'Автор');

-- Test coordinates are arbitrary points, not real route data.
INSERT INTO areas (id, type, slug, name, center, boundary) VALUES (
    '10000000-0000-0000-0000-000000000001', 'region', 'test-region', '{"ru": "Тестовый район"}',
    ST_SetSRID(ST_MakePoint(43.0, 43.0), 4326),
    ST_Multi(ST_MakeEnvelope(42.9, 42.9, 43.1, 43.1, 4326))
);

SELECT pg_temp.expect_fail('self-intersecting boundary', $q$
    INSERT INTO areas (type, slug, name, boundary) VALUES ('region', 'bowtie', '{"ru": "x"}',
        ST_GeomFromText('MULTIPOLYGON(((0 0, 1 1, 1 0, 0 1, 0 0)))', 4326))
$q$);
SELECT pg_temp.expect_fail('wrong SRID', $q$
    UPDATE areas SET center = ST_SetSRID(ST_MakePoint(43.0, 43.0), 3857) WHERE slug = 'test-region'
$q$);

INSERT INTO routes (id, slug, created_by) VALUES ('20000000-0000-0000-0000-000000000001', 'test-route', '00000000-0000-0000-0000-000000000001');

INSERT INTO route_revisions (id, route_id, revision_number, author_id, area_id, name)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1,
        '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '{"ru": "Тест"}');

SELECT pg_temp.expect_fail('3D line (lines are 2D)', $q$
    INSERT INTO route_revision_features (revision_id, position, kind, geometry)
    VALUES ('30000000-0000-0000-0000-000000000001', 9, 'route_line',
            ST_GeomFromText('LINESTRING Z(43.0 43.0 3000, 43.01 43.01 3100)', 4326))
$q$);
SELECT pg_temp.expect_fail('latitude out of range (swapped lat/lon)', $q$
    INSERT INTO route_revision_features (revision_id, position, kind, geometry)
    VALUES ('30000000-0000-0000-0000-000000000001', 9, 'start', ST_SetSRID(ST_MakePoint(43.0, 143.0), 4326))
$q$);
SELECT pg_temp.expect_fail('polygon as a feature', $q$
    INSERT INTO route_revision_features (revision_id, position, kind, geometry)
    VALUES ('30000000-0000-0000-0000-000000000001', 9, 'route_line', ST_MakeEnvelope(43.0, 43.0, 43.1, 43.1, 4326))
$q$);
SELECT pg_temp.expect_fail('wrong SRID on a feature', $q$
    INSERT INTO route_revision_features (revision_id, position, kind, geometry)
    VALUES ('30000000-0000-0000-0000-000000000001', 9, 'start', ST_SetSRID(ST_MakePoint(43.0, 43.0), 3857))
$q$);

-- summit + approach + start (start inserted last: the anchor must still be the start point)
INSERT INTO route_revision_features (revision_id, position, kind, geometry, elevation_m) VALUES
    ('30000000-0000-0000-0000-000000000001', 0, 'summit',   ST_SetSRID(ST_MakePoint(43.02, 43.02), 4326), 3800),
    ('30000000-0000-0000-0000-000000000001', 1, 'approach', ST_GeomFromText('LINESTRING(42.95 42.95, 43.0 43.0)', 4326), NULL),
    ('30000000-0000-0000-0000-000000000001', 2, 'start',    ST_SetSRID(ST_MakePoint(43.0, 43.0), 4326), NULL);

UPDATE route_revisions
   SET status = 'approved', is_current = true,
       reviewed_by = '00000000-0000-0000-0000-000000000001', reviewed_at = now()
 WHERE id = '30000000-0000-0000-0000-000000000001';

DO $$ BEGIN
    IF NOT (SELECT ST_Equals(anchor_point, ST_SetSRID(ST_MakePoint(43.0, 43.0), 4326)) FROM route_geo) THEN
        RAISE EXCEPTION 'FAIL anchor is not the start point';
    END IF;
    RAISE NOTICE 'OK   anchor = start point';
END $$;

-- bbox search on all features: a view window that contains only the approach still finds the route
DO $$ BEGIN
    IF (SELECT count(*) FROM route_geo
        WHERE geometry && ST_MakeEnvelope(42.94, 42.94, 42.96, 42.96, 4326)
          AND ST_Intersects(geometry, ST_MakeEnvelope(42.94, 42.94, 42.96, 42.96, 4326))) <> 1
    THEN RAISE EXCEPTION 'FAIL bbox search over features'; END IF;
    RAISE NOTICE 'OK   bbox search over features';
END $$;

-- radius search in metres via geography (~1.1 km away: inside 2 km, outside 500 m)
DO $$ BEGIN
    IF (SELECT count(*) FROM route_geo
        WHERE ST_DWithin(anchor_point::geography, ST_SetSRID(ST_MakePoint(43.0, 43.01), 4326)::geography, 2000)) <> 1
    OR (SELECT count(*) FROM route_geo
        WHERE ST_DWithin(anchor_point::geography, ST_SetSRID(ST_MakePoint(43.0, 43.01), 4326)::geography, 500)) <> 0
    THEN RAISE EXCEPTION 'FAIL radius search'; END IF;
    RAISE NOTICE 'OK   radius search';
END $$;

-- the GiST index must be usable for bbox queries
SET LOCAL enable_seqscan = off;
DO $$
DECLARE
    line text;
    plan text := '';
BEGIN
    -- Collect every plan line: with a bitmap scan the index name is not on the first one.
    FOR line IN EXECUTE 'EXPLAIN SELECT route_id FROM route_geo WHERE geometry && ST_MakeEnvelope(42.9, 42.9, 43.1, 43.1, 4326)'
    LOOP
        plan := plan || line || E'\n';
    END LOOP;
    IF plan NOT LIKE '%route_geo_geometry_gix%' THEN
        RAISE EXCEPTION 'FAIL gist index not used: %', plan;
    END IF;
    RAISE NOTICE 'OK   gist index used';
END $$;

-- append-only trigger must accept a review update on a revision (to_jsonb over all columns)
UPDATE route_revisions SET review_note = 'ok' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_fail('edit feature geometry', $q$
    UPDATE route_revision_features SET geometry = ST_SetSRID(ST_MakePoint(43.5, 43.5), 4326)
    WHERE revision_id = '30000000-0000-0000-0000-000000000001' AND position = 2
$q$);

SELECT 'ALL POSTGIS TESTS PASSED';
ROLLBACK;
