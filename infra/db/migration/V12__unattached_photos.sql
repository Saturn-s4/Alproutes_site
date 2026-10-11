-- A photo may be uploaded before its route exists (POST /photos): it stays unattached, visible to
-- its author only, until a new route takes it into revision 1 and the server sets route_id.
DO $$
DECLARE
    c text;
BEGIN
    SELECT conname INTO c
      FROM pg_constraint
     WHERE conrelid = 'photos'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%num_nonnulls(route_id, area_id) = 1%';
    IF c IS NULL THEN
        RAISE EXCEPTION 'photos owner check not found';
    END IF;
    EXECUTE format('ALTER TABLE photos DROP CONSTRAINT %I', c);
END $$;

ALTER TABLE photos ADD CONSTRAINT photos_owner_check CHECK (num_nonnulls(route_id, area_id) <= 1);

CREATE INDEX photos_unattached_idx ON photos (author_id, created_at)
    WHERE route_id IS NULL AND area_id IS NULL AND deleted_at IS NULL;
