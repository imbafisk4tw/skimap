Fahrzeit-Berechnungsprozess
1. Routen berechnen (OSRM)
Script: pipeline/scripts/precompute_routes.js

Home-Koordinaten (z.B. München) → OSRM API → GeoJSON mit Routen
Nimmt jeden Home-Standort aus data/homes.json
Berechnet Routen zu allen Resorts via OSRM (Open Source Routing Machine)
Speichert Ergebnis als data/routes/home_<homeId>.geojson
Jedes Feature enthält: duration_sec, distance_km, Geometrie der Route
2. Fahrzeiten extrahieren
Script: pipeline/scripts/build_travel_times_from_routes.js

Routes GeoJSON → Einfache JSON-Map
Liest die GeoJSONs aus data/routes/
Extrahiert duration_sec und distance_km pro Resort
Speichert als data/travel_times/home_<homeId>.json:

{
  "Arolla": { "hours": 7.16, "km": 520.3 },
  "Zermatt": { "hours": 5.2, "km": 410.1 },
  ...
}
3. Frontend lädt Fahrzeiten
Code: index.html:2061 (applyTravelTimesFromMap)
Beim Laden wird home_muc.json geladen
Fahrzeiten werden auf die Resort-Objekte geschrieben (r.travelHours)
minHours/maxHours werden berechnet für den Slider-Bereich
4. Slider filtert
Code: js/searchFilter.js:756

const inTime = (pct >= 99) || (r.travelHours == null) || (r.travelHours <= limitHours);
Datenfluss:

homes.json + resorts.json
        ↓
   precompute_routes.js (OSRM)
        ↓
   data/routes/home_muc.geojson (Routen + Zeiten)
        ↓
   build_travel_times_from_routes.js
        ↓
   data/travel_times/home_muc.json (nur Zeiten)
        ↓
   Frontend (Slider)