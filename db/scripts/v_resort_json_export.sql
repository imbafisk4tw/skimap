-- ============================================
-- View: v_resort_json_export
-- JSON-Export kompatibel mit data/resorts.json
-- inkl. neuer Filter-Spalten (lifts, pistes, elevation)
-- ============================================

CREATE OR REPLACE VIEW v_resort_json_export AS
WITH pass_agg AS (
    SELECT
        rp.resort_id,
        jsonb_agg(
            jsonb_build_object(
                'stable_id', p.stable_id,
                'name', p.name
            ) ORDER BY p.name
        ) AS passes
    FROM resort_pass rp
    JOIN pass p ON p.id = rp.pass_id
    GROUP BY rp.resort_id
),
group_info AS (
    SELECT
        rg.resort_id,
        g.stable_id AS group_id,
        g.name AS group_name
    FROM resort_group rg
    JOIN grp g ON g.id = rg.group_id
)
SELECT jsonb_build_object(
    'stable_id', r.stable_id,
    'name', r.name,
    'country', r.country,
    'region', r.region,
    'website', r.website,
    'glacier', r.is_glacier,
    'lat', ST_Y(r.center_geom::geometry),
    'lon', ST_X(r.center_geom::geometry),
    'sct', EXISTS (
        SELECT 1 FROM resort_pass rp
        JOIN pass p ON p.id = rp.pass_id
        WHERE rp.resort_id = r.id AND p.stable_id = 'snowcard-tirol'
    ),
    'ssc', EXISTS (
        SELECT 1 FROM resort_pass rp
        JOIN pass p ON p.id = rp.pass_id
        WHERE rp.resort_id = r.id AND p.stable_id = 'super-ski-card'
    ),
    'nearMuc', COALESCE((r.meta->>'nearMuc')::boolean, false),
    'groupId', gi.group_id,
    'groupName', gi.group_name,
    'entryName', r.name,
    'entryType', CASE WHEN gi.group_id IS NOT NULL THEN 'entry' ELSE 'main' END,
    'passes', COALESCE(pa.passes, '[]'::jsonb),
    'liftsTotal', r.lifts_total,
    'pistesKm', r.pistes_km,
    'maxElevation', r.max_elevation_m
) AS resort_json
FROM resort r
LEFT JOIN pass_agg pa ON pa.resort_id = r.id
LEFT JOIN group_info gi ON gi.resort_id = r.id
ORDER BY r.name;

-- ============================================
-- JSON-Export Befehl (psql)
-- ============================================
-- \t on
-- \pset format unaligned
-- \o resorts.json
-- SELECT jsonb_pretty(jsonb_agg(resort_json)) FROM v_resort_json_export;
-- \o
-- \t off
