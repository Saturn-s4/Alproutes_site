-- Extensions and shared helper functions used by later migrations.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
-- gen_random_uuid() is built into PostgreSQL 13+, no pgcrypto needed.

-- Keeps updated_at current. Every mutable table gets this trigger:
-- offline clients sync by "changed since", so updated_at must never lag.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

-- Localized text is stored as {"ru": "...", "en": "..."}.
-- Keys: ISO 639-1 language codes. Values: non-empty strings. At least one key.
-- NULL is accepted so the function can guard nullable columns directly.
CREATE FUNCTION is_localized_text(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT value IS NULL OR (
        jsonb_typeof(value) = 'object'
        AND value <> '{}'::jsonb
        AND NOT EXISTS (
            SELECT 1
            FROM jsonb_each(value) AS e(lang, txt)
            WHERE lang !~ '^[a-z]{2}$'
               OR jsonb_typeof(txt) <> 'string'
               OR btrim(txt #>> '{}') = ''
        )
    )
$$;

-- All translations joined and lower-cased: one trigram index searches every language.
CREATE FUNCTION localized_search_text(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT lower(string_agg(txt, ' ' ORDER BY lang))
    FROM jsonb_each_text(value) AS e(lang, txt)
$$;

-- Append-only guard for history tables (revisions, topo versions, audit log).
-- Trigger arguments list the columns that MAY change after insert
-- (review status and the like); everything else is frozen, and rows cannot be deleted.
CREATE FUNCTION enforce_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    -- COALESCE matters: with no trigger arguments TG_ARGV can be NULL, and
    -- "jsonb - NULL" is NULL, which would silently disable the check below.
    mutable_columns text[] := COALESCE(TG_ARGV, '{}'::text[]);
BEGIN
    -- Stored generated columns are not yet computed in NEW inside a BEFORE trigger,
    -- so they would always look changed. They derive from frozen columns anyway: skip them.
    mutable_columns := mutable_columns || ARRAY(
        SELECT attname::text FROM pg_attribute
        WHERE attrelid = TG_RELID AND attgenerated <> '' AND NOT attisdropped
    );
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rows of % are append-only and cannot be deleted', TG_TABLE_NAME
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (to_jsonb(NEW) - mutable_columns) IS DISTINCT FROM (to_jsonb(OLD) - mutable_columns) THEN
        RAISE EXCEPTION 'rows of % are append-only; only (%) may change',
            TG_TABLE_NAME, array_to_string(COALESCE(TG_ARGV, '{}'::text[]), ', ')
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END
$$;
