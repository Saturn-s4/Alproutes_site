-- Photos that are part of the route description itself (contract: RouteContent.photos).
--
-- Like grades and features, the set belongs to a revision snapshot: an edit of the photo
-- set is a new revision, and a revert brings the old set back. Every other photo of the
-- route is user content (the participants' gallery).
--
-- A revision only references photos; the files and their moderation (visibility,
-- deleted_at) stay on `photos`. A photo hidden or deleted later remains referenced by
-- old revisions, and clients simply do not show it.

CREATE TABLE route_revision_photos (
    revision_id  uuid NOT NULL REFERENCES route_revisions (id),
    -- Display order within the description.
    position     smallint NOT NULL CHECK (position >= 0),
    photo_id     uuid NOT NULL REFERENCES photos (id),
    -- Caption in the description: catalogue text, translatable (unlike photos.caption by the author).
    caption      jsonb CHECK (is_localized_text(caption)),
    PRIMARY KEY (revision_id, position),
    UNIQUE (revision_id, photo_id)
);

CREATE INDEX route_revision_photos_photo_idx ON route_revision_photos (photo_id);

-- Immutable after insert, insertable only while the revision is pending (see V5).
CREATE TRIGGER route_revision_photos_immutable BEFORE INSERT OR UPDATE OR DELETE ON route_revision_photos
    FOR EACH ROW EXECUTE FUNCTION route_revision_child_guard();

-- A description may only show photos of the same route.
CREATE FUNCTION route_revision_photos_route_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM photos p
        JOIN route_revisions r ON r.route_id = p.route_id
        WHERE p.id = NEW.photo_id AND r.id = NEW.revision_id
    ) THEN
        RAISE EXCEPTION 'photo % does not belong to the route of revision %', NEW.photo_id, NEW.revision_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER route_revision_photos_route BEFORE INSERT ON route_revision_photos
    FOR EACH ROW EXECUTE FUNCTION route_revision_photos_route_check();
