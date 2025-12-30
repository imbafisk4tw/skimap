/* scripts/precompute_routes.js
 * Generate GeoJSON routes from a home location to all resorts using OSRM.
 *
 * NEW (Home profiles):
 *  - Provide a homes JSON file (default: data/homes.json if it exists)
 *  - Select a home profile by --homeId
 *  - Optionally list available homes via --listHomes
 *
 * Usage examples:
 *   # Use home profile (recommended)
 *   node scripts/precompute_routes.js --resorts data/resorts.json --homes data/homes.json --homeId muc \
 *     --osrm http://localhost:5000 --out data/routes/home_muc.geojson --concurrency 6
 *
 *   # Override origin ad-hoc (takes precedence over homes.json)
 *   node scripts/precompute_routes.js --resorts data/resorts.json --homeId muc --origin 48.137,11.575 \
 *     --osrm http://localhost:5000 --out data/routes/home_muc.geojson
 *
 *   # List homes inside homes.json
 *   node scripts/precompute_routes.js --homes data/homes.json --listHomes
 *
 * Expects resorts.json items to include: { id, name, lat, lon }.
 * Output route properties include { home_id, resort_id, name, duration_min, duration_sec, distance_km }.
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

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function validateLatLon(lat, lon, ctx = "home") {
  if (!isFinite(lat) || !isFinite(lon)) throw new Error(`${ctx}: lat/lon not numeric`);
  if (lat < -90 || lat > 90) throw new Error(`${ctx}: lat out of range (-90..90): ${lat}`);
  if (lon < -180 || lon > 180) throw new Error(`${ctx}: lon out of range (-180..180): ${lon}`);
}

function parseOriginStr(s) {
  const parts = String(s).split(",");
  if (parts.length !== 2) throw new Error("Invalid --origin. Use 'lat,lon'.");
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  validateLatLon(lat, lon, "--origin");
  return { lat, lon };
}

function loadHomes(homesPath) {
  const homes = readJson(homesPath);
  if (!homes || typeof homes !== "object" || Array.isArray(homes)) {
    throw new Error(`homes file must be an object map, e.g. { "muc": { "lat": 48.1, "lon": 11.5 } }`);
  }
  // validate each entry lightly
  for (const [id, h] of Object.entries(homes)) {
    if (!h || typeof h !== "object") throw new Error(`homes[${id}] must be an object`);
    const lat = Number(h.lat);
    const lon = Number(h.lon);
    validateLatLon(lat, lon, `homes[${id}]`);
  }
  return homes;
}

function formatHomesList(homes) {
  const ids = Object.keys(homes).sort();
  if (ids.length === 0) return "(no homes found)";
  return ids.map(id => {
    const h = homes[id];
    const name = h.name ? ` (${h.name})` : "";
    return `- ${id}${name}: ${h.lat},${h.lon}`;
  }).join("\n");
}

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
  const osrmBase = (args.osrm || "http://localhost:5000").replace(/\/$/, "");
  const outPath = args.out || `data/routes/home_${homeId}.geojson`;
  const concurrency = Number(args.concurrency || 6);

  // homes file: default to data/homes.json *if it exists*, otherwise disabled unless explicitly passed
  const homesPathArg = typeof args.homes === "string" ? args.homes : null;
  const defaultHomesPath = "data/homes.json";
  const homesPath = homesPathArg || (fileExists(defaultHomesPath) ? defaultHomesPath : null);

  // list homes and exit
  if (args.listHomes) {
    if (!homesPath) {
      console.error("No homes file found. Provide --homes data/homes.json (or create data/homes.json).");
      process.exit(1);
    }
    const homes = loadHomes(homesPath);
    console.log(`Homes in ${homesPath}:\n${formatHomesList(homes)}`);
    process.exit(0);
  }

  // Determine origin:
  let originLat, originLon;

  if (args.origin) {
    const o = parseOriginStr(args.origin);
    originLat = o.lat;
    originLon = o.lon;
  } else if (homesPath) {
    const homes = loadHomes(homesPath);
    const h = homes[homeId];
    if (!h) {
      console.error(`Home '${homeId}' not found in ${homesPath}.`);
      console.error(`Available homes:\n${formatHomesList(homes)}`);
      process.exit(1);
    }
    originLat = Number(h.lat);
    originLon = Number(h.lon);
  } else {
    // backward-compatible fallback (your previous default)
    const o = parseOriginStr("48.137,11.575");
    originLat = o.lat;
    originLon = o.lon;
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
