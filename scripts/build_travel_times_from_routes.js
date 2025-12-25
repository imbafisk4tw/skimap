#!/usr/bin/env node
/**
 * scripts/build_travel_times_from_routes.js
 *
 * Erstellt pro Home-Profil eine travel_times JSON, basierend auf den bereits
 * vorkomputierten Routen-GeoJSONs (data/routes/home_<homeId>.geojson).
 *
 * Output:
 *   data/travel_times/home_<homeId>.json
 * Format:
 *   { "<Resort Name>": { "hours": 2.15, "km": 180.2 }, ... }
 *
 * Usage:
 *   node scripts/build_travel_times_from_routes.js --homes data/homes.json --routes data/routes --out data/travel_times
 *   node scripts/build_travel_times_from_routes.js --homes data/homes.json --routes data/routes --out data/travel_times --force
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (!nxt || nxt.startsWith("--")) out[key] = true;
      else { out[key] = nxt; i++; }
    }
  }
  return out;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function round(n, d) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

async function main() {
  const args = parseArgs(process.argv);
  const homesPath = args.homes || "data/homes.json";
  const routesDir = args.routes || "data/routes";
  const outDir = args.out || "data/travel_times";
  const force = !!args.force;

  if (!fs.existsSync(homesPath)) {
    console.error("homes.json not found:", homesPath);
    process.exit(1);
  }
  ensureDir(outDir);

  const homesObj = readJson(homesPath);
  const homeIds = Object.keys(homesObj);

  let wrote = 0, skipped = 0, missing = 0;

  for (const homeId of homeIds) {
    const inFile = path.join(routesDir, `home_${homeId}.geojson`);
    const outFile = path.join(outDir, `home_${homeId}.json`);

    if (!fs.existsSync(inFile)) {
      console.warn(`[skip] route file missing for home '${homeId}': ${inFile}`);
      missing++;
      continue;
    }

    if (!force && fs.existsSync(outFile)) {
      skipped++;
      continue;
    }

    const geo = readJson(inFile);
    const feats = (geo && geo.features) ? geo.features : [];
    const ttMap = {};

    for (const f of feats) {
      const p = f && f.properties ? f.properties : {};
      const name = (p.name != null) ? String(p.name) : null;
      if (!name) continue;

      let hours = null;
      if (typeof p.duration_sec === "number") hours = p.duration_sec / 3600.0;
      else if (typeof p.duration_min === "number") hours = p.duration_min / 60.0;

      let km = null;
      if (typeof p.distance_km === "number") km = p.distance_km;
      else if (typeof p.distance_m === "number") km = p.distance_m / 1000.0;

      if (hours == null || km == null) continue;

      ttMap[name] = { hours: round(hours, 2), km: round(km, 1) };
    }

    fs.writeFileSync(outFile, JSON.stringify(ttMap, null, 2));
    wrote++;
    console.log(`[ok] ${homeId}: ${Object.keys(ttMap).length} entries -> ${outFile}`);
  }

  console.log(`Done. wrote=${wrote} skipped=${skipped} missingRouteFiles=${missing}`);
}

main().catch(e => { console.error(e); process.exit(1); });
