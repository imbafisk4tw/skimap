# Skigebiete Karte - History

> **Archivierte Änderungen** aus CLAUDE.md. Für aktuelle Infos siehe CLAUDE.md.

---

## Abgeschlossene Arbeiten (Session 16.01.2026 - Abend)

### Memory Leak Investigation & Fixes

**Problem:** Extrem hoher Memory-Verbrauch (~1 GB+) im Browser.

**Untersuchte Verdächtige (NICHT die Ursache):**
- Weather/Snow Display (Canvas-basiert, korrekt implementiert)
- Corridor Overlay (20.221 Features, aber kein Leak)
- Forecast JSONs (23 MB total, aber kein Leak)
- DOM Nodes (2.686 - normal)
- Leaflet Layers (644 - stabil, keine Akkumulation)

**Durchgeführte Tests:**
```
Inkognito-Modus:     211 MB  ✓ Normal
Mit Extensions:      879 MB  ✗ Zu hoch
Ohne Extensions:    1173 MB  ✗ Noch höher
Nach Cache leeren:  1800 MB  ✗ Schlimmer
Nach Browser-Neustart: 248 MB ✓ Normal
```

**Tatsächliche Ursache:** Browser brauchte kompletten Neustart. Möglicherweise zusammenhängend mit XMP-RAM-Übertaktung (2100→3300 MHz) die am gleichen Tag aktiviert wurde.

**Präventive Code-Fixes (Best Practices, trotzdem committed):**

1. **MutationObserver Cleanup** - Observer werden jetzt gespeichert und bei erneutem Aufruf disconnected:
```javascript
let counterObserver = null;
function syncCounter() {
  if (counterObserver) counterObserver.disconnect();
  counterObserver = new MutationObserver(...);
}
```

2. **Event Delegation für Bottom Sheet** - Statt bei jedem `updateFilterChips()` neue Listener zu erstellen:
```javascript
// VORHER (Memory Leak bei wiederholten Aufrufen):
function updateFilterChips() {
  container.innerHTML = '...';
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', ...); // Neue Listener bei JEDEM Aufruf!
  });
}

// NACHHER (Event Delegation - Listener nur EINMAL):
function setupEventDelegation() {
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.bs-chip');
    if (!chip) return;
    // Handle click
  });
}
function updateFilterChips() {
  container.innerHTML = '...';
  // Keine Listener hier
}
```

3. **Betroffene Funktionen refactored:**
   - `updateFilterChips()` - Peek-State Chips
   - `populateFilters()` - Full-State Filter-Chips
   - `populateLayers()` - Layer-Chips
   - `syncHomeSelector()` - Home-Dropdown Observer

**Erkenntnisse:**
- `performance.memory.usedJSHeapSize` ist nützlich für Memory-Debugging
- Inkognito-Modus ist guter Baseline-Test (keine Extensions, frischer State)
- Browser-Neustart kann Memory-Probleme lösen die nicht im Code liegen
- XMP/RAM-Übertaktung kann zu schwer debuggenden Problemen führen

---

## Abgeschlossene Arbeiten (Session 16.01.2026)

### 1. Schnee-Indikator-Dots auf Tag-Buttons

**Feature:** Farbige Punkte unter den Tag-Buttons (Heu, +1, +2, ...) zeigen auf einen Blick, an welchen Tagen es irgendwo in den Alpen signifikant schneit.

**Implementierung:**
- Dot wird angezeigt wenn ≥10cm Schnee irgendwo in den Alpen fällt
- Farbe = Bergfex-Skala basierend auf dem Maximum an dem Tag
- Funktioniert in beiden Modi (Tag & Σ bis) - gleiche Logik
- Dezenter grauer Rand (`box-shadow: 0 0 0 1px rgba(0,0,0,0.25)`)

**CSS:**
```css
.weather-box .day-btn .snow-dot {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
}
.weather-box .day-btn .snow-dot.visible {
  opacity: 1;
}
```

**JavaScript:** `updateDayButtonSnowDots()` - iteriert über alle Open-Meteo Forecasts und findet Maximum.

### 2. Weather Info Modal Dialog

**Vorher:** Browser `alert()` mit Text
**Nachher:** Styled Modal Dialog (wie Fahrzeit-Info)

**Features:**
- Backdrop mit 40% Opacity
- Close-Button (×) oben rechts
- ESC-Key Support
- Sektionen: Auswahl, Modus, Schnee-Indikatoren, Slider, Datenquelle, Auto-Updates

**CSS-Klassen:** `.weather-info-backdrop`, `.weather-info-dialog`

### 3. Weather Workflow Fixes

**Problem 1:** Workflow lief nur 15 Sekunden statt 23 Minuten
- **Ursache:** `concurrency: group: "pages"` wurde von pages-build-deployment blockiert
- **Lösung:** Eigene Gruppe `"weather-forecast"`

**Problem 2:** Push schlug fehl wenn während Workflow andere Commits kamen
- **Lösung:** `git pull --rebase origin main || true` vor Push

**Problem 3:** resorts.json hatte falsches Format (verschachteltes DBeaver-Export)
- **Lösung:** Korrektes Format aus lokalem File committed

### 4. "Last Update" Anzeige in Weather-Box

Zeigt relative Zeit seit letztem Wetter-Update:
- "gerade eben" / "just now" (< 5 min)
- "vor X Min" / "X min ago"
- "vor X Std" / "X hrs ago"
- "vor X Tagen" / "X days ago"

Funktion: `updateWeatherLastUpdate()` - liest `generated_at` aus Open-Meteo JSON.

### 5. searchFilter.js: Resorts ohne Fahrzeiten verstecken

Bei Slider < 100% werden Resorts ohne Fahrzeiten automatisch ausgeblendet (bisher graue Marker).

**Dateien geändert:**
- `index.html` - CSS, HTML, JS für Dots + Modal + Last Update
- `js/i18n.js` - Neue Keys: `snowIndicator`, `weatherInfoDots`, `lastUpdate`, `justNow`
- `js/searchFilter.js` - Filter-Logik für Resorts ohne Travel Times
- `.github/workflows/fetch-weather-forecast.yml` - Concurrency + Pull/Rebase
- `data/resorts.json` - Korrektes Format

---

## Abgeschlossene Arbeiten (Session 15.01.2026)

### 1. Mobile Redesign: Google Maps-Style Bottom Sheet

Komplettes Redesign der mobilen UI nach Google Maps Vorbild:

**Neues Bottom Sheet (ersetzt Side-Panel):**
- 3 Zustände: Peek (72px), Half (50vh), Full (90vh)
- Swipe-Gesten auf Handle-Area (kein Konflikt mit Karten-Pan)
- Velocity-basiertes Snapping für natürliches Wischgefühl
- CSS Custom Properties für einfache Anpassung

**Filter-Chips statt Checkboxen:**
- Horizontale Chip-Reihe im Peek-State (Länder-Filter)
- Alle Filter als Chips im Full-State (Highlight, Pässe, Sonstige)
- Touch-optimiert, aktive Chips hervorgehoben

**Layer-Auswahl als Chips:**
- Basemap-Chips (Radio-Verhalten: nur einer aktiv)
- Overlay-Chips (Checkbox-Verhalten: mehrere möglich)

**Sprachschalter im Bottom Sheet:**
- SVG-Flaggen (🇩🇪/🇬🇧) statt Text
- Settings-Sektion im Full-State
- Aktualisiert Chips und Labels bei Sprachwechsel

**Versteckte Elemente auf Mobile (<720px):**
- Altes Side-Panel + Hamburger-Button
- Slider-Box (Fahrzeit im Bottom Sheet)
- Counter + Sprachschalter in Suchbox

**CSS (~450 Zeilen):**
```css
:root {
  --bs-peek-height: 72px;
  --bs-half-height: 50vh;
  --bs-full-height: 90vh;
}
#bottom-sheet[data-state="peek"] { transform: translateY(...); }
```

**JavaScript (~800 Zeilen):**
- Swipe-Handler mit Touch + Mouse Support
- Bidirektionale Sync zwischen Bottom Sheet und Original-Controls
- Media Query Listener für dynamisches Init (DevTools Testing)

### 2. Neue Basemap-Layer

Erweiterte Layer-Auswahl (Desktop + Mobile):

| Layer | Typ | Quelle |
|-------|-----|--------|
| OSM | Basemap | OpenStreetMap (Default) |
| Satellit | Basemap | Esri World Imagery |
| Clean | Basemap | Stadia Alidade Smooth |
| Terrain | Basemap | Stadia Stamen Terrain |
| **Topo** | Basemap | Esri World Topo Map (NEU) |
| **Grey** | Basemap | TopPlusOpen Grau (NEU) |
| Pisten & Lifte | Overlay | WaymarkedTrails |
| **Hillshade** | Overlay | ArcGIS Elevation (NEU, 30% Opacity) |

**Hillshade:** Kombinierbar mit jeder Basemap für 3D-Tiefeneffekt.

### 3. Slider-Box Design Update (Desktop)

Angepasst an Weather-Box Design:
- `border: none` statt `1px solid #888`
- `border-radius: 8px` statt `4px`
- `background: rgba(255,255,255,0.96)`
- `box-shadow: 0 2px 8px rgba(0,0,0,0.15)`
- `padding: 10px 14px`

### 4. IDEAS.md - Zentrale Planungsdatei

Neues lokales Dokument für Brainstorming, Feature-Ideen und Roadmap:

- **IDEAS.md** im Root erstellt (nicht im Repo, in .gitignore)
- Strukturierte Sektionen: Prioritäten, Brainstorming, UI/UX, Technisch, Daten, Karten, Personalisierung, Gamification, Business
- Bei Session-Start lesen und als Grundlage für Priorisierung nutzen

### 5. WaymarkedTrails.slopes Overlay

Ersetzt PMTiles + Alpe d'Huez Overpass Hack durch einfaches Tile-Overlay:

**Features:**
- OSM-basiert, zeigt Pisten (farbcodiert), Lifte, Loipen, Rodelbahnen
- Deckt alle Alpen ab (AT, CH, DE, FR, IT, SI)
- Kein eigenes Tile-Hosting nötig

**Dateien:**
- `index.html` - ~1400 Zeilen geändert (CSS, HTML, JS für Bottom Sheet + Layer)
- `js/i18n.js` - `settings` Key hinzugefügt

---

## Abgeschlossene Arbeiten (Session 14.01.2026)

### 1. Suchfeld-Verbesserungen

**Breiteres Suchfeld:**
- Search-box von 390px auf 550px verbreitert (Desktop)
- Input min-width auf 200px erhöht

**Länderkürzel in Suchergebnissen:**
- Format: `Adelboden – 5h 42m – CH` (vorher ohne Länderkürzel)
- Zeigt Land hinter Fahrzeit mit Trennstrich

**SVG-Flaggen für Sprachschalter:**
- Ersetzt Text (EN/DE) durch echte SVG-Flaggen
- 🇬🇧 Union Jack wenn Deutsch aktiv → Englisch
- 🇩🇪 Schwarz-Rot-Gold wenn Englisch aktiv → Deutsch
- Flaggen sind inline-SVG (keine externen Assets)

**Sprachschalter vertikal zentriert:**
- `align-items: center` statt `stretch` in `.search-row`

**Dateien:**
- `index.html` - CSS, HTML, JS für Flaggen
- `js/searchFilter.js` - `fillDatalistForResorts()` mit Länderkürzel

### 2. Berg/Tal-Wetter-Prognosen

**Open-Meteo Script erweitert:**
- Zwei Durchläufe: Berg (maxElevation) + Tal (minElevation)
- Neues Datenformat mit `mountain` und `valley` Objekten
- Rückwärtskompatibel mit altem Format

**Neues Datenformat:**
```json
{
  "stable_id": {
    "name": "Savognin",
    "mountain": { "elevation_m": 2713, "snow_3d_cm": 15, "daily": [...] },
    "valley": { "elevation_m": 1168, "snow_7d_cm": 5, "daily": [...] }
  }
}
```

**Frontend:**
- Weather-Box zeigt immer Berg-Wetter (kein Toggle dort)
- Berg/Tal-Auswahl nur im Popup

**Popup 16-Tage-Prognose:**
- Toggle-Buttons für Berg/Tal mit Höhenangabe
- Separate Tabellen je nach Auswahl
- Berg standardmäßig aktiv

**Schneefallgrenze (separate Zeile im Popup):**
- Eigene Zeile unter "Höhe" (nicht inline)
- Format: `Schneefallgrenze: 1500m (Nur am Berg)`
- Farbcodierte Status-Texte:
  - 🟢 Grün: "Schnee überall" (unter Talhöhe)
  - 🟠 Orange: "Nur am Berg" (zwischen Tal und Berg)
  - 🔴 Rot: "Kein Schnee" (über Berghöhe)

**i18n:**
- Neue Keys: `elevation`, `mountain`, `valley`, `best`, `snowLimit`, `snowEverywhere`, `snowOnlyTop`, `noSnow`

**Datenlage (Höhendaten):**
- 84% der Resorts haben `maxElevation` (Berg)
- 48% der Resorts haben `minElevation` (Tal)
- Bei fehlenden Daten: Open-Meteo nutzt API-Default (Terrain-Modell)

**Dateien:**
- `pipeline/scripts/fetch_openmeteo_forecast.py` - Berg/Tal-Abfragen
- `index.html` - UI und Event-Handler
- `js/i18n.js` - Übersetzungen
- `.github/workflows/fetch-weather-forecast.yml` - Kommentar aktualisiert

---

## Abgeschlossene Arbeiten (Session 13.01.2026 - Spät)

### 1. Verbund-Icons: Kleinere Größen + i18n

**Größen reduziert** (um 4px pro Zoom-Stufe, verhindert Überlappung):

| Zoom | Vorher | Nachher |
|------|--------|---------|
| ≥10  | 32px   | 28px    |
| 9    | 28px   | 24px    |
| 8    | 24px   | 20px    |
| 7    | 20px   | 16px    |
| 6    | 16px   | 14px    |
| <6   | 14px   | 12px    |

**i18n-Unterstützung:** Marker zeigt "V" (Verbund) auf Deutsch, "G" (Group) auf Englisch.

---

## Abgeschlossene Arbeiten (Session 13.01.2026 - Abend)

### 1. Icon-Caching System für Memory Leak Prevention

Neue Module für gecachte Canvas-Icons statt DOM-basierter `L.divIcon`:

**Problem:** `L.divIcon` erstellt bei jedem Aufruf neue DOM-Elemente → Memory Leak bei Filter-Änderungen.

**Lösung:** Icons werden einmal auf Canvas gerendert → DataURL → `L.icon` (gecacht).

**Neue Dateien:**
- `js/glacierIconCache.js` - Gletscher (Schneeflocke), Circle, Favorite (★), Visited (✓)
- `js/verbundMarkerCanvas.js` - Verbund-Hexagone (V/G je nach Sprache)
- `js/snowBadgeCanvas.js` - Schnee-Badges als Canvas-Layer

**API:**
```javascript
// Glacier/Circle/Favorite/Visited Icons
GlacierIconCache.getGlacierIcon(color, size)
GlacierIconCache.getCircleIcon(color, size)
GlacierIconCache.getFavoriteIcon(size)
GlacierIconCache.getVisitedIcon(size)

// Verbund-Hexagone
VerbundIconCache.getIconForZoom(zoom)
VerbundIconCache.warmCache()

// Cache-Stats für Debugging
GlacierIconCache.getCacheStats()
```

### 2. Performance-Optimierung: updateMarkerColors O(n²) → O(n)

**Vorher:** `Object.values(resorts).find(r => r.name === resortName)` für jeden Gletscher-Marker → O(n²)

**Nachher:** Resort-Lookup einmal vorberechnet + Skip bei unveränderter Farbe.

**Datei:** `js/searchFilter.js:570-600`

### 3. Weather-Box Position: Alle Control-Boxen berücksichtigt

`updateWeatherBoxPosition()` berechnet Gesamthöhe aller Control-Boxen und verschiebt Weather-Box wenn nötig.

### 4. Hinweis: Browser-Extensions und Memory Leaks

**Erkenntnis:** VPN-Extensions (z.B. PureVPN) können massive Memory Leaks verursachen.

**Empfehlung:** VPN als System-App statt Browser-Extension nutzen.

---

## Abgeschlossene Arbeiten (Session 13.01.2026 - Nachmittag)

### 1. Filter-Box Reorganisation mit Pässe-Sektion

**Neue Struktur:**
- **Länder** - AT, DE, CH, IT, FR, SI
- **Highlight** - Favoriten, Besucht, Gletscher, Verbünde
- **Pässe** - Snow Card Tirol, SuperSkiCard, Beide, Dropdown
- **Sonstige** - Nur Highlights, Dark Mode

### 2. Pässe-Akkordion in Popups

Resort-Popup zeigt alle Pässe als farbige Badges mit Akkordion.

### 3. Pässe-Dropdown mit Länder-Gruppierung

Pässe werden per `<optgroup>` nach Land gruppiert.

### 4. Weather-Box Auto-Verschiebung

Weather-Box verschiebt sich automatisch nach links wenn Filter-Box ausgeklappt ist.

---

## Abgeschlossene Arbeiten (Session 13.01.2026 - Vormittag)

### 1. Wetter-UI: Tagesbasierte Auswahl mit Kumulativ-Modus

- Tages-Buttons (Heute, +1, +2, ... +15) mit Modus-Toggle
- "Tag" (einzelner Tag) vs "Σ bis" (kumulativ bis Tag X)

### 2. GeoSphere Script Fix: Kumulative Werte korrekt verarbeiten

GeoSphere API liefert `snow_acc` als akkumulierte Werte. Script berechnet jetzt Differenz.

### 3. Popup: Separate 48h und 16-Tage Prognosen

- GeoSphere (48h) zeigt 6-Stunden-Blöcke mit Schnee/Temp
- Open-Meteo (16d) zeigt tägliche Werte mit WMO-Wetter-Icons

### 4. Mobile Slider-Box standardmäßig eingeklappt

### 5. Wetter-Icons (WMO Codes)

Neue Funktion `getWeatherIcon(code)` für WMO-Wettercodes.

---

## Abgeschlossene Arbeiten (Session 12.01.2026)

### 1. Bug-Fix: GeoSphere kumulative Schneewerte

**Problem:** St. Anton zeigte 57cm statt 7cm Neuschnee für 24h.

**Lösung:** `getSnowForTimeframe()` nimmt jetzt den letzten nicht-null Wert im Zeitraum.

### 2. GeoSphere Batch-Requests (Rate-Limit-Lösung)

Batch-Requests mit mehreren `lat_lon` Parametern pro Anfrage (BATCH_SIZE = 20).

### 3. Mobile Wetter-Controls

Wetter-Box ist auf Desktop separat, auf Mobile in der Slider-Box integriert.

### 4. Info-Icon mit dynamischer Datenfrische

Info-Button zeigt Datenfrische-Status und Erklärungen.

### 5. UI-Verbesserungen

- Counter inline neben Suchfeld
- Filter-Box standardmäßig eingeklappt
- Label geändert: "Min. Neuschnee" → "Schnee-Vorhersage"

---

## Abgeschlossene Arbeiten (Session 10.01.2026 - Abend)

### 1. V2 Database: Travel Times Pipeline

Neue Pipeline zum Berechnen und Exportieren von Fahrzeiten aus der V2 Datenbank.

### 2. Bug Fix: Home-Wechsel funktionierte nicht

`stable_id` fehlte im Resort-Objekt.

### 3. DBeaver Export Format Support

### 4. Neuer Home: Alpe d'Huez

### 5. OSRM Hinweis

Aktuelles OSRM-Paket: DACH-Region. Empfehlung: Geofabrik Alps Extract.

---

## Abgeschlossene Arbeiten (Session 10.01.2026 - Vormittag)

### 1. Zukunftssicherer JSON-Export View (V2 Database)

Neuer View `v_resort_json_export` mit allen relevanten Feldern.

### 2. Frontend an V2 Schema angepasst

`nearMuc` entfernt, Verbund-Filter unterstützt `groups` Array.

### 3. Pass-Sync Script (Snow Card Tirol, SuperSkiCard)

Fuzzy Name-Matching mit manuellen Mappings. Abdeckung: 89/91 SCT (98%), 46/47 SSC (98%).

---

## Abgeschlossene Arbeiten (Session 09.01.2026)

### 1. Default Kartenausschnitt zentriert über den Alpen

Center: [46.8, 11.0], Zoom: 7

### 2. Zoom-abhängige Marker-Skalierung

Marker werden beim Herauszoomen kleiner.

### 3. Microsoft Fluent Emoji Schneeflocke

SVG statt Emoji für konsistentes Aussehen.

### 4. Home-Dropdown zeigt Fahrtzeit-Abdeckung

Format: `🟢 München Zentrum (299/299)`

### 5. Gletscher-Markierungen korrigiert (Schweiz)

Nur noch offizielle Gletscherskigebiete.

### 6. GPS-Button Design (Mobile)

Rund wie bei Google Maps, 48x48px.

---

## Abgeschlossene Arbeiten (Session 08.01.2026)

### 1. Fix: Schweizer Skigebiete im Fahrzeit-Slider

`home_muc.json` hat jetzt 299 Einträge statt 156.

### 2. GPS-Button für Live-Fahrzeitberechnung

OpenRouteService Matrix-API für Live-Fahrzeiten.

### 3. Status-Icons im Home-Dropdown

🟢 = ≥95%, 🟠 = <95%, ⚪ = Keine Datei

### 4. Fahrzeit-Berechnungsprozess (Dokumentation)

---

## Abgeschlossene Arbeiten (Session 31.12.2024)

### 1. Datenbank-Migration: Statische Spalten in `resort`-Tabelle

`lifts_total`, `pistes_km`, `max_elevation_m` migriert.

### 2. JSON-Export View

`v_resort_json_export` für Frontend-kompatiblen Export.

### 3. Neue Filter-Slider (in Arbeit)

Min. Pistenkilometer, Min. Lifte, Min. Höhe.
