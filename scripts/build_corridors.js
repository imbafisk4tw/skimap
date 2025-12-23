/* scripts/build_corridors.js
 * Build "corridor/trunk" layer by counting overlapped segments using a grid.
 *
 * Usage:
 *   node scripts/build_corridors.js --routes data/routes/home_muc.geojson --out data/corridors/home_muc.geojson \
 *     --step 500 --grid 800 --minCount 3
 */

const fs = require("fs");
const path = require("path");

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

// Haversine distance in meters
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function lerpCoord(a, b, t) {
  return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t];
}

function resampleLine(coords, stepM) {
  if (!coords || coords.length < 2) return coords || [];
  const out = [coords[0]];
  let carry = 0;
  for (let i=0;i<coords.length-1;i++){
    const a = coords[i], b = coords[i+1];
    const segLen = haversineMeters(a[1],a[0],b[1],b[0]);
    if (segLen === 0) continue;
    let dist = carry;
    while (dist + stepM <= segLen) {
      dist += stepM;
      out.push(lerpCoord(a,b,dist/segLen));
    }
    carry = segLen - dist;
  }
  const last = coords[coords.length-1];
  const lastOut = out[out.length-1];
  if (!lastOut || lastOut[0]!==last[0] || lastOut[1]!==last[1]) out.push(last);
  return out;
}

// WebMercator
const Rm = 6378137;
const mercX = lon => (lon*Math.PI*Rm)/180;
const mercY = lat => Rm * Math.log(Math.tan(Math.PI/4 + (lat*Math.PI/180)/2));
const invLon = x => (x/Rm)*(180/Math.PI);
const invLat = y => (2*Math.atan(Math.exp(y/Rm)) - Math.PI/2)*(180/Math.PI);

function cellId(lon,lat,gridM){
  const x=mercX(lon), y=mercY(lat);
  return { cx: Math.floor(x/gridM), cy: Math.floor(y/gridM) };
}
function cellCenter(cx,cy,gridM){
  const x=(cx+0.5)*gridM, y=(cy+0.5)*gridM;
  return [invLon(x), invLat(y)];
}
function undirectedKey(a,b){
  const k1=`${a.cx},${a.cy}`, k2=`${b.cx},${b.cy}`;
  return k1<k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

function main(){
  const args=parseArgs(process.argv);
  const routesPath=args.routes;
  const outPath=args.out;
  const stepM=Number(args.step||500);
  const gridM=Number(args.grid||800);
  const minCount=Number(args.minCount||3);
  if(!routesPath||!outPath){
    console.error("Usage: --routes <path> --out <path> [--step 500] [--grid 800] [--minCount 3]");
    process.exit(1);
  }
  const fc=readJson(routesPath);
  const counts=new Map();
  for(const f of (fc.features||[])){
    if(!f.geometry||f.geometry.type!=="LineString") continue;
    const sampled=resampleLine(f.geometry.coordinates, stepM);
    for(let i=0;i<sampled.length-1;i++){
      const a=sampled[i], b=sampled[i+1];
      const ca=cellId(a[0],a[1],gridM), cb=cellId(b[0],b[1],gridM);
      if(ca.cx===cb.cx && ca.cy===cb.cy) continue;
      const key=undirectedKey(ca,cb);
      counts.set(key,(counts.get(key)||0)+1);
    }
  }
  const feats=[];
  let max=0;
  for(const [key,count] of counts.entries()){
    if(count<minCount) continue;
    max=Math.max(max,count);
    const [aStr,bStr]=key.split("|");
    const [ax,ay]=aStr.split(",").map(Number);
    const [bx,by]=bStr.split(",").map(Number);
    feats.push({
      type:"Feature",
      geometry:{ type:"LineString", coordinates:[cellCenter(ax,ay,gridM), cellCenter(bx,by,gridM)] },
      properties:{ count, grid_m:gridM }
    });
  }
  feats.sort((a,b)=>b.properties.count-a.properties.count);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify({
    type:"FeatureCollection",
    properties:{ source_routes:path.basename(routesPath), step_m:stepM, grid_m:gridM, min_count:minCount, max_count:max },
    features:feats
  }));
  console.log(`Corridors: ${feats.length} -> ${outPath} (max_count=${max})`);
}
main();
