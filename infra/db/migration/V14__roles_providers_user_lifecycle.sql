-- Users: roles move to a many-to-many reference, the lifecycle status becomes timestamps.
-- OAuth providers become a reference table (Google only: Apple sign-in is dropped).
-- Refresh token date checks get names.

-- ---------------------------------------------------------------- roles

CREATE TABLE roles (
    id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code  text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z_]*$'),
    name  text NOT NULL CHECK (btrim(name) <> '')
);

INSERT INTO roles (code, name) VALUES
    ('user', 'Пользователь'),
    ('moderator', 'Модератор'),
    ('admin', 'Администратор');

-- Every account holds 'user'; moderator and admin are granted on top of it.
CREATE TABLE user_roles (
    user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id  smallint NOT NULL REFERENCES roles (id),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_idx ON user_roles (role_id);

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.code = 'user';
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.code = u.role WHERE u.role <> 'user';

ALTER TABLE users DROP COLUMN role;

-- ------------------------------------------------------- user lifecycle

-- Active account: blocked_at IS NULL AND deleted_at IS NULL. Accounts are never hard-deleted:
-- their content stays, the profile is anonymized and deleted_at is set.
ALTER TABLE users
    ADD COLUMN blocked_at timestamptz,
    ADD COLUMN deleted_at timestamptz;

-- The old status kept no date; the last update is the closest known moment.
UPDATE users SET blocked_at = updated_at WHERE status = 'blocked';
UPDATE users SET deleted_at = updated_at WHERE status = 'deleted';

ALTER TABLE users DROP COLUMN status;

COMMENT ON COLUMN users.email IS 'NULL for anonymized (deleted) accounts';

-- -------------------------------------------------------- auth providers

CREATE TABLE auth_providers (
    code  text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]*$'),
    name  text NOT NULL CHECK (btrim(name) <> '')
);

INSERT INTO auth_providers (code, name) VALUES ('google', 'Google');

-- Apple sign-in never reached the clients; any leftover Apple identities have no provider now.
DELETE FROM user_identities WHERE provider NOT IN (SELECT code FROM auth_providers);

ALTER TABLE user_identities DROP CONSTRAINT user_identities_provider_check;
ALTER TABLE user_identities
    ADD CONSTRAINT user_identities_provider_fkey FOREIGN KEY (provider) REFERENCES auth_providers (code);

-- ------------------------------------------------------- refresh tokens

ALTER TABLE refresh_tokens RENAME CONSTRAINT refresh_tokens_check TO chk_refresh_tokens_expires_after_created;
-- >=, not >: a token created and revoked in one transaction gets the same now().
ALTER TABLE refresh_tokens
    ADD CONSTRAINT chk_refresh_tokens_revoked_after_created CHECK (revoked_at >= created_at);
