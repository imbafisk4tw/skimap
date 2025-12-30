# Tree Routes Integration (Reachability "Chaos"-Layer)

This ZIP contains a ready-to-drop-in integration for your current Leaflet app:
- Adds a new layer in the Layer Control: **"Tree Routes (Fahrzeit-Netz)"**
- The layer reads a static GeoJSON file:
  - `data/routes/home_muc.geojson`

## 1) Put files into your repo

- Replace your current `index.html` with the included one
- Put `js/treeRoutesOverlay.js` into `js/`
- Keep your existing `js/searchFilter.js` (included as-is)

## 2) Generate routes (one-time per home)
Recommended: run a local OSRM backend (Docker) and generate 156 routes.

Scripts included:
- `scripts/precompute_routes.js` -> creates `data/routes/home_<homeId>.geojson`
- `scripts/build_corridors.js` (optional, future) -> creates a trunk/corridor layer

Example:
```bash
npm i node-fetch@2
node scripts/precompute_routes.js --resorts data/resorts.json --homeId muc --origin 48.137,11.575 --osrm http://localhost:5000 --out data/routes/home_muc.geojson
```

## 3) How it syncs
- Time slider (percent) -> mapped to your current min/max travel times
- All other filters (SCT/SSC/Gletscher/Verbund/…) -> the overlay only shows routes for the *currently visible* resorts.

If your route GeoJSON uses different property keys, adjust in `js/treeRoutesOverlay.js`:
- name field: `props.name` / `props.resort_name`
- duration: `props.duration_min` / `props.duration_sec`
