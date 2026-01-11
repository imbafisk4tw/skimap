-- ============================================
-- Zukunftssicherer JSON Export View für V2 Datenbank
-- ============================================
-- Enthält ALLE relevanten Felder aus dem Schema,
-- auch wenn sie noch nicht im Frontend verwendet werden.
-- Das Frontend wird an dieses Schema angepasst.
-- ============================================

DROP VIEW IF EXISTS v_resort_json_export;

CREATE VIEW v_resort_json_export AS
SELECT
    r.id,
    r.stable_id,
    r.pistes_km as "pistesKm",
    ST_Y(r.center_geom) as lat,

    -- Vollständiges JSON-Objekt mit allen Feldern
    jsonb_build_object(
        -- Identifikation
        'id', r.id,
        'stable_id', r.stable_id,

        -- Basisdaten
        'name', r.name,
        'country', r.country,  -- ISO Code (AT, CH, DE, IT, FR, SI)
        'countryName', c.name_en,  -- Voller Name (Austria, Switzerland, ...)
        'region', r.region,
        'website', r.website,

        -- GPS Koordinaten
        'lat', ST_Y(r.center_geom),
        'lon', ST_X(r.center_geom),

        -- Stammdaten
        'glacier', COALESCE(r.is_glacier, false),
        'pistesKm', r.pistes_km,
        'liftsTotal', r.lifts_total,
        'maxElevation', r.max_elevation_m,
        'minElevation', r.min_elevation_m,

        -- Alle Pässe als Array (sct/ssc können daraus abgeleitet werden)
        'passes', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'stable_id', p.stable_id,
                'name', p.name,
                'type', p.pass_type
            ))
            FROM resort_pass rp
            JOIN pass p ON p.id = rp.pass_id
            WHERE rp.resort_id = r.id),
            '[]'::jsonb
        ),

        -- Gruppen/Verbünde
        'primaryGroup', (
            SELECT jsonb_build_object(
                'stable_id', g.stable_id,
                'name', g.name,
                'kind', g.kind
            )
            FROM resort_group rg
            JOIN grp g ON g.id = rg.group_id
            WHERE rg.resort_id = r.id AND rg.is_primary = true
            LIMIT 1
        ),
        'groups', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object(
                'stable_id', g.stable_id,
                'name', g.name,
                'kind', g.kind,
                'isPrimary', rg.is_primary
            ))
            FROM resort_group rg
            JOIN grp g ON g.id = rg.group_id
            WHERE rg.resort_id = r.id),
            '[]'::jsonb
        ),

        -- Einstiegspunkte (Anzahl und primärer)
        'accessPointCount', (
            SELECT COUNT(*) FROM access_point ap WHERE ap.resort_id = r.id
        ),
        'primaryAccessPoint', (
            SELECT jsonb_build_object(
                'stable_id', ap.stable_id,
                'name', ap.name,
                'lat', ST_Y(ap.geom),
                'lon', ST_X(ap.geom),
                'elevation', ap.elevation_m
            )
            FROM access_point ap
            WHERE ap.resort_id = r.id
            ORDER BY ap.priority DESC
            LIMIT 1
        ),

        -- Live-Daten (aktueller Bergfex-Stand)
        'liveData', (
            SELECT jsonb_build_object(
                'liftsOpen', s.lifts_open,
                'status', s.status,
                'snowValley', s.snow_valley_cm,
                'snowMountain', s.snow_mountain_cm,
                'snowFresh', s.snow_fresh_cm,
                'price', s.price_value,
                'priceCurrency', s.price_currency,
                'updatedAt', s.fetched_at
            )
            FROM resort_stats_current s
            WHERE s.resort_id = r.id AND s.provider = 'bergfex'
        ),

        -- Metadaten
        'meta', r.meta,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at

    ) as resort_json
FROM resort r
LEFT JOIN country c ON c.code = r.country
-- Nur Alpen-Region (Bounding Box)
WHERE ST_Y(r.center_geom) BETWEEN 43.5 AND 48.5
  AND ST_X(r.center_geom) BETWEEN 5.0 AND 17.0;

-- ============================================
-- EXPORT BEFEHLE
-- ============================================
-- HINWEIS: Der View filtert bereits auf die Alpen-Region!
-- (Lat 43.5-48.5, Lon 5-17)

-- Alle Alpen-Resorts als JSON Array (Minified):
-- SELECT jsonb_agg(resort_json)
-- FROM v_resort_json_export
-- WHERE lat IS NOT NULL;

-- Mit Filter (z.B. >= 10km Pisten):
-- SELECT jsonb_agg(resort_json)
-- FROM v_resort_json_export
-- WHERE lat IS NOT NULL AND "pistesKm" >= 10;

-- Formatiert (für Lesbarkeit):
-- SELECT jsonb_pretty(jsonb_agg(resort_json))
-- FROM v_resort_json_export
-- WHERE lat IS NOT NULL AND "pistesKm" >= 5;

-- Nur bestimmte Länder:
-- SELECT jsonb_agg(resort_json)
-- FROM v_resort_json_export v
-- JOIN resort r ON r.id = v.id
-- WHERE v.lat IS NOT NULL
--   AND r.country IN ('AT', 'DE', 'CH')
--   AND v."pistesKm" >= 5;

-- ============================================
-- STATISTIKEN
-- ============================================

-- Übersicht:
-- SELECT
--     COUNT(*) as total,
--     COUNT(*) FILTER (WHERE lat IS NOT NULL) as with_gps,
--     COUNT(*) FILTER (WHERE "pistesKm" >= 5) as ">=5km",
--     COUNT(*) FILTER (WHERE "pistesKm" >= 10) as ">=10km"
-- FROM v_resort_json_export;

-- Pro Land:
-- SELECT
--     r.country,
--     COUNT(*) as total,
--     COUNT(*) FILTER (WHERE v."pistesKm" >= 5) as ">=5km"
-- FROM v_resort_json_export v
-- JOIN resort r ON r.id = v.id
-- WHERE v.lat IS NOT NULL
-- GROUP BY r.country
-- ORDER BY total DESC;

-- ============================================
-- FRONTEND KOMPATIBILITÄT
-- ============================================
-- Das Frontend muss folgende Felder unterstützen:
--
-- Pflichtfelder (für Kartenanzeige):
--   stable_id, name, lat, lon, country
--
-- Filter-Felder:
--   pistesKm, liftsTotal, maxElevation, glacier, sct, ssc
--
-- Info-Felder (Popup):
--   region, website, passes, countryName
--
-- Zukünftige Felder (noch nicht im Frontend):
--   minElevation, groups, primaryGroup,
--   accessPointCount, primaryAccessPoint, liveData
