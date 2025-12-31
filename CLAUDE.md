# Skigebiete Karte - Entwicklungsstand

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

1. **Testen der neuen Filter-Slider**
   - Desktop-Ansicht prüfen
   - Mobile-Ansicht prüfen (Slider im Mobile-Panel)
   - Filter-Logik verifizieren

2. **Datenbank-Bereinigung**
   - Spalten aus `resort_stats_snapshot` entfernen (nach Auflösung der View-Dependencies)
   - Views neu erstellen ohne die statischen Spalten

### Niedrig-Priorität

3. **Filter-UX-Verbesserungen** (optional)
   - Range-Slider (Min-Max) statt nur Minimum
   - Filter-Reset-Button
   - Werte im Popup anzeigen

4. **Export erweitern**
   - Neue Spalten in CSV/KML-Export aufnehmen

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
