-- Constraint and trigger regression tests for the schema (no PostGIS needed).
-- Every negative case must be REJECTED by the database; the run stops on the first
-- statement that is wrongly accepted. Everything is rolled back at the end.
--
--   psql -v ON_ERROR_STOP=1 -f infra/db/tests/constraints_test.sql
\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'OK   (rejected) %: %', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'FAIL (accepted) %', label;
END $$;
INSERT INTO users (id, display_name) VALUES ('00000000-0000-0000-0000-000000000001','Автор'), ('00000000-0000-0000-0000-000000000002','Модератор');
INSERT INTO areas (id, type, slug, name) VALUES ('10000000-0000-0000-0000-000000000001','mountain_system','kavkaz','{"ru":"Кавказ","en":"Caucasus"}');
INSERT INTO areas (id, parent_id, type, slug, name) VALUES ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','region','bezengi','{"ru":"Безенги"}');
INSERT INTO areas (id, parent_id, type, slug, name) VALUES ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','summit','peak-x','{"ru":"Вершина X"}');
SELECT pg_temp.expect_fail('area cycle', $q$UPDATE areas SET parent_id='10000000-0000-0000-0000-000000000003' WHERE id='10000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('elevation on non-summit', $q$UPDATE areas SET elevation_m=5000 WHERE slug='bezengi'$q$);
SELECT pg_temp.expect_fail('bad localized key', $q$INSERT INTO areas (type, slug, name) VALUES ('other','x','{"RU":"x"}')$q$);
SELECT pg_temp.expect_fail('empty localized value', $q$INSERT INTO areas (type, slug, name) VALUES ('other','x','{"ru":"  "}')$q$);
SELECT pg_temp.expect_fail('bad slug', $q$INSERT INTO areas (type, slug, name) VALUES ('other','Bad Slug','{"ru":"x"}')$q$);
SELECT search_text FROM areas WHERE slug='kavkaz';

INSERT INTO routes (id, slug, created_by) VALUES ('20000000-0000-0000-0000-000000000001','route-x','00000000-0000-0000-0000-000000000001');
INSERT INTO route_revisions (id, route_id, revision_number, author_id, area_id, name, season_months)
  VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','{"ru":"Маршрут X"}','{7,8}');
INSERT INTO route_revision_grades VALUES ('30000000-0000-0000-0000-000000000001','RU','5Б'), ('30000000-0000-0000-0000-000000000001','UIAA','VI+'), ('30000000-0000-0000-0000-000000000001','AID','A2');
SELECT pg_temp.expect_fail('Latin B in RU grade', $q$INSERT INTO route_revision_grades VALUES ('30000000-0000-0000-0000-000000000001','IFAS','5B')$q$);
SELECT pg_temp.expect_fail('second RU grade', $q$INSERT INTO route_revision_grades VALUES ('30000000-0000-0000-0000-000000000001','RU','5А')$q$);
SELECT pg_temp.expect_fail('current while pending', $q$UPDATE route_revisions SET is_current=true WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('bad season month', $q$INSERT INTO route_revisions (route_id, revision_number, author_id, area_id, name, season_months) VALUES ('20000000-0000-0000-0000-000000000001',9,'00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','{"ru":"x"}','{13}')$q$);
UPDATE route_revisions SET status='approved', is_current=true, reviewed_by='00000000-0000-0000-0000-000000000002', reviewed_at=now() WHERE id='30000000-0000-0000-0000-000000000001';
SELECT 'OK   approve allowed';
SELECT pg_temp.expect_fail('edit snapshot', $q$UPDATE route_revisions SET name='{"ru":"Иное"}' WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('delete revision', $q$DELETE FROM route_revisions WHERE id='30000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('grade on approved revision', $q$INSERT INTO route_revision_grades VALUES ('30000000-0000-0000-0000-000000000001','WI','WI4')$q$);
SELECT pg_temp.expect_fail('change grade', $q$UPDATE route_revision_grades SET value='6А' WHERE system_code='RU'$q$);
INSERT INTO route_revisions (id, route_id, revision_number, base_revision_id, author_id, area_id, name)
  VALUES ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',2,'30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','{"ru":"Маршрут X v2"}');
SELECT pg_temp.expect_fail('two current revisions', $q$UPDATE route_revisions SET status='approved', is_current=true, reviewed_by='00000000-0000-0000-0000-000000000002', reviewed_at=now() WHERE id='30000000-0000-0000-0000-000000000002'$q$);
-- switch current in one transaction: unset old, set new
UPDATE route_revisions SET is_current=false WHERE id='30000000-0000-0000-0000-000000000001';
UPDATE route_revisions SET status='approved', is_current=true, reviewed_by='00000000-0000-0000-0000-000000000002', reviewed_at=now() WHERE id='30000000-0000-0000-0000-000000000002';
SELECT 'OK   current switched';
-- filter by grade range within a system
SELECT 'grade filter hits: ' || count(*) FROM route_revisions rv JOIN route_revision_grades g ON g.revision_id=rv.id
  JOIN grade_values gv USING (system_code, value) WHERE rv.is_current IS NOT NULL AND g.system_code='RU'
  AND gv.sort_order BETWEEN (SELECT sort_order FROM grade_values WHERE system_code='RU' AND value='4А') AND (SELECT sort_order FROM grade_values WHERE system_code='RU' AND value='5Б');

INSERT INTO ascents (id, route_id, user_id, ascent_date, date_precision) VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','1985-07-01','month');
SELECT pg_temp.expect_fail('month precision not normalized', $q$INSERT INTO ascents (id, route_id, user_id, ascent_date, date_precision) VALUES (gen_random_uuid(),'20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','1985-07-15','month')$q$);
SELECT pg_temp.expect_fail('member without name or user', $q$INSERT INTO ascent_members (ascent_id, position) VALUES ('40000000-0000-0000-0000-000000000001',0)$q$);
SELECT pg_temp.expect_fail('comment on two targets', $q$INSERT INTO comments (id, author_id, route_id, ascent_id, body) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','x')$q$);

INSERT INTO uploads (storage_key, user_id, purpose, content_type, size_bytes, expires_at) VALUES ('p1','00000000-0000-0000-0000-000000000001','photo','image/jpeg',1000, now()+interval '1 hour'),('d1','00000000-0000-0000-0000-000000000001','document','application/pdf',1000, now()+interval '1 hour');
INSERT INTO routes (id, slug, created_by) VALUES ('20000000-0000-0000-0000-000000000009','other-route','00000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_fail('ascent photo on another route', $q$INSERT INTO photos (id, route_id, ascent_id, author_id, kind, storage_key, content_type) VALUES (gen_random_uuid(),'20000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','detail','p1','image/jpeg')$q$);
SELECT pg_temp.expect_fail('photo with unknown upload', $q$INSERT INTO photos (id, route_id, author_id, kind, storage_key, content_type) VALUES (gen_random_uuid(),'20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','topo','nope','image/jpeg')$q$);
INSERT INTO photos (id, route_id, ascent_id, author_id, kind, storage_key, content_type) VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','topo','p1','image/jpeg');
SELECT pg_temp.expect_fail('photo ready without size', $q$UPDATE photos SET processing_status='ready' WHERE id='50000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('topo without formatVersion', $q$INSERT INTO topo_lines (photo_id, route_id, version, drawing, author_id) VALUES ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'{"paths":[]}','00000000-0000-0000-0000-000000000001')$q$);

INSERT INTO documents (id, route_id, uploaded_by, storage_key, title, source_type, source_description) VALUES ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','d1','{"ru":"Описание 1978"}','classifier','Классификатор, 1978');
SELECT pg_temp.expect_fail('publish document with unknown rights', $q$UPDATE documents SET visibility='visible' WHERE id='60000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('publish without rights review', $q$UPDATE documents SET visibility='visible', rights_status='public_domain' WHERE id='60000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.expect_fail('licensed without note', $q$UPDATE documents SET rights_status='licensed' WHERE id='60000000-0000-0000-0000-000000000001'$q$);
UPDATE documents SET visibility='visible', rights_status='permission_granted', rights_note='Письмо автора от 2026-09-01', rights_reviewed_by='00000000-0000-0000-0000-000000000002', rights_reviewed_at=now() WHERE id='60000000-0000-0000-0000-000000000001';
SELECT 'OK   document published after rights review';

INSERT INTO moderation_flags (target_type, target_id, reporter_id, reason) VALUES ('route','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','incorrect_data');
SELECT pg_temp.expect_fail('duplicate open flag', $q$INSERT INTO moderation_flags (target_type, target_id, reporter_id, reason) VALUES ('route','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','spam')$q$);
INSERT INTO moderation_log (actor_id, action, target_type, target_id) VALUES ('00000000-0000-0000-0000-000000000002','approve_revision','route_revision','30000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_fail('edit audit log', $q$UPDATE moderation_log SET note='x'$q$);
SELECT pg_temp.expect_fail('delete audit log', $q$DELETE FROM moderation_log$q$);
SELECT pg_temp.expect_fail('flag other without note', $q$INSERT INTO moderation_flags (target_type, target_id, reporter_id, reason) VALUES ('route','20000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','other')$q$);
SELECT 'ALL TESTS PASSED';
ROLLBACK;
