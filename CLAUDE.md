# Skigebiete Karte - Entwicklungsstand

## Abgeschlossene Arbeiten (Session 09.01.2026)

### 1. Default Kartenausschnitt zentriert über den Alpen

**Änderung:** Karte lädt jetzt mit Blick auf alle Skigebiete
- **Center:** [46.8, 11.0] (vorher [47.2, 12.2])
- **Zoom:** 7 (vorher 9)
- Reset-Button (X) verwendet jetzt die gleichen Werte

**Dateien:**
- `index.html` - `map.setView()` und `RESET_CENTER`/`RESET_ZOOM` Konstanten

### 2. Zoom-abhängige Marker-Skalierung

Marker werden beim Herauszoomen kleiner, damit sie nicht überlappen:

| Zoom | CircleMarker Radius | Gletscher-Icon |
|------|---------------------|----------------|
| ≥9   | 8px                 | 26px           |
| 8    | 7px                 | 22px           |
| 7    | 6px                 | 18px           |
| 6    | 5px                 | 14px           |
| <6   | 4px                 | 12px           |

**Performance-Optimierung:** Updates nur bei Größen-Schwellen-Wechsel (nicht bei jedem Zoom-Step)

**Dateien:**
- `index.html` - `getMarkerRadius()`, `getGlacierIconSize()`, `updateMarkerSizes()`

### 3. Microsoft Fluent Emoji Schneeflocke

Gletscher-Icons verwenden jetzt ein einheitliches SVG statt Emoji:
- **Vorher:** `❄` Emoji (sieht auf jedem OS anders aus)
- **Nachher:** Microsoft Fluent Emoji SVG mit Farbverlauf (#43C4F5 → #3D8DF3)

**Dateien:**
- `index.html` - `createGlacierIcon()` Funktion

### 4. Home-Dropdown zeigt Fahrtzeit-Abdeckung

Das Dropdown zeigt jetzt neben dem Status-Icon auch die Anzahl:
- Vorher: `🟢 München Zentrum`
- Nachher: `🟢 München Zentrum (299/299)`

**Dateien:**
- `js/homeRoutesSelector.js` - `rebuildOptions()` Funktion

### 5. Gletscher-Markierungen korrigiert (Schweiz)

**Problem:** 21 Schweizer Skigebiete waren als Gletscher markiert, offiziell gibt es nur 9.

**Lösung:** Nur noch offizielle Gletscherskigebiete:
1. Zermatt
2. Flims Laax Falera
3. Verbier / 4 Vallées
4. Engelberg Titlis
5. Crans-Montana
6. Corvatsch-Furtschellas
7. Saas-Fee
8. Diavolezza-Lagalb (neu hinzugefügt)
9. Glacier 3000 - Les Diablerets

**Entfernt:** Jungfrau-Schilthorn, Gstaad, St. Moritz, Belalp, Arolla, Vals, etc.

**Dateien:**
- `data/resorts.json` - `glacier` Flag korrigiert

### 6. GPS-Button Design (Mobile)

Button ist jetzt rund wie bei Google Maps:
- **Form:** Kreisförmig (border-radius: 50%)
- **Größe:** 48x48px auf Mobile
- **Icon:** Fadenkreuz im Leaflet/Google Maps Style

**Dateien:**
- `index.html` - CSS für `.gps-map-btn`
- `js/gpsControl.js` - SVG Icon

---

## Abgeschlossene Arbeiten (Session 08.01.2026)

### 1. Fix: Schweizer Skigebiete im Fahrzeit-Slider

**Problem:** ~82 Schweizer Skigebiete verschwanden beim Bewegen des Sliders, weil:
- Alle Resorts bekamen initial eine Luftlinien-Schätzung
- Die echten Fahrzeiten aus `home_muc.json` hatten nur AT/DE (156 Einträge)
- Schweizer behielten ihre hohen Schätzungen (5-6h), wurden aber vom Slider-Maximum (4.2h) abgeschnitten

**Lösung:**
- `build_travel_times_from_routes.js` neu ausgeführt → `home_muc.json` hat jetzt 299 Einträge
- `applyTravelTimesFromMap()` berücksichtigt jetzt alle Fahrzeiten für min/max

### 2. GPS-Button für Live-Fahrzeitberechnung

Neuer GPS-Button ermöglicht Fahrzeitberechnung vom aktuellen Standort:

- **Desktop:** 📍 Button neben Home-Dropdown + Input-Feld für Adresse/Koordinaten
- **Mobile:** 📍 GPS Button in home-box
- **API:** OpenRouteService Matrix-API (Key in `js/config.js`)

**Einschränkungen:**
- GPS funktioniert nur über HTTPS oder localhost
- Berechnet nur Fahrzeiten, keine Tree-Routes (wäre zu aufwändig)

**Dateien:**
- `index.html` - GPS-Buttons, Input-Feld, Event-Handler
- `js/config.js` - ORS API-Key (im Repo, da kostenloser Key)

### 3. Status-Icons im Home-Dropdown

Das Home-Dropdown zeigt jetzt den Status der vorberechneten Fahrzeiten:

- 🟢 = ≥95% der Resorts haben Fahrzeiten
- 🟠 = <95% der Resorts haben Fahrzeiten
- ⚪ = Keine travel_times Datei vorhanden

**Dateien:**
- `js/homeRoutesSelector.js` - Status-Prüfung und Icon-Anzeige

### 4. Fahrzeit-Berechnungsprozess (Dokumentation)

```
homes.json + resorts.json
        ↓
   precompute_routes.js (OSRM)
        ↓
   data/routes/home_<id>.geojson (Routen + Zeiten)
        ↓
   build_travel_times_from_routes.js
        ↓
   data/travel_times/home_<id>.json (nur Zeiten)
        ↓
   Frontend (Slider)
```

---

## Abgeschlossene Arbeiten (Session 31.12.2024)

### 1. Datenbank-Migration: Statische Spalten in `resort`-Tabelle

Die statischen Resort-Daten wurden von `resort_stats_snapshot` in die `resort`-Tabelle migriert:

- `lifts_total` - Gesamtzahl Lifte
- `pistes_km` - Pistenkilometer
- `max_elevation_m` - Maximale Höhe in Metern

**Dateien:**
- `db/scripts/migrate_static_columns.sql` - Migrations-Script

**Hinweis:** Die Spalten existieren noch in `resort_stats_snapshot` (View-Dependencies blockieren das Löschen). Bereinigung steht noch aus.

### 2. JSON-Export View

Neuer View `v_resort_json_export` für den JSON-Export, kompatibel mit der bestehenden Frontend-Struktur.

**Dateien:**
- `db/scripts/v_resort_json_export.sql` - View-Definition + Export-Befehle

**Export-Befehl (psql):**
```sql
\t on
\pset format unaligned
\o resorts.json
SELECT jsonb_pretty(jsonb_agg(resort_json)) FROM v_resort_json_export;
\o
\t off
```

### 3. Neue Filter-Slider (in Arbeit)

Drei neue Minimum-Filter als Slider hinzugefügt:

- **Min. Pistenkilometer** - Filtert nach Mindest-Pistenkilometern
- **Min. Lifte** - Filtert nach Mindestanzahl Lifte
- **Min. Höhe** - Filtert nach Mindesthöhe

**Geänderte Dateien:**
- `index.html` - HTML für Slider + CSS + Daten-Parsing
- `js/searchFilter.js` - Filter-Logik erweitert

**Neue JSON-Felder in `data/resorts.json`:**
```json
{
  "liftsTotal": 52,
  "pistesKm": 146.00,
  "maxElevation": 3340
}
```

---

## Offene Aufgaben

### Hoch-Priorität

1. **Datenbank-Bereinigung**
   - Spalten aus `resort_stats_snapshot` entfernen (nach Auflösung der View-Dependencies)
   - Views neu erstellen ohne die statischen Spalten

2. **Home-Koordinaten speichern (Feature in Planung)**
   - Manuell eingegebene Koordinaten in `data/homes.json` aufnehmen
   - Optionen: Copy-to-Clipboard, Download, localStorage

### Niedrig-Priorität

3. **Filter-UX-Verbesserungen** (optional)
   - Range-Slider (Min-Max) statt nur Minimum
   - Filter-Reset-Button
   - Werte im Popup anzeigen

4. **Export erweitern**
   - Neue Spalten in CSV/KML-Export aufnehmen

5. **Tree-Routes von beliebigem Standort**
   - Aktuell nur Fahrzeiten via ORS Matrix-API
   - Tree-Routes bräuchten OSRM-Server (299 einzelne Requests)

---

## Technische Notizen

### Datenbank-Struktur

```
resort (Haupttabelle)
├── id (UUID, PK)
├── stable_id (Text, unique)
├── name, country, region, website
├── is_glacier, center_geom
├── lifts_total (NEU)
├── pistes_km (NEU)
├── max_elevation_m (NEU)
└── meta (JSONB)

resort_stats_snapshot (Dynamische Daten)
├── resort_id (FK)
├── provider, fetched_at
├── lifts_open, snow_cm
├── price_value, price_currency
└── [lifts_total, pistes_km, max_elevation_m - noch nicht entfernt]

resort_stats_current (View)
└── Neueste Einträge aus resort_stats_snapshot
```

### MCP Server

- Read-only Zugriff auf die PostgreSQL-Datenbank
- Tool: `mcp__skigebiete-db__query`

### Frontend-Architektur

- `data/resorts.json` - Statische Resort-Daten
- `js/searchFilter.js` - Filter- und Suchlogik
- `index.html` - Hauptseite mit eingebettetem CSS/JS
