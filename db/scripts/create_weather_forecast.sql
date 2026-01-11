-- ============================================
-- Wetter-Vorhersage Tabelle
-- Quelle: GeoSphere Austria API
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS weather_forecast (
  resort_id        uuid NOT NULL REFERENCES resort(id) ON DELETE CASCADE,
  provider         text NOT NULL DEFAULT 'geosphere',
  forecast_time    timestamptz NOT NULL,               -- Für wann gilt die Vorhersage?
  fetched_at       timestamptz NOT NULL DEFAULT now(), -- Wann abgerufen?

  -- Schnee
  snowfall_mm      numeric(6,1),    -- Neuschnee (Wasseräquivalent in mm)
  snowfall_cm      numeric(6,1),    -- Neuschnee geschätzt (~10x mm, höhenabhängig)
  snow_limit_m     integer,         -- Schneefallgrenze in Meter

  -- Temperatur
  temp_2m          numeric(4,1),    -- 2m Temperatur °C

  -- Niederschlag
  precip_mm        numeric(6,1),    -- Gesamtniederschlag mm

  PRIMARY KEY (resort_id, provider, forecast_time)
);

-- Alte Vorhersagen können überschrieben werden (neuere fetched_at gewinnt)
COMMENT ON TABLE weather_forecast IS 'Wettervorhersagen pro Resort (GeoSphere Austria)';

-- Indizes für schnellen Zugriff
CREATE INDEX IF NOT EXISTS idx_weather_forecast_time
  ON weather_forecast(forecast_time);

CREATE INDEX IF NOT EXISTS idx_weather_forecast_resort_future
  ON weather_forecast(resort_id, forecast_time)
  WHERE forecast_time > now() - interval '1 hour';

-- View: Nächste 48h Vorhersage pro Resort
CREATE OR REPLACE VIEW v_weather_forecast_48h AS
SELECT
  r.stable_id,
  r.name as resort_name,
  wf.forecast_time,
  wf.snowfall_cm,
  wf.snow_limit_m,
  wf.temp_2m,
  wf.precip_mm,
  wf.fetched_at
FROM weather_forecast wf
JOIN resort r ON r.id = wf.resort_id
WHERE wf.forecast_time > now()
  AND wf.forecast_time < now() + interval '48 hours'
ORDER BY r.stable_id, wf.forecast_time;

-- View: Schneevorhersage Zusammenfassung (nächste 24h/48h)
CREATE OR REPLACE VIEW v_snow_forecast_summary AS
SELECT
  r.id as resort_id,
  r.stable_id,
  r.name,
  r.max_elevation_m,
  -- Summe Neuschnee nächste 24h
  COALESCE(SUM(wf.snowfall_cm) FILTER (
    WHERE wf.forecast_time < now() + interval '24 hours'
  ), 0) as snow_24h_cm,
  -- Summe Neuschnee nächste 48h
  COALESCE(SUM(wf.snowfall_cm) FILTER (
    WHERE wf.forecast_time < now() + interval '48 hours'
  ), 0) as snow_48h_cm,
  -- Minimale Schneefallgrenze
  MIN(wf.snow_limit_m) FILTER (
    WHERE wf.snowfall_cm > 0
  ) as min_snow_limit_m,
  -- Tiefste Temperatur
  MIN(wf.temp_2m) as temp_min,
  -- Letztes Update
  MAX(wf.fetched_at) as last_update
FROM resort r
LEFT JOIN weather_forecast wf ON wf.resort_id = r.id
  AND wf.forecast_time > now()
  AND wf.forecast_time < now() + interval '48 hours'
GROUP BY r.id, r.stable_id, r.name, r.max_elevation_m;

-- Cleanup-Funktion: Alte Vorhersagen löschen (>7 Tage)
CREATE OR REPLACE FUNCTION cleanup_old_forecasts()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM weather_forecast
  WHERE forecast_time < now() - interval '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
