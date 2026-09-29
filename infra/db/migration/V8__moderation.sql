-- Moderation: user flags and an append-only audit log of moderator actions.
-- The review queue itself is not a table: it is the union of pending route revisions,
-- pending topo versions, documents awaiting rights review and open flags.

CREATE TABLE moderation_flags (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Polymorphic target, hence no foreign key; the service validates existence.
    target_type      text NOT NULL CHECK (target_type IN (
                         'area', 'route', 'route_revision', 'photo', 'topo_line',
                         'track', 'document', 'ascent', 'comment', 'user')),
    target_id        uuid NOT NULL,
    reporter_id      uuid NOT NULL REFERENCES users (id),
    reason           text NOT NULL CHECK (reason IN (
                         'spam', 'offensive', 'incorrect_data', 'dangerous_info',
                         'copyright', 'duplicate', 'other')),
    note             text CHECK (length(note) <= 2000),
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    resolved_by      uuid REFERENCES users (id),
    resolved_at      timestamptz,
    resolution_note  text CHECK (length(resolution_note) <= 2000),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'open') = (resolved_at IS NULL)),
    CHECK (resolved_at IS NULL OR resolved_by IS NOT NULL),
    CHECK (reason <> 'other' OR COALESCE(btrim(note), '') <> '')
);

-- One open flag per reporter per target: repeated taps do not flood the queue.
CREATE UNIQUE INDEX moderation_flags_open_uq
    ON moderation_flags (target_type, target_id, reporter_id) WHERE status = 'open';
CREATE INDEX moderation_flags_queue_idx ON moderation_flags (created_at) WHERE status = 'open';
CREATE INDEX moderation_flags_target_idx ON moderation_flags (target_type, target_id);

CREATE TRIGGER moderation_flags_updated_at BEFORE UPDATE ON moderation_flags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE moderation_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id     uuid NOT NULL REFERENCES users (id),
    action       text NOT NULL CHECK (action ~ '^[a-z_]+$'),   -- e.g. approve_revision, hide_photo
    target_type  text NOT NULL,
    target_id    uuid NOT NULL,
    flag_id      uuid REFERENCES moderation_flags (id),
    note         text CHECK (length(note) <= 2000),
    details      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX moderation_log_target_idx ON moderation_log (target_type, target_id, created_at);
CREATE INDEX moderation_log_actor_idx ON moderation_log (actor_id, created_at);

CREATE TRIGGER moderation_log_append_only BEFORE UPDATE OR DELETE ON moderation_log
    FOR EACH ROW EXECUTE FUNCTION enforce_append_only();
