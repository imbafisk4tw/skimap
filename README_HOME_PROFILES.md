# Home profiles for precompute_routes.js

This patch adds a `data/homes.json` file and teaches `scripts/precompute_routes.js` to read origins from it.

## Files
- `data/homes.json` – store multiple home locations by id
- `scripts/precompute_routes.js` – updated script supporting `--homes` and `--listHomes`

## Usage

### 1) List homes
```bash
node scripts/precompute_routes.js --homes data/homes.json --listHomes
```

### 2) Generate routes for a homeId (recommended)
```bash
node scripts/precompute_routes.js --resorts data/resorts.json --homes data/homes.json --homeId muc \
  --osrm http://localhost:5000 --out data/routes/home_muc.geojson --concurrency 6
```

### 3) Override on the fly (origin has priority over homes.json)
```bash
node scripts/precompute_routes.js --homeId muc --homes data/homes.json --origin 48.15,11.60
```

## Notes
- If `data/homes.json` exists, it will be used automatically even if you omit `--homes`.
- If you omit both `--origin` and `homes.json`, the legacy default `48.137,11.575` is used.
