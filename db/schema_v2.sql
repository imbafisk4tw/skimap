-- ============================================
-- Skigebiete Karte - Schema V2
-- PostgreSQL 14+ / PostGIS 3+
-- ============================================

BEGIN;

-- Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- Fuzzy search

-- ============================================
-- KERN-ENTITÄTEN
-- ============================================

-- Länder-Referenztabelle (optional, für Konsistenz)
CREATE TABLE IF NOT EXISTS country (
  code        char(2) PRIMARY KEY,       -- ISO 3166-1 alpha-2: AT, CH, DE, IT, FR, SI
  name_de     text NOT NULL,
  name_en     text
);

INSERT INTO country (code, name_de, name_en) VALUES
  ('AT', 'Österreich', 'Austria'),
  ('CH', 'Schweiz', 'Switzerland'),
  ('DE', 'Deutschland', 'Germany'),
  ('IT', 'Italien', 'Italy'),
  ('FR', 'Frankreich', 'France'),
  ('SI', 'Slowenien', 'Slovenia')
ON CONFLICT DO NOTHING;

-- Skigebiete (Haupttabelle)
CREATE TABLE IF NOT EXISTS resort (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id       text NOT NULL UNIQUE,              -- Slug: "soelden", "zermatt"
  name            text NOT NULL,
  country         char(2) REFERENCES country(code),
  region          text,                              -- "Tirol", "Wallis"
  website         text,

  -- Statische Stammdaten
  is_glacier      boolean DEFAULT false,
  pistes_km       numeric(7,2),                      -- Pistenkilometer
  lifts_total     integer,                           -- Anzahl Lifte
  max_elevation_m integer,                           -- Höchster Punkt
  min_elevation_m integer,                           -- Talstation Höhe (optional)

  -- GPS (Zentrum des Gebiets)
  center_geom     geometry(Point, 4326),

  -- Flexible Zusatzdaten
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resort_center_geom_gix ON resort USING gist(center_geom);
CREATE INDEX IF NOT EXISTS resort_name_trgm_idx ON resort USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS resort_country_idx ON resort(country);
CREATE INDEX IF NOT EXISTS resort_pistes_km_idx ON resort(pistes_km) WHERE pistes_km IS NOT NULL;

-- ============================================
-- SAISONKARTEN / PÄSSE
-- ============================================

CREATE TABLE IF NOT EXISTS pass (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id   text NOT NULL UNIQUE,              -- "snowcard-tirol", "super-ski-card"
  name        text NOT NULL,
  pass_type   text NOT NULL DEFAULT 'season',    -- season, day, partner, regional
  website     text,
  valid_from  date,                              -- Gültigkeitszeitraum (optional)
  valid_to    date,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Resort ↔ Pass (N:M)
CREATE TABLE IF NOT EXISTS resort_pass (
  resort_id uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  pass_id   uuid NOT NULL REFERENCES pass(id)   ON DELETE CASCADE,
  PRIMARY KEY (resort_id, pass_id)
);

-- ============================================
-- VERBUNDGEBIETE / GRUPPEN
-- ============================================

CREATE TABLE IF NOT EXISTS grp (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id  text NOT NULL UNIQUE,               -- "zillertal-arena", "skiwelt"
  name       text NOT NULL,                      -- "Zillertal Arena", "SkiWelt Wilder Kaiser"
  kind       text NOT NULL DEFAULT 'verbund',    -- verbund, region, cluster, brand
  website    text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Resort ↔ Gruppe (N:M)
CREATE TABLE IF NOT EXISTS resort_group (
  resort_id uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES grp(id)    ON DELETE CASCADE,
  is_primary boolean DEFAULT false,              -- Hauptgebiet der Gruppe?
  PRIMARY KEY (resort_id, group_id)
);

-- ============================================
-- EINSTIEGSPUNKTE & PARKPLÄTZE
-- ============================================

-- Talstationen, Einstiegspunkte
CREATE TABLE IF NOT EXISTS access_point (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id       text NOT NULL UNIQUE,           -- "soelden-gaislachkogl"
  resort_id       uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  name            text NOT NULL,                  -- "Gaislachkoglbahn Talstation"
  kind            text NOT NULL DEFAULT 'lift',   -- lift, valley_station, entry, gondola
  geom            geometry(Point, 4326) NOT NULL,
  elevation_m     integer,                        -- Höhe der Station
  priority        integer NOT NULL DEFAULT 0,     -- Höher = bevorzugter Einstieg
  google_place_id text,
  google_maps_url text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_point_geom_gix ON access_point USING gist(geom);
CREATE INDEX IF NOT EXISTS access_point_resort_idx ON access_point(resort_id);

-- Parkplätze (gehören zu Einstiegspunkten)
CREATE TABLE IF NOT EXISTS parking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id       text NOT NULL UNIQUE,           -- "p-gaislachkogl-1"
  access_point_id uuid NOT NULL REFERENCES access_point(id) ON DELETE CASCADE,
  name            text NOT NULL,
  geom            geometry(Point, 4326) NOT NULL,
  capacity_hint   integer,                        -- Geschätzte Kapazität
  paid            boolean,
  covered         boolean,                        -- Parkhaus?
  max_height_m    numeric(4,2),                   -- Max. Einfahrtshöhe
  price_hint      text,                           -- "€15/Tag" (informativ)
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parking_geom_gix ON parking USING gist(geom);
CREATE INDEX IF NOT EXISTS parking_access_point_idx ON parking(access_point_id);

-- ============================================
-- EXTERNE LINKS (Bergfex, Skiresort.info etc.)
-- ============================================

CREATE TABLE IF NOT EXISTS resort_external_link (
  provider        text NOT NULL,                  -- 'bergfex', 'skiresort_info'
  external_url    text NOT NULL,                  -- Volle URL
  resort_id       uuid REFERENCES resort(id) ON DELETE SET NULL,
  external_name   text,                           -- Name wie auf der Quelle
  external_country text,                          -- Land-Code der Quelle
  match_status    text DEFAULT 'unmatched',       -- unmatched, matched, manual, rejected
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_url)
);

CREATE INDEX IF NOT EXISTS idx_resort_external_link_resort ON resort_external_link(resort_id);
CREATE INDEX IF NOT EXISTS idx_resort_external_link_status ON resort_external_link(match_status);

-- ============================================
-- DYNAMISCHE DATEN (Schnee, Preise, Live-Status)
-- ============================================

CREATE TABLE IF NOT EXISTS resort_stats_snapshot (
  resort_id        uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  provider         text NOT NULL,                 -- 'bergfex', 'skiresort_info'
  fetched_at       timestamptz NOT NULL DEFAULT now(),

  -- Live-Daten
  lifts_open       integer,
  status           text,                          -- 'open', 'closed', 'partial'

  -- Schneelage
  snow_valley_cm   numeric(6,1),                  -- Schnee Tal
  snow_mountain_cm numeric(6,1),                  -- Schnee Berg
  snow_fresh_cm    numeric(6,1),                  -- Neuschnee

  -- Preise (Tageskarte Erwachsener)
  price_currency   text,                          -- 'EUR', 'CHF'
  price_value      numeric(10,2),
  price_raw        text,                          -- Original-String

  -- Rohdaten
  source_url       text,
  raw              jsonb,                         -- Original-Response

  PRIMARY KEY (resort_id, provider, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_resort_stats_latest
  ON resort_stats_snapshot(resort_id, provider, fetched_at DESC);

-- View: Aktuellster Snapshot pro Resort+Provider
CREATE OR REPLACE VIEW resort_stats_current AS
SELECT DISTINCT ON (resort_id, provider)
  resort_id, provider, fetched_at,
  lifts_open, status,
  snow_valley_cm, snow_mountain_cm, snow_fresh_cm,
  price_currency, price_value, price_raw,
  source_url
FROM resort_stats_snapshot
ORDER BY resort_id, provider, fetched_at DESC;

-- ============================================
-- HOME-ADRESSEN (Startpunkte für Fahrzeit)
-- ============================================

CREATE TABLE IF NOT EXISTS home (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id   text NOT NULL UNIQUE,              -- "muc", "muc_home", "user_xyz"
  name        text NOT NULL,                     -- "München Zentrum"
  geom        geometry(Point, 4326) NOT NULL,

  -- Metadaten
  is_public   boolean DEFAULT false,             -- In Dropdown anzeigen?
  is_default  boolean DEFAULT false,             -- Standard-Home?
  source      text,                              -- 'manual', 'gps', 'geocoded'

  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS home_geom_gix ON home USING gist(geom);

-- ============================================
-- VORBERECHNETE ROUTEN (Home → Resort)
-- ============================================

CREATE TABLE IF NOT EXISTS precomputed_route (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id         uuid NOT NULL REFERENCES home(id) ON DELETE CASCADE,
  resort_id       uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,

  -- Route-Details
  duration_s      integer NOT NULL,              -- Fahrzeit in Sekunden
  distance_m      integer,                       -- Strecke in Metern
  geometry        geometry(LineString, 4326),    -- Die Route selbst

  -- Metadaten
  provider        text NOT NULL DEFAULT 'osrm',  -- 'osrm', 'ors', 'google'
  computed_at     timestamptz NOT NULL DEFAULT now(),

  -- Optional: Zu welchem Access Point führt die Route?
  target_access_point_id uuid REFERENCES access_point(id),

  UNIQUE(home_id, resort_id, provider)
);

CREATE INDEX IF NOT EXISTS precomputed_route_home_idx ON precomputed_route(home_id);
CREATE INDEX IF NOT EXISTS precomputed_route_resort_idx ON precomputed_route(resort_id);
CREATE INDEX IF NOT EXISTS precomputed_route_duration_idx ON precomputed_route(duration_s);

-- ============================================
-- SUCHHELFER (Aliase)
-- ============================================

CREATE TABLE IF NOT EXISTS alias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN ('resort','pass','grp','access_point','parking')),
  entity_id    uuid NOT NULL,
  alias_text   text NOT NULL,
  weight       integer NOT NULL DEFAULT 1,        -- Höher = relevanter
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alias_text_trgm_idx ON alias USING gin (alias_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS alias_entity_idx ON alias(entity_type, entity_id);

-- ============================================
-- HILFSFUNKTIONEN
-- ============================================

-- Auto-Update für updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger für alle relevanten Tabellen
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['resort', 'pass', 'grp', 'access_point', 'parking', 'home', 'resort_external_link']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = tbl || '_set_updated_at') THEN
      EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', tbl, tbl);
    END IF;
  END LOOP;
END $$;

-- ============================================
-- NÜTZLICHE VIEWS
-- ============================================

-- Resort-Übersicht mit aktuellem Schnee
CREATE OR REPLACE VIEW v_resort_with_snow AS
SELECT
  r.id,
  r.stable_id,
  r.name,
  r.country,
  r.region,
  r.pistes_km,
  r.lifts_total,
  r.max_elevation_m,
  r.is_glacier,
  ST_Y(r.center_geom::geometry) as lat,
  ST_X(r.center_geom::geometry) as lon,
  s.snow_valley_cm,
  s.snow_mountain_cm,
  s.lifts_open,
  s.status,
  s.fetched_at as snow_updated_at
FROM resort r
LEFT JOIN resort_stats_current s ON s.resort_id = r.id AND s.provider = 'bergfex';

-- Fahrzeiten von einem Home
CREATE OR REPLACE VIEW v_travel_times AS
SELECT
  h.stable_id as home_id,
  h.name as home_name,
  r.stable_id as resort_id,
  r.name as resort_name,
  r.country,
  pr.duration_s,
  pr.duration_s / 60 as duration_min,
  pr.distance_m,
  pr.distance_m / 1000.0 as distance_km
FROM precomputed_route pr
JOIN home h ON h.id = pr.home_id
JOIN resort r ON r.id = pr.resort_id;

COMMIT;

-- ============================================
-- KOMMENTARE
-- ============================================
COMMENT ON TABLE resort IS 'Skigebiete - Stammdaten';
COMMENT ON TABLE pass IS 'Saisonkarten und Skipässe (Snow Card Tirol, Super Ski Card, etc.)';
COMMENT ON TABLE grp IS 'Verbundgebiete und Skiregionen (Zillertal Arena, SkiWelt, etc.)';
COMMENT ON TABLE access_point IS 'Talstationen und Einstiegspunkte';
COMMENT ON TABLE parking IS 'Parkplätze bei Talstationen';
COMMENT ON TABLE resort_external_link IS 'Mapping zu externen Quellen (Bergfex URLs)';
COMMENT ON TABLE resort_stats_snapshot IS 'Zeitreihe: Schnee, Preise, Live-Status';
COMMENT ON TABLE home IS 'Gespeicherte Startpunkte für Fahrzeitberechnung';
COMMENT ON TABLE precomputed_route IS 'Vorberechnete Routen von Home zu Resort';
