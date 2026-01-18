# Skigebiete Karte

## Quick Reference für Claude

> **Hinweis für neue Sessions:** Diese CLAUDE.md enthält alle wichtigen Projekt-Infos.
> Lies sie aufmerksam beim Start einer Session, bevor du Fragen stellst oder Code schreibst.

> **User-Präferenz:** Der User möchte permanente Session-Permissions (nicht jedes Mal bestätigen).

> **User-Präferenz:** Bei jedem Commit/Push soll die CLAUDE.md mit den durchgeführten Änderungen aktualisiert werden (im Abschnitt "Letzte Änderungen").

> **History-Archiv:** Wenn CLAUDE.md zu lang wird, ältere Einträge nach `CLAUDE_HISTORY.md` verschieben. Nur Kontext der letzten 1-2 Sessions hier behalten.

> **Zentrale Planungsdatei:** `IDEAS.md` (im Root, nicht im Repo) enthält Brainstorming, Feature-Ideen und Roadmap.
> Bei Session-Start lesen und als Grundlage für Priorisierung nutzen. Bei neuen Ideen oder abgeschlossenen Features aktualisieren.

> **IDEAS.md Notizblock-Session:** `01JHT56MZYD1QAXSSMFX1EB`
> Diese Session dient als Interface für IDEAS.md. Der User kann hier jederzeit Ideen, Notizen und Änderungen durchgeben.
> Zum Fortsetzen: `/resume 01JHT56MZYD1QAXSSMFX1EB`

### Multi-Device Setup (PC & Laptop)

Der User arbeitet auf zwei Geräten. Claude Code Sessions werden über Google Drive synchronisiert.

**Geräte:**
- **PC (Fisk):** `C:\Users\Fisk\Google Drive\Skigebiete Karte`
- **Laptop (Micha):** `C:\Users\Micha\Meine Ablage\Skigebiete Karte`

**Session-Sync Setup:**
Claude Code speichert Sessions nach Projekt-Pfad. Da die Pfade unterschiedlich sind, werden Junctions verwendet:

```
# Session-Ordner in Google Drive:
.claude-global/projects/
├── c--Users-Fisk-Google-Drive-Skigebiete-Karte/     ← Echter Ordner (alle Sessions)
└── c--Users-Micha-Meine-Ablage-Skigebiete-Karte/    ← Junction → zeigt auf Fisk-Ordner
```

**Wichtig:** Junctions werden von Google Drive NICHT synchronisiert! Sie müssen auf jedem Gerät separat erstellt werden.

**Falls Sessions fehlen (Junction kaputt/fehlt):**
```powershell
# Im Ordner: .claude-global\projects\
# 1. Micha-Ordner umbenennen (falls vorhanden)
Rename-Item "c--Users-Micha-Meine-Ablage-Skigebiete-Karte" "c--Users-Micha-backup"

# 2. Junction erstellen
cmd /c mklink /J c--Users-Micha-Meine-Ablage-Skigebiete-Karte c--Users-Fisk-Google-Drive-Skigebiete-Karte

# 3. Sessions aus Backup kopieren (falls vorhanden)
Copy-Item "c--Users-Micha-backup\*" "c--Users-Fisk-Google-Drive-Skigebiete-Karte\" -Force
```

### LLM-Stärke: Semantisches Matching

> **Wichtig:** Bei Mapping- und Matching-Aufgaben (z.B. Resort-Namen zwischen verschiedenen Datenquellen abgleichen) ist Claude als LLM **besser als jedes Python-Script**.
>
> Claude versteht den semantischen Kontext von Namen, Bezeichnungen und Varianten viel besser als regelbasiertes String-Matching. Beispiele:
> - "zermatt" ↔ "zermatt-matterhorn-ski-paradise"
> - "laax" ↔ "flims-laax-falera"
> - "SkiWelt / Brixen im Thale" ↔ "skiwelt-wilder-kaiser-brixental"
>
> **Workflow:** Claude erstellt Matching-Tabellen (JSON/CSV), die dann für DB-Imports oder Weiterverarbeitung genutzt werden können.

### Projekt-Überblick
Interaktive Leaflet-Karte aller Skigebiete in den Alpen (~700 Resorts).
- **Frontend:** Vanilla JS, Leaflet, keine Build-Tools (einfach `index.html` öffnen)
- **Backend:** PostgreSQL V2-Datenbank mit Resort-Stammdaten, Live-Daten, Routen
- **Hosting:** GitHub Pages (statisch), GitHub Actions für Daten-Updates

### Datenbank-Zugriff (MCP Server)

**MCP Server ist installiert!** Du kannst direkt SQL-Queries ausführen.

```
Tool: mcp__skigebiete-db__query
Schema: public
```

**Docker DB Credentials:**
```
Host:     localhost
Port:     5433
User:     ski
Password: ski
Database: skigebiete_v2

Connection String: postgresql://ski:ski@localhost:5433/skigebiete_v2
```

**Wichtige Tabellen/Views:**
- `resort` - Stammdaten (name, country, coordinates, glacier, etc.)
- `resort_stats_snapshot` - Historische Live-Daten (Schnee, Lifte, Preise)
- `resort_stats_current` - View: Neueste Snapshots pro Resort
- `v_resort_json_export` - View: JSON-Export für Frontend
- `home` - Startpunkte für Fahrzeitberechnung
- `precomputed_route` - OSRM-Routen von Homes zu Resorts
- `ski_pass`, `resort_pass` - Skipass-Verbünde (SCT, SSC, etc.)
- `resort_group`, `resort_group_member` - Skigebiets-Verbünde

### Lokale Services (Docker)
- **PostgreSQL:** `localhost:5433` (DB: skigebiete_v2, User: ski, PW: ski)
- **OSRM:** `localhost:5000` (für Routen-Berechnung, optional)

### Datenquellen zum Scrapen
- **bergfex.at** - Gute Datenqualität für AT/DE/CH Skigebiete (Schnee, Lifte, Pisten)
- **skiresort.info** - Umfangreiche internationale Daten, gute Bewertungen

### Wichtige Dateipfade
```
data/resorts.json          - Frontend-Daten (aus DB exportiert)
data/homes.json            - Startpunkte für Fahrzeiten
data/travel_times/         - Vorberechnete Fahrzeiten pro Home
data/weather/              - Wetter-Forecasts (GeoSphere, Open-Meteo)
pipeline/scripts/          - Python-Scripts für Daten-Pipeline
db/                        - SQL-Scripts und Views
js/                        - Frontend-Module
  js/config.js             - ZENTRALE CONFIG (alle Defaults, Farben, Keys)
  js/searchFilter.js       - Filter-/Such-Logik, Marker-Updates
  js/glacierIconCache.js   - Icon-Caching (Gletscher, Circle, Favorite, Visited)
  js/verbundMarkerCanvas.js - Verbund-Hexagon-Icons (gecacht)
  js/snowBadgeCanvas.js    - Schnee-Badges als Canvas-Layer
  js/i18n.js               - Internationalisierung (DE/EN)
```

### Zentrale Konfiguration (js/config.js)

> **WICHTIG für neue Features:** Alle Defaults, Farben und konfigurierbare Werte gehören in `js/config.js`!
> Keine hardcoded Werte mehr in `index.html` oder anderen JS-Dateien.

**Struktur von `window.APP_CONFIG`:**
```javascript
APP_CONFIG = {
  ORS_API_KEY: "...",           // API Keys
  map: { center, zoomDesktop, zoomMobile, defaultBasemap, defaultOverlays },
  home: { defaultId, storageKey },
  sliders: { travelTime, minElevation, minPistes, minLifts },
  weather: { enabled, dayIndex, cumulative, minSnowCm, location },
  countries: { AT, DE, CH, IT, FR, SI },  // true/false
  highlights: { favorites, visited, glacier, verbunde, sct, ssc, both },
  filters: { onlyHighlights },
  ui: { darkMode, language, filterBoxCollapsed, sliderBoxCollapsed*, weatherBoxCollapsed, bottomSheetState },
  colors: { SCT, SSC, BOTH, OTHER, AT, DE, CH, IT, FR, SI },
  darkModeFilter: "...",
  storageKeys: { language, selectedHome, favorites, visited, userSettings }
}
```

**Zugriff im Code:**
```javascript
const CFG = window.APP_CONFIG;
map.setView(CFG.map.center, CFG.map.zoomDesktop);
const color = CFG.colors.AT;
```

**Für User-Settings (Zukunft):**
```javascript
window.getSettings()       // Lädt gespeicherte Settings + merged mit Defaults
window.saveUserSettings()  // Speichert User-Settings in localStorage
```

### API Keys (in js/config.js)
- **OpenRouteService:** Für Live-Fahrzeit-Berechnung vom GPS-Standort

### Konventionen
- **Sprache:** Code-Kommentare auf Englisch, UI auf Deutsch
- **i18n:** Alle UI-Texte müssen in `js/i18n.js` sowohl für DE als auch EN übersetzt werden
- **IDs:** `stable_id` ist der eindeutige Identifier für Resorts (nicht die UUID `id`)
- **Koordinaten:** `lat/lon` im Frontend, `center_geom` (PostGIS Point) in DB

### Häufige Aufgaben

**Daten aus DB exportieren:**
```sql
-- In DBeaver oder psql:
SELECT jsonb_pretty(jsonb_agg(row_to_json(v)))
FROM v_resort_json_export v;
```

**Fahrzeiten neu berechnen:**
```bash
# 1. OSRM starten (Docker)
# 2. Routen berechnen
python pipeline/scripts/sync_homes_and_routes_to_db.py --calc-routes --osrm http://localhost:5000
# 3. Exportieren
python pipeline/scripts/export_travel_times_from_db.py
```

**Wetter-Daten aktualisieren:**
```bash
python pipeline/scripts/fetch_geosphere_forecast.py
python pipeline/scripts/fetch_openmeteo_forecast.py
```

---

# Letzte Änderungen

> **Detaillierte Logs:** Siehe `CLAUDE_HISTORY.md` für alle Session-Logs.

### Session 17.01.2026

**Weather-Box Position Fix:**
- Weather-Box z-index erhöht (1000 → 2001), damit sie über den Controls bleibt
- `.shifted` Klasse: `right: 290px` → `right: 240px`
- Dynamische Positionierung: Schwellenwert von festem Pixelwert (450px) auf tatsächliche Weather-Box Position geändert (`getBoundingClientRect().top`)
- Weather-Box verschiebt sich jetzt nur wenn Controls sie wirklich überdecken würden

**Bottom Sheet Pass-Dropdown Sync:**
- Event `pass-dropdown-populated` feuert nach Befüllen des Desktop-Dropdowns
- Bottom Sheet Dropdown wird automatisch synchronisiert

### Session 16.01.2026

**Filter-Schnittmenge (Schnee + andere Filter):**
- Export (CSV/KML) berücksichtigt jetzt Schnee-Filter korrekt
- Counter zeigt korrekte Anzahl (inkl. durch Schnee-Filter versteckte Resorts)
- `snowHiddenResorts` Set trackt vom Schnee-Filter versteckte Resorts
- `applyFilters()` re-applied Snow-Visibility nach anderen Filter-Änderungen
- Alle Filter bilden jetzt eine echte Schnittmenge

**Zentrale Konfiguration (APP_CONFIG):**
- Alle hardcoded Defaults in `js/config.js` zentralisiert
- Map Center/Zoom, Home-Defaults, Weather-State, Farben, Storage-Keys
- `getSettings()` / `saveUserSettings()` für zukünftige User-Profile
- Script-Reihenfolge: `config.js` lädt vor `i18n.js`

**Weather & UI:**
- Weather-Updates 3x täglich (07:00, 12:30, 19:00 CET)
- "Last Update" Anzeige in Weather-Box
- **Schnee-Indikator-Dots:** Farbige Punkte unter den Tag-Buttons zeigen wo ≥10cm Schnee fällt
  - Farbe = Bergfex-Skala basierend auf Maximum in den Alpen an dem Tag
  - Funktioniert in beiden Modi (Tag & Σ bis)
- **Weather Info Modal:** Ersetzt Browser-Alert durch styled Dialog (wie Fahrzeit-Info)
  - Backdrop, Close-Button, ESC-Key Support
  - Sektion für Schnee-Indikatoren hinzugefügt
- Mobile: Zoom-Buttons entfernt (Pinch-to-Zoom)
- Bottom Sheet Layer-Clicks gefixt (`.click()` statt `dispatchEvent`)

**Workflow-Fixes:**
- Weather-Workflow: Concurrency-Group von "pages" auf "weather-forecast" geändert (verhindert Blockierung)
- `git pull --rebase` vor Push hinzugefügt (verhindert Konflikte mit anderen Commits)

### Session 15.01.2026

**Mobile Redesign:**
- Google Maps-Style Bottom Sheet (Peek/Half/Full)
- Filter-Chips statt Checkboxen
- Swipe-Gesten mit Velocity-Snapping

**Layer:**
- Neue Basemaps: Topo, Grey
- Neues Overlay: Hillshade (30% Opacity)
- WaymarkedTrails.slopes für Pisten & Lifte

---

# Offene Aufgaben

### Hoch-Priorität

1. **Memory Leak untersuchen**
   - Live-Seite startet bereits mit ~2GB Memory Usage
   - Leak existierte schon vor Session 16.01 Änderungen
   - Mit Chrome DevTools Memory Profiler debuggen

2. **Datenbank-Bereinigung**
   - Spalten aus `resort_stats_snapshot` entfernen (nach Auflösung der View-Dependencies)

3. **Home-Koordinaten speichern**
   - Manuell eingegebene Koordinaten in `data/homes.json` aufnehmen

### Niedrig-Priorität

4. **OSRM Europe** (benötigt 64GB RAM)
   - 315 Resorts außerhalb Alps-Bbox haben keine Fahrzeiten

5. **Filter-UX:** Range-Slider, Reset-Button

6. **Export:** Neue Spalten in CSV/KML aufnehmen

---

# Technische Notizen

### Bekannte Gotchas

- **GeoSphere API:** Liefert `snow_acc` als **kumulative** Werte, nicht stündlich! Differenz berechnen.
- **Leaflet Layer Control:** `dispatchEvent('change')` funktioniert nicht → `input.click()` verwenden
- **resorts.json Format:** Muss flach sein, nicht verschachtelt (DBeaver exportiert mit Wrapper)
- **VPN Browser-Extensions:** Können Memory Leaks verursachen (DOM Mutation Observer)

### Datenbank-Struktur

```
resort (Haupttabelle)
├── id (UUID, PK)
├── stable_id (Text, unique)
├── name, country, region, website
├── is_glacier, center_geom
├── lifts_total, pistes_km, max_elevation_m
└── meta (JSONB)

resort_stats_snapshot (Dynamische Daten)
├── resort_id (FK)
├── provider, fetched_at
├── lifts_open, snow_cm
└── price_value, price_currency

resort_stats_current (View)
└── Neueste Einträge aus resort_stats_snapshot
```

### Frontend-Architektur

```
index.html                  - Hauptseite mit eingebettetem CSS/JS
data/resorts.json           - Statische Resort-Daten

js/config.js                - ZENTRALE CONFIG (alle Defaults)
js/searchFilter.js          - Filter-/Such-Logik, Marker-Updates
js/glacierIconCache.js      - Gecachte Icons (Canvas → DataURL → L.icon)
js/verbundMarkerCanvas.js   - Verbund-Hexagon-Icons
js/snowBadgeCanvas.js       - Schnee-Badges als Canvas-Layer
js/i18n.js                  - Internationalisierung (DE/EN)
js/gpsControl.js            - GPS-Button und Live-Fahrzeiten
js/homeRoutesSelector.js    - Home-Dropdown und Travel-Times
```

### Icon-Caching Pattern

```javascript
// NICHT: L.divIcon (Memory Leak bei wiederholten Aufrufen)
const icon = L.divIcon({ html: '...' });

// BESSER: Canvas → DataURL → L.icon (gecacht)
const canvas = document.createElement('canvas');
// ... render to canvas ...
const dataUrl = canvas.toDataURL('image/png');
const icon = L.icon({ iconUrl: dataUrl, ... });
cache[key] = icon;
```
