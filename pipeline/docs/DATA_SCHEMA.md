# Data schema

This repo uses two JSON files as primary data sources:
- `resorts.json` (resort objects)
- `travel_times.json` (cached travel times)

If you change the schema, you MUST update `searchFilter.js` accordingly.

---

## resorts.json

### Recommended shape
`resorts.json` should be a JSON array:

```json
[
  {
    "id": "skiwelt_scheffau",
    "name": "SkiWelt Scheffau",
    "lat": 47.529,
    "lon": 12.247,
    "ssc": true,
    "website": "https://...",
    "verbund": { "id": "skiwelt", "name": "SkiWelt Wilder Kaiser – Brixental" },
    "entrypoint": { "id": "scheffau", "name": "Scheffau" }
  }
]
