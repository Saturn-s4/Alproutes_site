-- Participants attach photos to route comments. The photo stays a photo of the route (gallery,
-- topo lines); comment_id only groups it under the comment and goes away with it.
ALTER TABLE photos ADD COLUMN comment_id uuid REFERENCES comments (id);
ALTER TABLE photos ADD CONSTRAINT photos_comment_route_check CHECK (comment_id IS NULL OR route_id IS NOT NULL);
CREATE INDEX photos_comment_idx ON photos (comment_id) WHERE comment_id IS NOT NULL;
