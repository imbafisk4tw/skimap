-- Useful queries for "next parking" and exploration

-- 1) Candidate parkings near a user position (straight-line)
-- Replace :lat, :lon, :radius_m
SELECT
  p.stable_id,
  p.name,
  ap.name AS access_point_name,
  r.name  AS resort_name,
  round(ST_DistanceSphere(p.geom, ST_SetSRID(ST_MakePoint(:lon,:lat),4326))::numeric) AS dist_m
FROM parking p
JOIN access_point ap ON ap.id=p.access_point_id
JOIN resort r ON r.id=ap.resort_id
WHERE ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, :radius_m)
ORDER BY dist_m
LIMIT 30;

-- 2) Sort by real drive time if cached (origin_key), else fallback to straight distance
-- Replace :origin_key, :lat, :lon
SELECT
  p.stable_id,
  p.name,
  ap.name AS access_point_name,
  r.name  AS resort_name,
  rtc.drive_seconds,
  round(ST_DistanceSphere(p.geom, ST_SetSRID(ST_MakePoint(:lon,:lat),4326))::numeric) AS dist_m
FROM parking p
JOIN access_point ap ON ap.id=p.access_point_id
JOIN resort r ON r.id=ap.resort_id
LEFT JOIN road_time_cache rtc
  ON rtc.parking_id = p.id AND rtc.origin_key = :origin_key
WHERE ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, 50000) -- 50km prefilter
ORDER BY
  (rtc.drive_seconds IS NULL) ASC,
  rtc.drive_seconds ASC NULLS LAST,
  dist_m ASC
LIMIT 20;

-- 3) “All entry points for a Group/Verbund”
-- Replace :group_stable_id
SELECT
  r.name AS resort_name,
  ap.name AS access_point_name,
  ap.priority,
  ST_Y(ap.geom) AS lat,
  ST_X(ap.geom) AS lon
FROM grp g
JOIN resort_group rg ON rg.group_id=g.id
JOIN resort r ON r.id=rg.resort_id
JOIN access_point ap ON ap.resort_id=r.id
WHERE g.stable_id = :group_stable_id
ORDER BY r.name, ap.priority DESC, ap.name;
