import fs from "node:fs/promises";
import path from "node:path";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// ---------- Helpers ----------
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function osmStableId(el) {
  // Stabil, auch wenn Name sich ändert.
  return `p_${el.type}_${el.id}`;
}

function pickCenter(el) {
  // Node: lat/lon direkt
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  // Way/Relation: Overpass liefert center, wenn du "out center;" nutzt
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

function overpassQueryForAccessPoint(lat, lon, stationRadiusM = 2500, parkingRadiusFromStationsM = 6000) {
  // Stationen nahe AccessPoint -> Parkplätze um Stationen herum
  return `
[out:json][timeout:25];
(
  nwr(around:${stationRadiusM},${lat},${lon})["aerialway"="station"];
)->.stations;

(
  nwr(around.stations:${parkingRadiusFromStationsM})["amenity"="parking"];
  node(around.stations:${parkingRadiusFromStationsM})["amenity"="parking_entrance"];
)->.park;

(.stations; .park;);
out tags center;
`.trim();
}

async function overpassFetch(query) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ---------- Main ----------
async function main() {
  const root = process.cwd();
  const inFile = path.join(root, "data", "access_points.json");
  const cacheDir = path.join(root, "data", "overpass_cache");
  const outCandidates = path.join(root, "data", "parkings_candidates.json");

  await fs.mkdir(cacheDir, { recursive: true });

  const apJson = JSON.parse(await fs.readFile(inFile, "utf-8"));
  const accessPoints = apJson.accessPoints ?? [];

  const allCandidates = [];

  for (const ap of accessPoints) {
    const { id, lat, lon } = ap;
    if (!id || typeof lat !== "number" || typeof lon !== "number") continue;

    const query = overpassQueryForAccessPoint(lat, lon);
    const raw = await overpassFetch(query);

    // Cache raw
    await fs.writeFile(path.join(cacheDir, `${id}.json`), JSON.stringify(raw, null, 2), "utf-8");

    const elements = raw.elements ?? [];

    const stations = [];
    const parkings = [];
    const entrances = [];

    for (const el of elements) {
      const tags = el.tags || {};
      const center = pickCenter(el);

      if (tags.aerialway === "station") {
        stations.push({
          osm: { type: el.type, id: el.id },
          name: tags.name || null,
          center,
          tags,
        });
      }

      if (tags.amenity === "parking") {
        if (!center) continue;
        parkings.push({
          id: osmStableId(el),
          name: tags.name || null,
          lat: center.lat,
          lon: center.lon,
          source: { type: "osm", osmType: el.type, osmId: el.id },
          tags,
          // schneller MVP-Score: Luftlinien-Distanz zum AccessPoint
          approxDistanceM: Math.round(haversineMeters(lat, lon, center.lat, center.lon)),
        });
      }

      if (tags.amenity === "parking_entrance") {
        if (!center) continue;
        entrances.push({
          osm: { type: el.type, id: el.id },
          name: tags.name || null,
          lat: center.lat,
          lon: center.lon,
          tags,
        });
      }
    }

    // Sortiere Kandidaten: näheste zuerst (MVP)
    parkings.sort((a, b) => (a.approxDistanceM ?? 1e12) - (b.approxDistanceM ?? 1e12));

    allCandidates.push({
      accessPoint: { id: ap.id, name: ap.name || null, lat, lon, resortId: ap.resortId || null },
      stationCount: stations.length,
      parkingCount: parkings.length,
      entranceCount: entrances.length,
      topParkings: parkings.slice(0, 15), // Top 15 zum händischen Review
      // Optional: stations/entrances auch ausgeben, wenn du’s prüfen willst:
      // stations, entrances
    });

    console.log(`[${id}] stations=${stations.length} parkings=${parkings.length} entrances=${entrances.length}`);
  }

  await fs.writeFile(outCandidates, JSON.stringify({ generatedAt: new Date().toISOString(), candidates: allCandidates }, null, 2), "utf-8");
  console.log(`Wrote: ${outCandidates}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
