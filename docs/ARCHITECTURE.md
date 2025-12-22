# Skimap – Architecture

## Overview
This repo is a static GitHub Pages project (no backend). The app renders a Leaflet map and loads resort and travel-time data from JSON files.

## Key files
- `index.html`
  - Loads Leaflet, initializes the map, and wires UI controls.
  - Includes / references `searchFilter.js`.
- `searchFilter.js`
  - Contains filtering, searching, layer toggles, and export UI logic.
  - Must remain compatible with the JSON data formats in `resorts.json` and `travel_times.json`.
- `resorts.json`
  - Primary data source for ski resorts (markers + metadata).
- `travel_times.json`
  - Cache of previously computed travel times (optional data file for quick loading).

## Data flow
1. `index.html` loads the page and initializes Leaflet.
2. `resorts.json` is fetched and parsed.
3. Markers are created from `resorts.json`.
4. Search + filters operate on the in-memory resort list and update marker visibility.
5. Optional: travel times are read/written via `travel_times.json` and/or browser cache.

## Design constraints
- Keep the app fully static and GitHub Pages compatible.
- Avoid introducing build steps unless explicitly requested.
- Prefer small, incremental changes across files.
- Do not change UI layout unless the task explicitly asks for it.

## Common pitfalls
- Breaking JSON format (missing commas, invalid trailing commas).
- Changing data field names without updating `searchFilter.js`.
- Forgetting to keep layer toggles in sync with filtering logic.
- Silent fetch failures: ensure fetch paths are correct (GitHub Pages base path!).

## Base path on GitHub Pages
When hosted on GitHub Pages, relative paths should be used carefully:
- Prefer `./resorts.json` instead of `/resorts.json` to avoid repo-name base-path issues.
