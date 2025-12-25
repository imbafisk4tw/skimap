/* scripts/precompute_routes.js
 * Generate GeoJSON routes from a home location to all resorts using OSRM.
 *
 * Usage (example):
 *   node scripts/precompute_routes.js --resorts data/resorts.json --homeId muc --origin 48.137,11.575 \
 *     --osrm http://localhost:5000 --out data/routes/home_muc.geojson --concurrency 6
 *
 * Expects resorts.json items to include: { id, name, lat, lon }.
 * Output route properties include { name, resort_id, duration_min, duration_sec, distance_km }.
 */

const fs = require("fs");
const path = require("path");

let fetchFn;
try { fetchFn = fetch; } catch { fetchFn = require("node-fetch"); }

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[k] = v;
  }
  return args;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function asyncPool(limit, items, iterator) {
  const ret = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => iterator(item));
    ret.push(p);
    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(ret);
}

async function main() {
  const args = parseArgs(process.argv);
  const resortsPath = args.resorts || "data/resorts.json";
  const homeId = args.homeId || "home";
  const origin = args.origin || "48.137,11.575"; // lat,lon
  const osrmBase = (args.osrm || "http://localhost:5000").replace(/\/$/, "");
  const outPath = args.out || `data/routes/home_${homeId}.geojson`;
  const concurrency = Number(args.concurrency || 6);

  const [originLat, originLon] = origin.split(",").map(Number);
  if (!isFinite(originLat) || !isFinite(originLon)) {
    console.error("Invalid --origin. Use 'lat,lon'.");
    process.exit(1);
  }

  const resorts = readJson(resortsPath);
  ensureDir(path.dirname(outPath));

  const feats = [];
  let ok = 0, fail = 0;

  async function fetchRoute(r) {
    const from = `${originLon},${originLat}`;
    const to = `${r.lon},${r.lat}`;
    const url = `${osrmBase}/route/v1/driving/${from};${to}?overview=simplified&geometries=geojson&steps=false`;
    let last = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const resp = await fetchFn(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        return json;
      } catch (e) {
        last = e;
        await sleep(350 * attempt);
      }
    }
    throw last;
  }

  await asyncPool(concurrency, resorts, async (r) => {
    try {
      const data = await fetchRoute(r);
      const route = data.routes && data.routes[0];
      if (!route || !route.geometry) throw new Error("No route geometry");
      feats.push({
        type: "Feature",
        geometry: route.geometry,
        properties: {
          home_id: homeId,
          resort_id: r.id || r.slug || r.name,
          name: r.name,
          duration_sec: route.duration,
          duration_min: Math.round((route.duration / 60) * 10) / 10,
          distance_km: Math.round((route.distance / 1000) * 10) / 10
        }
      });
      ok++;
      if (ok % 20 === 0) console.log(`... ${ok}/${resorts.length} ok`);
    } catch (e) {
      fail++;
      console.warn(`Route failed: ${r.name}: ${e.message}`);
    }
  });

  fs.writeFileSync(outPath, JSON.stringify({ type: "FeatureCollection", features: feats }));
  console.log(`Done. ok=${ok} fail=${fail} -> ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
