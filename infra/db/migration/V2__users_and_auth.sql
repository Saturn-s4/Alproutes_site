-- Users, OAuth identities and refresh tokens.

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable: Apple sign-in may hide the address, and deleted accounts are anonymized.
    email         citext UNIQUE,
    display_name  text NOT NULL CHECK (btrim(display_name) <> '' AND length(display_name) <= 100),
    avatar_key    text,
    locale        text NOT NULL DEFAULT 'ru' CHECK (locale ~ '^[a-z]{2}$'),
    role          text NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user', 'moderator', 'admin')),
    -- Accounts are never hard-deleted: their content stays, the profile is anonymized.
    status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'blocked', 'deleted')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_identities (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider       text NOT NULL CHECK (provider IN ('google', 'apple')),
    subject        text NOT NULL,          -- "sub" claim of the provider's ID token
    email          citext,                 -- as reported by the provider, informational only
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_login_at  timestamptz,
    UNIQUE (provider, subject)
);

CREATE INDEX user_identities_user_idx ON user_identities (user_id);

-- Refresh tokens are opaque random strings; only their SHA-256 hash is stored.
-- Rotation: each refresh issues a new token in the same family and revokes the old one.
-- Presenting an already revoked token means theft: the whole family is revoked.
CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_id   uuid NOT NULL,
    token_hash  bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    CHECK (expires_at > created_at)
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
