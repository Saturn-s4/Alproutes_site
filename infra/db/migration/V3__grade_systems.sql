-- Difficulty grading systems and their allowed values.
--
-- A route has at most one grade per system (see route_revision_grades).
-- sort_order is meaningful ONLY within one system: it powers "from 4A to 5B" filters.
-- There is deliberately no cross-system mapping here: conversion between systems is
-- approximate and must never happen silently.
--
-- New systems/values are added by new migrations; sort_order uses steps of 10
-- so intermediate values can be inserted without renumbering.

CREATE TABLE grade_systems (
    code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]*$'),
    -- overall: seriousness of the whole route (RU, IFAS)
    -- free:    free climbing difficulty (UIAA, FR_FREE, YDS)
    -- aid:     aid climbing (AID)
    -- ice:     water ice (WI)
    kind        text NOT NULL CHECK (kind IN ('overall', 'free', 'aid', 'ice')),
    name        jsonb NOT NULL CHECK (is_localized_text(name)),
    sort_order  integer NOT NULL UNIQUE
);

CREATE TABLE grade_values (
    system_code  text NOT NULL REFERENCES grade_systems (code),
    value        text NOT NULL CHECK (btrim(value) = value AND value <> ''),
    sort_order   integer NOT NULL,
    PRIMARY KEY (system_code, value),
    UNIQUE (system_code, sort_order)
);

INSERT INTO grade_systems (code, kind, name, sort_order) VALUES
    ('RU',      'overall', '{"ru": "Российская классификация", "en": "Russian classification"}', 10),
    ('IFAS',    'overall', '{"ru": "Французская альпийская (IFAS)", "en": "French alpine (IFAS)"}', 20),
    ('UIAA',    'free',    '{"ru": "UIAA", "en": "UIAA"}', 30),
    ('FR_FREE', 'free',    '{"ru": "Французская скальная", "en": "French free climbing"}', 40),
    ('YDS',     'free',    '{"ru": "YDS (США)", "en": "Yosemite Decimal System"}', 50),
    ('AID',     'aid',     '{"ru": "ИТО", "en": "Aid"}', 60),
    ('WI',      'ice',     '{"ru": "Натечный лёд (WI)", "en": "Water ice (WI)"}', 70);

-- NB: RU values use Cyrillic letters А and Б. Latin "5B" is rejected by the foreign key,
-- which is intended: clients take values from GET /grade-systems, never type them.
INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'RU', v, n * 10
FROM unnest(ARRAY['н/к', '1А', '1Б', '2А', '2Б', '3А', '3Б', '4А', '4Б', '5А', '5Б', '6А', '6Б'])
     WITH ORDINALITY AS t(v, n);

INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'IFAS', v, n * 10
FROM unnest(ARRAY['F', 'F+', 'PD-', 'PD', 'PD+', 'AD-', 'AD', 'AD+', 'D-', 'D', 'D+',
                  'TD-', 'TD', 'TD+', 'ED-', 'ED', 'ED+', 'ABO-', 'ABO'])
     WITH ORDINALITY AS t(v, n);

INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'UIAA', v, n * 10
FROM unnest(ARRAY['I', 'I+', 'II-', 'II', 'II+', 'III-', 'III', 'III+', 'IV-', 'IV', 'IV+',
                  'V-', 'V', 'V+', 'VI-', 'VI', 'VI+', 'VII-', 'VII', 'VII+',
                  'VIII-', 'VIII', 'VIII+', 'IX-', 'IX', 'IX+', 'X-', 'X', 'X+',
                  'XI-', 'XI', 'XI+', 'XII-', 'XII'])
     WITH ORDINALITY AS t(v, n);

INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'FR_FREE', v, n * 10
FROM unnest(ARRAY['1', '2', '3', '4a', '4b', '4c', '5a', '5b', '5c',
                  '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+',
                  '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b', '9b+', '9c'])
     WITH ORDINALITY AS t(v, n);

INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'YDS', v, n * 10
FROM unnest(ARRAY['5.0', '5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7', '5.8', '5.9',
                  '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d',
                  '5.12a', '5.12b', '5.12c', '5.12d', '5.13a', '5.13b', '5.13c', '5.13d',
                  '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b', '5.15c', '5.15d'])
     WITH ORDINALITY AS t(v, n);

INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'AID', v, n * 10
FROM unnest(ARRAY['A0', 'A1', 'A2', 'A2+', 'A3', 'A3+', 'A4', 'A4+', 'A5'])
     WITH ORDINALITY AS t(v, n);

INSERT INTO grade_values (system_code, value, sort_order)
SELECT 'WI', v, n * 10
FROM unnest(ARRAY['WI1', 'WI2', 'WI2+', 'WI3', 'WI3+', 'WI4', 'WI4+', 'WI5', 'WI5+',
                  'WI6', 'WI6+', 'WI7'])
     WITH ORDINALITY AS t(v, n);
