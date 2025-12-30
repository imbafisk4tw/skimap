-- Skigebiete Karte – Postgres/PostGIS Starter Schema
-- Target: PostgreSQL 14+ (works fine on 15/16/17), PostGIS 3+
-- Notes:
--  - Uses UUID PKs (pgcrypto) + "stable_id" for your front-end / import stability
--  - Uses geometry(Point,4326) for spatial indexing and queries
--  - Keeps flexible fields in jsonb "meta"

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Optional: trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- Core entities ----------

CREATE TABLE IF NOT EXISTS resort (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id     text NOT NULL UNIQUE,           -- your stable string id (slug or existing id)
  name          text NOT NULL,
  country       text,
  region        text,
  website       text,
  is_glacier    boolean DEFAULT false,
  center_geom   geometry(Point, 4326),          -- optional centroid/label point
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resort_center_geom_gix ON resort USING gist(center_geom);
CREATE INDEX IF NOT EXISTS resort_name_trgm_idx ON resort USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS pass (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id   text NOT NULL UNIQUE,             -- e.g. "snowcard-tirol"
  name        text NOT NULL,
  pass_type   text NOT NULL DEFAULT 'season',   -- season/day/partner/etc (free-text)
  website     text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grp (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id  text NOT NULL UNIQUE,              -- e.g. "skiwelt", "zillertal"
  name       text NOT NULL,
  kind       text NOT NULL,                     -- verbund/brand/cluster/region/... (free-text)
  website    text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Relationship tables (n:m) ----------

CREATE TABLE IF NOT EXISTS resort_pass (
  resort_id uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  pass_id   uuid NOT NULL REFERENCES pass(id)   ON DELETE CASCADE,
  PRIMARY KEY (resort_id, pass_id)
);

CREATE TABLE IF NOT EXISTS resort_group (
  resort_id uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES grp(id)    ON DELETE CASCADE,
  PRIMARY KEY (resort_id, group_id)
);

-- ---------- Access points / parking ----------

CREATE TABLE IF NOT EXISTS access_point (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id      text NOT NULL UNIQUE,          -- e.g. "skiwelt-ellmau-hartkaiserbahn"
  resort_id      uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'lift',  -- lift/entry/valley_station/... (free-text)
  geom           geometry(Point, 4326) NOT NULL,
  priority       integer NOT NULL DEFAULT 0,    -- higher = preferred entry point
  google_place_id text,                         -- optional, if you want to deep-link to Google
  google_maps_url text,                         -- optional
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_point_geom_gix ON access_point USING gist(geom);
CREATE INDEX IF NOT EXISTS access_point_resort_idx ON access_point(resort_id);

CREATE TABLE IF NOT EXISTS parking (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id       text NOT NULL UNIQUE,          -- e.g. "p-horbergbahn"
  access_point_id uuid NOT NULL REFERENCES access_point(id) ON DELETE CASCADE,
  name            text NOT NULL,
  geom            geometry(Point, 4326) NOT NULL,
  capacity_hint   integer,
  paid            boolean,
  covered         boolean,
  max_height_m    numeric(4,2),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parking_geom_gix ON parking USING gist(geom);
CREATE INDEX IF NOT EXISTS parking_access_point_idx ON parking(access_point_id);

-- ---------- Search helpers (aliases) ----------

CREATE TABLE IF NOT EXISTS alias (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL CHECK (entity_type IN ('resort','pass','group','access_point','parking')),
  entity_id    uuid NOT NULL,
  alias_text   text NOT NULL,
  weight       integer NOT NULL DEFAULT 1,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alias_text_idx ON alias(alias_text);
CREATE INDEX IF NOT EXISTS alias_entity_idx ON alias(entity_type, entity_id);

-- ---------- Real drive times cache (origin -> parking) ----------
CREATE TABLE IF NOT EXISTS road_time_cache (
  origin_key    text NOT NULL,                  -- e.g. "muc" or hash("lat,lon")
  origin_geom   geometry(Point,4326) NOT NULL,
  parking_id    uuid NOT NULL REFERENCES parking(id) ON DELETE CASCADE,
  drive_seconds integer NOT NULL,
  provider      text NOT NULL DEFAULT 'ors',
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (origin_key, parking_id)
);

CREATE INDEX IF NOT EXISTS rtc_origin_geom_gix ON road_time_cache USING gist(origin_geom);
CREATE INDEX IF NOT EXISTS rtc_drive_seconds_idx ON road_time_cache(drive_seconds);

-- ---------- Updated-at trigger ----------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'resort_set_updated_at') THEN
    CREATE TRIGGER resort_set_updated_at BEFORE UPDATE ON resort
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pass_set_updated_at') THEN
    CREATE TRIGGER pass_set_updated_at BEFORE UPDATE ON pass
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'grp_set_updated_at') THEN
    CREATE TRIGGER grp_set_updated_at BEFORE UPDATE ON grp
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'access_point_set_updated_at') THEN
    CREATE TRIGGER access_point_set_updated_at BEFORE UPDATE ON access_point
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'parking_set_updated_at') THEN
    CREATE TRIGGER parking_set_updated_at BEFORE UPDATE ON parking
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMIT;
