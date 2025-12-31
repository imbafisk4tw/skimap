-- ============================================
-- Migration: Statische Spalten in resort-Tabelle
-- ============================================

-- 1. Neue Spalten zur resort-Tabelle hinzufügen
ALTER TABLE resort
ADD COLUMN lifts_total INTEGER,
ADD COLUMN pistes_km NUMERIC,
ADD COLUMN max_elevation_m INTEGER;

-- 2. Daten aus resort_stats_current übernehmen
UPDATE resort r
SET
  lifts_total = s.lifts_total,
  pistes_km = s.pistes_km,
  max_elevation_m = s.max_elevation_m
FROM resort_stats_current s
WHERE r.id = s.resort_id;

-- 3. Verifizieren
SELECT name, lifts_total, pistes_km, max_elevation_m
FROM resort
WHERE lifts_total IS NOT NULL
LIMIT 5;

-- 4. Spalten aus resort_stats_current entfernen (optional, erst nach Verifikation)
-- ALTER TABLE resort_stats_current
-- DROP COLUMN lifts_total,
-- DROP COLUMN pistes_km,
-- DROP COLUMN max_elevation_m;
