(function () {
  "use strict";


// --- Basemap Dim Toggle (for better contrast with overlays) ---
const CFG = window.APP_CONFIG || {};
const TILE_FILTER_DARK = CFG.darkModeFilter || "saturate(0.55) brightness(0.18) contrast(0.92)";

function setMapTileFilter(filterStr) {
  const pane = document.querySelector(".leaflet-tile-pane");
  if (!pane) return;
  pane.style.filter = filterStr || "";
}

function setMapDim(on) {
  setMapTileFilter(on ? TILE_FILTER_DARK : "");
}

  function defaultExtractResortName(raw) {
    if (!raw) return "";
    const idx = raw.indexOf(" – ");
    if (idx === -1) return raw.trim();
    return raw.slice(0, idx).trim();
  }

  function downloadText(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Pass-IDs aus der Datenbank (für CSV-Export)
  const PASS_ID_SCT_EXPORT = "snowcard-tirol";
  const PASS_ID_SSC_EXPORT = "superskicard";

  function hasPassExport(r, passId) {
    if (!r.passes || !Array.isArray(r.passes)) return false;
    return r.passes.some(p => p.stable_id === passId);
  }

  function toCsv(rows) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["name", "lat", "lon", "travelHours", "distKm", "sct", "ssc", "glacier", "website"];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push([
        esc(r.name),
        esc(r.lat),
        esc(r.lon),
        esc(r.travelHours),
        esc(r.distKm),
        esc(hasPassExport(r, PASS_ID_SCT_EXPORT)),
        esc(hasPassExport(r, PASS_ID_SSC_EXPORT)),
        esc(!!r.glacier),
        esc(r.website || r.url || "")
      ].join(","));
    }
    return lines.join("\n");
  }

  function toKml(rows) {
    const xmlEsc = (s) => String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

    const placemarks = rows.map(r => {
      const website = r.website || r.url || "";
      const descParts = [];
      if (r.travelHours != null && isFinite(r.travelHours)) descParts.push(`Fahrzeit (h): ${r.travelHours.toFixed(2)}`);
      if (r.distKm != null && isFinite(r.distKm)) descParts.push(`Distanz (km): ${Math.round(r.distKm)}`);
      if (website) descParts.push(`Website: ${website}`);

      return `
      <Placemark>
        <name>${xmlEsc(r.name)}</name>
        <description>${xmlEsc(descParts.join("\n"))}</description>
        <Point>
          <coordinates>${r.lon},${r.lat},0</coordinates>
        </Point>
      </Placemark>`;
    }).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Skigebiete Export</name>
    ${placemarks}
  </Document>
</kml>`;
  }

  function initSearchAndFilters(opts) {
    const {
      map,
      resorts,
      resortMarkers,
      markerLayer, // L.layerGroup() mit allen Resorts (Sichtbarkeit wird per add/remove gesteuert)
      fmtTime,
      norm,
      getMinHours,
      getMaxHours,
      updateResortCounter,

      // UI Controls
      createFilterControl = true,
      createExportControl = true,

      exportCsvBtnId = "btn-export-visible-csv",
      exportKmlBtnId = "btn-export-visible-kml",

      // Optional: allow caller to define what "reset view" means (like page reload)
      initialCenter = null,
      initialZoom = null,
      initialBounds = null,
      resetView = null,

      // Farbkonstanten für dynamische Marker-Färbung
      colors = null,
      glacierMarkers = [],
      createGlacierIcon = null,
      createCircleIcon = null
    } = opts || {};

    if (!map || !resorts || !resortMarkers || !markerLayer || !fmtTime || !norm || !getMinHours || !getMaxHours) {
      throw new Error("initSearchAndFilters: Missing required options.");
    }

    const searchInput = document.getElementById("resort-search");
    const datalist = document.getElementById("resort-datalist");
    
    const searchForm = document.getElementById("resort-search-form");
    const searchBtn = document.getElementById("search-btn");

    const clearVerbundBtn = document.getElementById("clear-verbund-btn");

    // Default placeholder (from HTML) so we can restore it when no Verbund filter is active
    const defaultSearchPlaceholder =
      (searchInput && typeof searchInput.placeholder === "string" && searchInput.placeholder.trim())
        ? searchInput.placeholder
        : "Suche...";

    // We also want the X button to be usable after a normal resort search (zoom-in),
    // not only when a Verbund filter is active.
    let hasSearchView = false; // becomes true after performSearch triggers a view change

    function updateClearBtnState() {
      if (!clearVerbundBtn) return;
      // Enabled when either a Verbund filter is active OR we have zoomed/fitBounds via search.
      clearVerbundBtn.disabled = !(!!currentGroupId || hasSearchView);
    }

    function setHasSearchView(on) {
      hasSearchView = !!on;
      updateClearBtnState();
    }

    // --- Last search highlighting (helps finding the last searched resort after zoom reset) ---
    let lastSearchMarker = null;
    let lastSearchLatLng = null;
    let lastSearchIndicator = null;

    function _getLayerElement(layer) {
      // Leaflet 1.9+: getElement(); otherwise fallback to _path (SVG)
      if (!layer) return null;
      if (typeof layer.getElement === "function") return layer.getElement();
      return layer._path || null;
    }

    function _ensureLastSearchIndicator() {
      if (!lastSearchLatLng || typeof L === "undefined") return;

      if (!lastSearchIndicator) {
        try {
          lastSearchIndicator = L.circleMarker(lastSearchLatLng, {
            radius: 12,
            weight: 3,
            opacity: 0.95,
            fillOpacity: 0,
            interactive: false,
            className: "last-search-indicator",
          }).addTo(map);
        } catch (_) {
          lastSearchIndicator = null;
          return;
        }
      } else {
        try { lastSearchIndicator.setLatLng(lastSearchLatLng); } catch (_) {}
      }

      try { lastSearchIndicator.bringToFront && lastSearchIndicator.bringToFront(); } catch (_) {}
    }

    function pulseLastSearch() {
      if (!lastSearchLatLng) return;

      _ensureLastSearchIndicator();

      // Pulse ring
      const ringEl = _getLayerElement(lastSearchIndicator);
      if (ringEl && ringEl.classList) {
        ringEl.classList.remove("pulse");
        // force reflow so the animation can re-trigger
        void ringEl.offsetWidth;
        ringEl.classList.add("pulse");
        window.setTimeout(() => { try { ringEl.classList.remove("pulse"); } catch (_) {} }, 1400);
      }

      // Pulse the actual marker too (works for SVG markers / circleMarkers; for image icons it still applies a shadow/bounce)
      const markerEl = _getLayerElement(lastSearchMarker);
      if (markerEl && markerEl.classList) {
        markerEl.classList.remove("last-search-marker");
        void markerEl.offsetWidth;
        markerEl.classList.add("last-search-marker");
        window.setTimeout(() => { try { markerEl.classList.remove("last-search-marker"); } catch (_) {} }, 1400);
      }
    }

    function setLastSearchMarker(marker) {
      lastSearchMarker = marker || null;
      try { lastSearchLatLng = marker ? marker.getLatLng() : null; } catch (_) { lastSearchLatLng = null; }
      // if the user searches while already zoomed out, we still want the marker to be findable
      pulseLastSearch();
    }



// --- Map view reset (like page reload) ---
// We capture the view at init time (or accept overrides via opts) and can smoothly return to it.
const _initialCenter = initialCenter || map.getCenter();
const _initialZoom = (typeof initialZoom === "number") ? initialZoom : map.getZoom();
const _initialBounds = initialBounds || null;

function resetMapView() {
  if (typeof resetView === "function") {
    try { resetView(map); } catch (_) {}
    return;
  }

  try { map.closePopup(); } catch (_) {}

  const animOpts = { animate: true, duration: 0.8 };

  if (_initialBounds && typeof map.fitBounds === "function") {
    try {
      map.fitBounds(_initialBounds, Object.assign({ padding: [20, 20] }, animOpts));
      return;
    } catch (_) {}
  }

  if (typeof map.flyTo === "function") {
    try {
      map.flyTo(_initialCenter, _initialZoom, animOpts);
      return;
    } catch (_) {}
  }

  try {
    map.setView(_initialCenter, _initialZoom, animOpts);
  } catch (_) {}
}
const timeSlider = document.getElementById("time-slider");
    const timeLabel = document.getElementById("time-slider-label");

    // Neue Filter-Slider
    const pistesSlider = document.getElementById("pistes-slider");
    const pistesLabel = document.getElementById("pistes-slider-label");
    const liftsSlider = document.getElementById("lifts-slider");
    const liftsLabel = document.getElementById("lifts-slider-label");
    const elevationSlider = document.getElementById("elevation-slider");
    const elevationLabel = document.getElementById("elevation-slider-label");

    // Filter-Bereiche (werden nach Laden der Daten gesetzt)
    let filterRanges = {
      pistes: { min: 0, max: 300 },
      lifts: { min: 0, max: 100 },
      elevation: { min: 0, max: 4000 }
    };

    // Aktuelle Filter-Werte (Minimum-Schwellenwerte)
    let filterValues = {
      pistes: 10,  // Default: 10km Minimum
      lifts: 0,
      elevation: 0
    };

    function computeFilterRanges() {
      let maxPistes = 0, maxLifts = 0, maxElevation = 0;
      Object.values(resorts).forEach(r => {
        if (r.pistesKm != null && r.pistesKm > maxPistes) maxPistes = r.pistesKm;
        if (r.liftsTotal != null && r.liftsTotal > maxLifts) maxLifts = r.liftsTotal;
        if (r.maxElevation != null && r.maxElevation > maxElevation) maxElevation = r.maxElevation;
      });
      filterRanges.pistes.max = Math.ceil(maxPistes / 10) * 10 || 300;
      filterRanges.lifts.max = Math.ceil(maxLifts / 5) * 5 || 100;
      filterRanges.elevation.max = Math.ceil(maxElevation / 100) * 100 || 4000;

      // Slider-Positionen basierend auf Default-Werten setzen
      const valueToPct = (val, range) => Math.round(((val - range.min) / (range.max - range.min)) * 100);
      if (pistesSlider) pistesSlider.value = valueToPct(filterValues.pistes, filterRanges.pistes);
      if (liftsSlider) liftsSlider.value = valueToPct(filterValues.lifts, filterRanges.lifts);
      if (elevationSlider) elevationSlider.value = valueToPct(filterValues.elevation, filterRanges.elevation);
    }

    function updateFilterSliderLabels() {
      if (pistesLabel) pistesLabel.textContent = filterValues.pistes + " km";
      if (liftsLabel) liftsLabel.textContent = filterValues.lifts.toString();
      if (elevationLabel) elevationLabel.textContent = filterValues.elevation + " m";
    }

    function sliderPctToValue(pct, range) {
      return Math.round(range.min + (pct / 100) * (range.max - range.min));
    }

    // -------- Verbund-Filter --------
    // Unterstützt sowohl das neue DB Schema (r.groups Array mit primaryGroup)
    // als auch Fallback auf Name-Parsing für alte resorts.json Formate.
    let currentGroupId = null;
    let currentPct = Number(timeSlider?.value ?? 100);

    // Hilfsfunktion: Extrahiert Verbundnamen aus Resort-Name (Fallback)
    function parseVerbund(resortName) {
      if (!resortName) return null;

      // bevorzugt " - "
      let parts = resortName.split(" - ").map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts[1];

      // Fallback " – "
      parts = resortName.split(" – ").map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts[1];

      return null;
    }

    // Hilfsfunktion: Holt Group-Info aus dem neuen DB Schema
    function getResortGroups(r) {
      // Neues Schema: groups Array mit primaryGroup
      if (Array.isArray(r.groups) && r.groups.length > 0) {
        return r.groups.map(g => ({
          id: g.stable_id,
          name: g.name,
          isPrimary: !!g.isPrimary
        }));
      }
      // Fallback: primaryGroup ohne groups Array
      if (r.primaryGroup && r.primaryGroup.stable_id) {
        return [{
          id: r.primaryGroup.stable_id,
          name: r.primaryGroup.name,
          isPrimary: true
        }];
      }
      return null;
    }

    // Verbund-Index wird dynamisch aus `resorts` aufgebaut.
    let groupById = new Map();      // id -> { id, displayName, names:Set<string>, resorts: [] }
    let groupKeyToId = new Map();   // norm(anyKey) -> id

    function rebuildGroupIndex() {
      groupById = new Map();
      groupKeyToId = new Map();

      const addGroupKey = (id, rawKey) => {
        if (!id || !rawKey) return;
        const k = norm(String(rawKey));
        if (!k) return;
        if (groupKeyToId.has(k) && groupKeyToId.get(k) !== id) {
          // Konflikt: gleicher Key auf zwei Gruppen. Wir lassen den ersten stehen.
          console.warn("Verbund-Key Konflikt:", rawKey, "->", groupKeyToId.get(k), "(ignoriere)", id);
          return;
        }
        groupKeyToId.set(k, id);
      };

      Object.values(resorts).forEach(r => {
        // 1. Neues DB Schema: groups Array
        const dbGroups = getResortGroups(r);
        if (dbGroups && dbGroups.length > 0) {
          for (const g of dbGroups) {
            if (!g.id) continue;

            if (!groupById.has(g.id)) {
              groupById.set(g.id, { id: g.id, displayName: g.name || g.id, names: new Set(), resorts: [] });
            }

            const entry = groupById.get(g.id);
            entry.resorts.push(r);
            if (g.name) entry.names.add(g.name);
            entry.names.add(g.id);
          }
          return; // DB Schema gefunden, kein Fallback nötig
        }

        // 2. Fallback: Name-Parsing (für alte Daten oder wenn groups leer)
        const shortNameRaw = parseVerbund(r.name); // z.B. "SkiWelt"
        if (!shortNameRaw) return;

        const groupIdRaw = norm(shortNameRaw);
        if (!groupIdRaw) return;

        if (!groupById.has(groupIdRaw)) {
          groupById.set(groupIdRaw, { id: groupIdRaw, displayName: shortNameRaw, names: new Set(), resorts: [] });
        }

        const entry = groupById.get(groupIdRaw);
        entry.resorts.push(r);
        entry.names.add(shortNameRaw);
        entry.names.add(groupIdRaw);
      });

      // Reverse lookup füllen
      for (const entry of groupById.values()) {
        for (const nm of entry.names) addGroupKey(entry.id, nm);
        if (entry.displayName) addGroupKey(entry.id, entry.displayName);
      }
    }

    // initial (kann leer sein, wenn resorts.json noch nicht geladen ist)
    rebuildGroupIndex();

    function setGroupFilter(groupIdOrNull) {
      currentGroupId = groupIdOrNull ? String(groupIdOrNull) : null;
      updateVerbundUi();
      applyFilters(currentPct); // sofort anwenden, andere Filter bleiben unberührt
    }

    // Reset-Button neben Suchfeld:
// - hebt Verbundfilter auf (falls aktiv)
// - setzt die Kartenansicht auf die initiale View zurück
if (clearVerbundBtn) {
  clearVerbundBtn.addEventListener("click", () => {
    setGroupFilter(null);
    setHasSearchView(false);
    resetMapView();
    // After zoom reset, add a short pulse so the user can spot the last searched resort.
    window.setTimeout(pulseLastSearch, 220);
    try { searchInput && searchInput.focus(); } catch (_) {}
  });
}
function updateVerbundUi() {
  if (!searchInput) return;

  const activeGroup = !!currentGroupId;

  if (activeGroup) {
    const vName = groupById.get(currentGroupId)?.displayName || groupById.get(currentGroupId)?.id || "Verbund";
    searchInput.placeholder = i18n.t("filterActiveTemplate", { name: vName });
  } else {
    // restore HTML placeholder
    searchInput.placeholder = defaultSearchPlaceholder;
  }

  // X button should be enabled either for active Verbund OR after any search zoom/fitBounds
  updateClearBtnState();
}

    // -------- Filter-Box (Saisonkarten / Gletscher / Überschneidung / Nahe München / Länder) --------
    const filterState = {
      sct: false,
      ssc: false,
      both: false,
      selectedPass: null,  // Dropdown: ausgewählter Pass (stable_id)
      glacier: true,
      verbunde: true,    // Verbund-Marker auf der Karte anzeigen (Default: an)
      favorites: false,  // Favoriten-Highlight
      visited: false,    // Besucht-Highlight
      onlyFilter: false,  // Wenn true: Nur Resorts zeigen, die einem aktiven Highlight-Filter entsprechen
      // Länder
      countryAT: true,
      countryDE: true,
      countryCH: true,
      countryIT: true,
      countryFR: true,
      countrySI: true
    };

    // Pass-IDs aus der Datenbank
    const PASS_ID_SCT = "snowcard-tirol";
    const PASS_ID_SSC = "superskicard";

    // Hilfsfunktion: Prüft ob ein Resort einen bestimmten Pass hat
    function hasPass(r, passId) {
      if (!r.passes || !Array.isArray(r.passes)) return false;
      return r.passes.some(p => p.stable_id === passId);
    }

    // Hilfsfunktion: Normalisiert Ländernamen zu Codes
    function getCountryCode(r) {
      const country = (r.country || "").toLowerCase().trim();
      if (country === "austria" || country === "at" || country === "österreich") return "AT";
      if (country === "germany" || country === "de" || country === "deutschland") return "DE";
      if (country === "switzerland" || country === "ch" || country === "schweiz") return "CH";
      if (country === "italy" || country === "it" || country === "italien") return "IT";
      if (country === "france" || country === "fr" || country === "frankreich") return "FR";
      if (country === "slovenia" || country === "si" || country === "slowenien") return "SI";
      return country.toUpperCase();
    }

    // Favoriten-Farbe (gold/amber)
    const COLOR_FAVORITE = "#f59e0b";
    // Besucht-Farbe (grün)
    const COLOR_VISITED = "#16a34a";

    // Ermittelt die Farbe für ein Resort basierend auf Pass-Zugehörigkeit und Highlight-Status
    function getResortColor(r) {
      if (!colors) return "#888888"; // Fallback wenn keine Farben übergeben

      const hasSct = hasPass(r, PASS_ID_SCT);
      const hasSsc = hasPass(r, PASS_ID_SSC);
      const countryCode = getCountryCode(r);

      // Favoriten haben höchste Priorität bei Highlights
      const isFav = r.stable_id && window.Favorites && window.Favorites.isFavorite(r.stable_id);
      if (isFav && filterState.favorites) return COLOR_FAVORITE;

      // Besucht kommt nach Favoriten
      const isVis = r.stable_id && window.Visited && window.Visited.isVisited(r.stable_id);
      if (isVis && filterState.visited) return COLOR_VISITED;

      // Basis-Gruppen
      const isSctOnly = hasSct && !hasSsc;
      const isSscOnly = hasSsc && !hasSct;
      const isBoth = hasSct && hasSsc;

      // Highlight-Logik: Wenn der jeweilige Pass-Filter aktiv ist, zeige Pass-Farbe
      if (isBoth && filterState.both) return colors.BOTH;
      if (isSctOnly && filterState.sct) return colors.SCT;
      if (isSscOnly && filterState.ssc) return colors.SSC;

      // Dropdown-Pass: Highlight mit Grün (wie Verbund-Farbe)
      if (filterState.selectedPass && hasPass(r, filterState.selectedPass)) {
        return '#10b981'; // Smaragdgrün für Dropdown-Pass
      }

      // Standard-Länderfarben (kein Highlight oder kein Pass)
      if (countryCode === "AT") return colors.AT;
      if (countryCode === "DE") return colors.DE;
      if (countryCode === "CH") return colors.CH;
      if (countryCode === "IT") return colors.IT;
      if (countryCode === "FR") return colors.FR;
      if (countryCode === "SI") return colors.SI;

      return colors.OTHER;
    }

    // Aktualisiert alle Marker-Farben basierend auf filterState
    function updateMarkerColors() {
      if (!colors) return;

      Object.values(resorts).forEach(r => {
        const key = norm(r.name);
        const marker = resortMarkers[key];
        if (!marker) return;

        const newColor = getResortColor(r);

        // CircleMarker: setStyle verwenden
        if (marker.setStyle && typeof marker.setStyle === "function") {
          marker.setStyle({ color: newColor, fillColor: newColor });
        }
      });

      // Gletscher-Marker: Icon nur neu erstellen wenn Farbe sich ändert (Performance!)
      if (glacierMarkers && createGlacierIcon) {
        // Resort-Lookup einmal vorberechnen (O(n) statt O(n²))
        const resortByName = {};
        Object.values(resorts).forEach(r => { resortByName[r.name] = r; });

        glacierMarkers.forEach((glacierData, index) => {
          const { marker, resortName, color: oldColor } = glacierData;
          if (!resortName) return;

          const resort = resortByName[resortName];
          if (!resort) return;

          const newColor = getResortColor(resort);

          // Nur Icon aktualisieren wenn sich Farbe TATSÄCHLICH geändert hat
          if (newColor === oldColor) return;

          const currentZoom = map.getZoom();
          const iconSize = currentZoom >= 9 ? 26 : currentZoom >= 8 ? 22 : currentZoom >= 7 ? 18 : currentZoom >= 6 ? 14 : 12;

          // Wenn Gletscher-Highlight aktiv: Schneeflocke, sonst normaler Kreis
          if (filterState.glacier) {
            marker.setIcon(createGlacierIcon(newColor, iconSize));
          } else if (createCircleIcon) {
            marker.setIcon(createCircleIcon(newColor, iconSize));
          }
          // Aktualisiere gespeicherte Farbe
          glacierMarkers[index].color = newColor;
        });
      }
    }

    function categoryMatch(r) {
      // --- Länderfilter (OR-Logik) ---
      const countryCode = getCountryCode(r);

      // Prüfe ob countryCode ein bekannter Code ist
      const isKnownCountry = ["AT", "DE", "CH", "IT", "FR", "SI"].includes(countryCode);

      const countryMatch = (
        (filterState.countryAT && countryCode === "AT") ||
        (filterState.countryDE && countryCode === "DE") ||
        (filterState.countryCH && countryCode === "CH") ||
        (filterState.countryIT && countryCode === "IT") ||
        (filterState.countryFR && countryCode === "FR") ||
        (filterState.countrySI && countryCode === "SI")
      );

      // Wenn ein Land-Filter aktiv ist UND das Resort ein bekanntes Land hat,
      // muss es zu einem ausgewählten Land gehören
      const anyCountrySelected = filterState.countryAT || filterState.countryDE || filterState.countryCH ||
                                  filterState.countryIT || filterState.countryFR || filterState.countrySI;
      if (anyCountrySelected && isKnownCountry && !countryMatch) return false;

      // --- "Nur Filter" (Sichtbarkeit) ---
      // Wenn aktiviert: Nur Resorts zeigen, die einem aktiven Highlight-Filter entsprechen
      if (filterState.onlyFilter) {
        const hasSct = hasPass(r, PASS_ID_SCT);
        const hasSsc = hasPass(r, PASS_ID_SSC);
        const isGlacier = !!r.glacier;
        const isFav = r.stable_id && window.Favorites && window.Favorites.isFavorite(r.stable_id);
        const isVis = r.stable_id && window.Visited && window.Visited.isVisited(r.stable_id);

        const isSctOnly = hasSct && !hasSsc;
        const isSscOnly = hasSsc && !hasSct;
        const isBoth = hasSct && hasSsc;

        // Prüfe ob Resort den ausgewählten Dropdown-Pass hat
        const hasSelectedDropdownPass = filterState.selectedPass && hasPass(r, filterState.selectedPass);

        // Prüfe ob das Resort einem aktiven Highlight-Filter entspricht
        // Hinweis: verbunde steuert nur Verbund-Marker-Sichtbarkeit, nicht Resort-Filterung
        const matchesActiveFilter =
          (filterState.sct && isSctOnly) ||
          (filterState.ssc && isSscOnly) ||
          (filterState.both && isBoth) ||
          (filterState.selectedPass && hasSelectedDropdownPass) ||
          (filterState.glacier && isGlacier) ||
          (filterState.favorites && isFav) ||
          (filterState.visited && isVis);

        if (!matchesActiveFilter) return false;
      }

      // Pass- und Gletscher-Filter steuern Farbe, nicht Sichtbarkeit
      // (außer wenn "Nur Highlights" aktiv ist - dann wie oben)
      // selectedPass wird durch matchesActiveFilter berücksichtigt

      return true;
    }

    function buildFilterControl() {
      if (!createFilterControl || typeof L === "undefined") return;

      const ctrl = L.control({ position: "topright" });
      ctrl.onAdd = function () {
        const div = L.DomUtil.create("div", "filter-box leaflet-control collapsed");
        const t = window.i18n ? window.i18n.t : (k) => k;
        div.innerHTML = `
          <button type="button" class="panel-toggle" aria-label="${t('filter')}" aria-expanded="false">
            <span class="toggle-title">${t('filter')}</span>
            <span class="toggle-icon">▼</span>
          </button>
          <div class="panel-content">
          <div class="filter-group-title">${t('countries')}</div>
          <label><input type="checkbox" id="flt-at" checked> ${t('austria')}</label>
          <label><input type="checkbox" id="flt-de" checked> ${t('germany')}</label>
          <label><input type="checkbox" id="flt-ch" checked> ${t('switzerland')}</label>
          <label><input type="checkbox" id="flt-it" checked> ${t('italy')}</label>
          <label><input type="checkbox" id="flt-fr" checked> ${t('france')}</label>
          <label><input type="checkbox" id="flt-si" checked> ${t('slovenia')}</label>
          <div class="filter-group-title">${t('highlight')}</div>
          <label><input type="checkbox" id="flt-favorites"> ★ ${t('favorites')} <span id="flt-favorites-count" style="color:#9ca3af;font-size:11px"></span></label>
          <label><input type="checkbox" id="flt-visited"> ✓ ${t('visited')} <span id="flt-visited-count" style="color:#9ca3af;font-size:11px"></span></label>
          <label><input type="checkbox" id="flt-glacier" checked> ${t('glacier')}</label>
          <label><input type="checkbox" id="flt-verbunde"> ${t('verbunde')}</label>
          <div class="filter-group-title">${t('passes')}</div>
          <label><input type="checkbox" id="flt-sct"> ${t('snowCardTirol')}</label>
          <label><input type="checkbox" id="flt-ssc"> ${t('superSkiCard')}</label>
          <label><input type="checkbox" id="flt-both"> ${t('bothPasses')}</label>
          <div class="filter-pass-dropdown-row" style="margin:6px 0;">
            <select id="flt-pass-dropdown" class="control-select" style="width:100%;padding:4px 6px;font-size:12px;border-radius:6px;border:1px solid #d1d5db;">
              <option value="">${t('moreSkiPasses')}</option>
            </select>
          </div>
          <div class="filter-group-title">${t('other')}</div>
          <label><input type="checkbox" id="flt-onlyfilter"> ${t('onlyHighlights')}</label>
          <label><input type="checkbox" id="flt-dimmap"> ${t('darkMode')}</label>
          </div><!-- /.panel-content -->
`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      };
      ctrl.addTo(map);

      // wiring (nachdem es im DOM ist)
      const wire = () => {
        // Toggle-Button für Filter-Box
        const filterBox = document.querySelector(".filter-box.leaflet-control");
        const toggleBtn = filterBox && filterBox.querySelector(".panel-toggle");
        const weatherBox = document.getElementById("weather-box");

        // Berechnet Gesamthöhe aller Control-Boxen und verschiebt Weather-Box wenn nötig
        function updateWeatherBoxPosition() {
          if (!weatherBox || window.innerWidth <= 768) return;

          // Alle Control-Boxen im rechten Panel sammeln
          const controlBoxes = document.querySelectorAll(".leaflet-top.leaflet-right .leaflet-control");
          let totalHeight = 0;

          controlBoxes.forEach(box => {
            // Nur sichtbare Boxen zählen
            const style = window.getComputedStyle(box);
            if (style.display !== "none" && style.visibility !== "hidden") {
              totalHeight += box.offsetHeight + 8; // 8px margin
            }
          });

          // Weather-Box verschieben wenn Controls bis zur Weather-Box reichen
          const weatherTop = weatherBox.getBoundingClientRect().top;
          if (totalHeight > weatherTop - 20) {
            weatherBox.classList.add("shifted");
          } else {
            weatherBox.classList.remove("shifted");
          }
        }

        // Global verfügbar machen für andere Toggle-Buttons
        window.updateWeatherBoxPosition = updateWeatherBoxPosition;

        if (toggleBtn && filterBox) {
          toggleBtn.addEventListener("click", () => {
            const isCollapsed = filterBox.classList.toggle("collapsed");
            toggleBtn.setAttribute("aria-expanded", !isCollapsed);
            // Weather-Box Position nach Toggle aktualisieren
            setTimeout(updateWeatherBoxPosition, 50);
          });
          // Initial prüfen
          setTimeout(updateWeatherBoxPosition, 100);
        }

        // Länder
        const elAT = document.getElementById("flt-at");
        const elDE = document.getElementById("flt-de");
        const elCH = document.getElementById("flt-ch");
        const elIT = document.getElementById("flt-it");
        const elFR = document.getElementById("flt-fr");
        const elSI = document.getElementById("flt-si");
        // Favoriten
        const elFavorites = document.getElementById("flt-favorites");
        const elFavoritesCount = document.getElementById("flt-favorites-count");
        // Pässe
        const elSct = document.getElementById("flt-sct");
        const elSsc = document.getElementById("flt-ssc");
        const elBoth = document.getElementById("flt-both");
        const elPassDropdown = document.getElementById("flt-pass-dropdown");
        // Sonstige
        const elOnlyFilter = document.getElementById("flt-onlyfilter");
        const elGl = document.getElementById("flt-glacier");
        const elVerbunde = document.getElementById("flt-verbunde");
        const elDim = document.getElementById("flt-dimmap");

        // Besucht
        const elVisited = document.getElementById("flt-visited");
        const elVisitedCount = document.getElementById("flt-visited-count");

        // Favoriten-Zähler aktualisieren
        function updateFavoritesCount() {
          if (!elFavoritesCount) return;
          const count = window.Favorites ? window.Favorites.getFavoriteCount() : 0;
          elFavoritesCount.textContent = count > 0 ? `(${count})` : "";
        }
        updateFavoritesCount();
        // Auf Favoriten-Änderungen reagieren
        window.addEventListener("favorites-changed", () => {
          try {
            updateFavoritesCount();
            if (filterState.favorites) {
              applyFilters(currentPct);
              updateMarkerColors();
            }
          } catch (e) { console.warn("favorites-changed handler error:", e); }
        });

        // Besucht-Zähler aktualisieren
        function updateVisitedCount() {
          if (!elVisitedCount) return;
          const count = window.Visited ? window.Visited.getVisitedCount() : 0;
          elVisitedCount.textContent = count > 0 ? `(${count})` : "";
        }
        updateVisitedCount();
        // Auf Besucht-Änderungen reagieren
        window.addEventListener("visited-changed", () => {
          try {
            updateVisitedCount();
            if (filterState.visited) {
              applyFilters(currentPct);
              updateMarkerColors();
            }
          } catch (e) { console.warn("visited-changed handler error:", e); }
        });

        // Pass-Dropdown befüllen (dynamisch aus Resort-Daten, gruppiert nach Land)
        function populatePassDropdown() {
          if (!elPassDropdown) return;

          const t = window.i18n ? window.i18n.t : (k) => k;
          const countryNames = {
            AT: t('austria'),
            CH: t('switzerland'),
            DE: t('germany'),
            FR: t('france'),
            IT: t('italy'),
            SI: t('slovenia'),
            MULTI: t('international') || 'International'
          };

          // Sammle alle einzigartigen Pässe aus den Resort-Daten mit Länder-Info
          const passMap = new Map(); // stable_id -> { name, count, countries: Map<country, count> }
          Object.values(resorts).forEach(r => {
            if (!r.passes || !Array.isArray(r.passes)) return;
            const country = r.country || 'MULTI';
            r.passes.forEach(p => {
              if (!p.stable_id) return;
              // SCT und SSC überspringen (haben eigene Checkboxen)
              if (p.stable_id === PASS_ID_SCT || p.stable_id === PASS_ID_SSC) return;

              if (!passMap.has(p.stable_id)) {
                passMap.set(p.stable_id, { name: p.name || p.stable_id, count: 0, countries: new Map() });
              }
              const passInfo = passMap.get(p.stable_id);
              passInfo.count++;
              passInfo.countries.set(country, (passInfo.countries.get(country) || 0) + 1);
            });
          });

          // Bestimme dominantes Land für jeden Pass
          passMap.forEach((info, stableId) => {
            let maxCount = 0;
            let dominantCountry = 'MULTI';
            info.countries.forEach((count, country) => {
              if (count > maxCount) {
                maxCount = count;
                dominantCountry = country;
              }
            });
            // Wenn Pass in mehreren Ländern verbreitet ist (>30% in anderem Land), markiere als International
            const totalCount = info.count;
            const dominantPct = maxCount / totalCount;
            info.dominantCountry = dominantPct >= 0.7 ? dominantCountry : 'MULTI';
          });

          // Gruppiere nach Land
          const passesByCountry = new Map();
          ['AT', 'CH', 'DE', 'FR', 'IT', 'SI', 'MULTI'].forEach(c => passesByCountry.set(c, []));

          passMap.forEach((info, stableId) => {
            const country = info.dominantCountry;
            if (!passesByCountry.has(country)) passesByCountry.set(country, []);
            passesByCountry.get(country).push({ stableId, ...info });
          });

          // Sortiere Pässe innerhalb jedes Landes nach Anzahl
          passesByCountry.forEach((passes, country) => {
            passes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
          });

          // Dropdown befüllen mit optgroup für jedes Land
          ['AT', 'CH', 'DE', 'FR', 'IT', 'SI', 'MULTI'].forEach(country => {
            const passes = passesByCountry.get(country);
            if (!passes || passes.length === 0) return;

            const optgroup = document.createElement('optgroup');
            optgroup.label = countryNames[country] || country;

            passes.forEach(p => {
              const opt = document.createElement('option');
              opt.value = p.stableId;
              opt.textContent = `${p.name} (${p.count})`;
              optgroup.appendChild(opt);
            });

            elPassDropdown.appendChild(optgroup);
          });

          // Event feuern damit Bottom Sheet Dropdown synchronisiert werden kann
          window.dispatchEvent(new CustomEvent('pass-dropdown-populated'));
        }

        // Dropdown später befüllen, wenn resorts geladen ist
        if (Object.keys(resorts).length > 0) {
          populatePassDropdown();
        } else {
          // Warte auf resorts-loaded Event oder polling
          const checkAndPopulate = setInterval(() => {
            if (Object.keys(resorts).length > 0) {
              clearInterval(checkAndPopulate);
              populatePassDropdown();
            }
          }, 500);
          setTimeout(() => clearInterval(checkAndPopulate), 10000); // Timeout nach 10s
        }

        // Event-Handler für Dropdown
        if (elPassDropdown) {
          elPassDropdown.addEventListener('change', () => {
            const selectedValue = elPassDropdown.value;
            filterState.selectedPass = selectedValue || null;
            applyFilters(currentPct);
            updateMarkerColors();
          });
        }

        // restore + apply saved dim state
        const savedDim = (typeof localStorage !== "undefined") && localStorage.getItem("mapDim") === "1";
        if (elDim) {
          elDim.checked = !!savedDim;
          setMapDim(!!savedDim);
          elDim.addEventListener("change", () => {
            const on = !!elDim.checked;
            setMapDim(on);
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("mapDim", on ? "1" : "0");
            }
          });
        } else {
          setMapDim(!!savedDim);
        }

        const handler = () => {
          // Länder (wenn Element nicht gefunden, bleibt true = alle anzeigen)
          filterState.countryAT = elAT ? !!elAT.checked : true;
          filterState.countryDE = elDE ? !!elDE.checked : true;
          filterState.countryCH = elCH ? !!elCH.checked : true;
          filterState.countryIT = elIT ? !!elIT.checked : true;
          filterState.countryFR = elFR ? !!elFR.checked : true;
          filterState.countrySI = elSI ? !!elSI.checked : true;
          // Favoriten
          filterState.favorites = elFavorites ? !!elFavorites.checked : false;
          // Besucht
          filterState.visited = elVisited ? !!elVisited.checked : false;
          // Pässe (Highlight, nicht Sichtbarkeit) - Default: aus
          filterState.sct = elSct ? !!elSct.checked : false;
          filterState.ssc = elSsc ? !!elSsc.checked : false;
          filterState.both = elBoth ? !!elBoth.checked : false;
          // Sonstige
          filterState.onlyFilter = elOnlyFilter ? !!elOnlyFilter.checked : false;
          filterState.glacier = elGl ? !!elGl.checked : true;
          filterState.verbunde = elVerbunde ? !!elVerbunde.checked : true;

          // Verbund-Marker ein-/ausblenden
          if (window.setVerbundMarkersVisible) {
            window.setVerbundMarkersVisible(filterState.verbunde);
          }

          applyFilters(currentPct);
          updateMarkerColors(); // Farben basierend auf Pass-Highlights aktualisieren
        };

        [elAT, elDE, elCH, elIT, elFR, elSI, elFavorites, elVisited, elSct, elSsc, elBoth, elOnlyFilter, elGl, elVerbunde].forEach(el => {
          if (!el) return;
          el.addEventListener("change", handler);
        });
      };

      // nächster Tick (sicherstellen DOM ist da)
      setTimeout(wire, 0);
    }

    function buildExportControl() {
      if (!createExportControl || typeof L === "undefined") return;

      const exportControl = L.control({ position: "topright" });
      exportControl.onAdd = function () {
        const div = L.DomUtil.create("div", "export-box leaflet-control collapsed");
        const t = window.i18n ? window.i18n.t : (k) => k;
        div.innerHTML = `
          <button type="button" class="panel-toggle" aria-label="${t('export')}" aria-expanded="false">
            <span class="toggle-title">${t('export')}</span>
            <span class="toggle-icon">▼</span>
          </button>
          <div class="panel-content">
          <div class="filter-group-title">${t('visibleResorts')}</div>
          <button id="${exportCsvBtnId}" type="button">CSV</button>
          <button id="${exportKmlBtnId}" type="button">KML</button>
          <div class="filter-group-title">${t('personalData')}</div>
          <button id="btn-export-userdata" type="button">★ ✓ ${t('exportFavVisited')}</button>
          <button id="btn-import-userdata" type="button">★ ✓ ${t('importFavVisited')}</button>
          <input type="file" id="import-userdata-file" accept=".json" style="display:none">
          </div><!-- /.panel-content -->
`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);

        // Toggle-Button wiring
        setTimeout(() => {
          const toggleBtn = div.querySelector(".panel-toggle");
          if (toggleBtn) {
            toggleBtn.addEventListener("click", () => {
              const isCollapsed = div.classList.toggle("collapsed");
              toggleBtn.setAttribute("aria-expanded", !isCollapsed);
              // Weather-Box Position aktualisieren
              if (window.updateWeatherBoxPosition) {
                setTimeout(window.updateWeatherBoxPosition, 50);
              }
            });
          }

          // Persönliche Daten Export/Import
          const exportUserdataBtn = document.getElementById("btn-export-userdata");
          const importUserdataBtn = document.getElementById("btn-import-userdata");
          const importUserdataFile = document.getElementById("import-userdata-file");

          if (exportUserdataBtn) {
            exportUserdataBtn.addEventListener("click", () => {
              const data = {
                version: 1,
                exported: new Date().toISOString(),
                favorites: window.Favorites ? window.Favorites.getAllFavorites() : [],
                visited: window.Visited ? Object.fromEntries(
                  window.Visited.getAllVisited().map(id => [id, window.Visited.getVisitedInfo(id)])
                ) : {}
              };
              downloadText("skimap_userdata.json", "application/json", JSON.stringify(data, null, 2));
            });
          }

          if (importUserdataBtn && importUserdataFile) {
            importUserdataBtn.addEventListener("click", () => {
              importUserdataFile.click();
            });

            importUserdataFile.addEventListener("change", (e) => {
              const file = e.target.files[0];
              if (!file) return;

              const reader = new FileReader();
              reader.onload = (event) => {
                try {
                  const data = JSON.parse(event.target.result);
                  let importedFav = 0, importedVis = 0;

                  // Favoriten importieren
                  if (data.favorites && Array.isArray(data.favorites) && window.Favorites) {
                    importedFav = window.Favorites.importFavorites(JSON.stringify({ favorites: data.favorites }));
                  }

                  // Besucht importieren
                  if (data.visited && typeof data.visited === "object" && window.Visited) {
                    importedVis = window.Visited.importVisited(JSON.stringify({ visited: data.visited }));
                  }

                  const t = window.i18n ? window.i18n.t : (k) => k;
                  alert(t('importSuccess', { fav: importedFav >= 0 ? importedFav : 0, vis: importedVis >= 0 ? importedVis : 0 }));
                } catch (err) {
                  console.error("Import-Fehler:", err);
                  const t = window.i18n ? window.i18n.t : (k) => k;
                  alert(t('importFailed'));
                }
              };
              reader.readAsText(file);
              // Reset file input
              importUserdataFile.value = "";
            });
          }
        }, 0);

        return div;
      };
      exportControl.addTo(map);
    }

    buildFilterControl();
    buildExportControl();

    // -------- Suche --------
    // Datalist Autocomplete:
    // - Normal (kein Prefix): Resorts
    // - "verbund: ...": nur Verbünde (value = "verbund: <groupId>", label = Name)
    // - "resort: ...": nur Resorts (value = "resort: <name> – <zeit>")
    let datalistMode = "all"; // all|verbund|resort

    function detectModeFromInputValue(raw) {
      const v = String(raw || "").trimStart();
      if (/^(verbund|group|v)\s*:/i.test(v)) return "verbund";
      if (/^(resort|gebiet|r)\s*:/i.test(v)) return "resort";
      return "all";
    }

    function clearDatalist() {
      if (!datalist) return;
      while (datalist.firstChild) datalist.removeChild(datalist.firstChild);
    }

    function fillDatalistForGroups() {
      if (!datalist) return;
      rebuildGroupIndex();
      const groups = Array.from(groupById.values())
        .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id), "de"));
      for (const g of groups) {
        const opt = document.createElement("option");
        // Verwende displayName für Anzeige, stable_id intern für Lookup
        const name = g.displayName || g.id;
        opt.value = `verbund: ${name}`;
        datalist.appendChild(opt);
      }
    }

    function fillDatalistForResorts(prefix) {
      if (!datalist) return;
      Object.values(resorts)
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .forEach(r => {
          const opt = document.createElement("option");
          const country = r.country || "";
          const namePart = (r.travelHours != null && isFinite(r.travelHours))
            ? (r.name + " – " + fmtTime(r.travelHours) + (country ? " – " + country : ""))
            : (r.name + (country ? " – " + country : ""));
          opt.value = prefix ? (prefix + namePart) : namePart;
          datalist.appendChild(opt);
        });
    }

    function rebuildDatalist(forceMode = null) {
      if (!datalist) return;

      const mode = forceMode || detectModeFromInputValue(searchInput?.value);
      datalistMode = mode;

      clearDatalist();

      if (mode === "verbund") {
        fillDatalistForGroups();
      } else if (mode === "resort") {
        fillDatalistForResorts("resort: ");
      } else {
        // default: Resorts + Verbünde mit Prefix zur Unterscheidung
        // Verbünde zuerst, dann Resorts
        rebuildGroupIndex();
        const groups = Array.from(groupById.values())
          .filter(g => g.resorts && g.resorts.length >= 2) // nur Verbünde mit 2+ Resorts
          .sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id), "de"));
        for (const g of groups) {
          const opt = document.createElement("option");
          // Verbünde mit Verbund-Prefix und Resort-Anzahl
          opt.value = `verbund: ${g.displayName || g.id}`;
          opt.label = `🔗 ${g.displayName || g.id} (${g.resorts.length})`;
          datalist.appendChild(opt);
        }
        fillDatalistForResorts("");
      }
    }

    function focusResortByName(query) {
      if (!query) return;
      const qNorm = norm(query);
      const keys = Object.keys(resortMarkers);

      let bestKey = null;
      if (resortMarkers[qNorm]) bestKey = qNorm;
      else {
        for (const k of keys) { if (k.startsWith(qNorm)) { bestKey = k; break; } }
        if (!bestKey) for (const k of keys) { if (k.includes(qNorm)) { bestKey = k; break; } }
      }

      if (!bestKey) {
        const t = window.i18n ? window.i18n.t : (k) => k;
        alert(t('noResortFound', { query }));
        return;
      }

      const marker = resortMarkers[bestKey];
      const latLng = marker.getLatLng();
      map.setView(latLng, 11);
      marker.openPopup();
      setHasSearchView(true);
      setLastSearchMarker(marker);
    }

    function extractResortName(raw) {
      return defaultExtractResortName(raw);
    }

    function resortPassesAllFilters(r, pct) {
      const minHours = getMinHours();
      const maxHours = getMaxHours();
      const limitHours = minHours + (pct / 100) * (maxHours - minHours);

      // Verbund-Filter (unterstützt neues DB Schema und Fallback)
      let inVerbund = true;
      if (currentGroupId) {
        // Neue DB Schema: groups Array
        const dbGroups = getResortGroups(r);
        if (dbGroups && dbGroups.length > 0) {
          inVerbund = dbGroups.some(g => g.id === currentGroupId);
        } else {
          // Fallback: Name-Parsing
          const shortName = parseVerbund(r.name);
          const thisGroupId = shortName ? norm(shortName) : null;
          inVerbund = !!thisGroupId && String(thisGroupId) === String(currentGroupId);
        }
      }


      // Wenn travelHours fehlt: nur bei 100% anzeigen (sonst ausblenden)
      const inTime = (pct >= 99) || (r.travelHours != null && r.travelHours <= limitHours + 1e-6);

      const inCategory = categoryMatch(r);

      // Neue Filter: Pisten, Lifte, Höhe (Minimum-Filter)
      const inPistes = filterValues.pistes === 0 || (r.pistesKm != null && r.pistesKm >= filterValues.pistes);
      const inLifts = filterValues.lifts === 0 || (r.liftsTotal != null && r.liftsTotal >= filterValues.lifts);
      const inElevation = filterValues.elevation === 0 || (r.maxElevation != null && r.maxElevation >= filterValues.elevation);

      return inVerbund && inTime && inCategory && inPistes && inLifts && inElevation;
    }

    function fitBoundsForGroup(groupId) {
      if (typeof L === "undefined") return;
      const entry = groupById.get(groupId);
      if (!entry) return;

      const bounds = L.latLngBounds();
      let added = 0;

      // Bounds bevorzugt auf sichtbare Marker
      for (const r of entry.resorts) {
        if (!resortPassesAllFilters(r, currentPct)) continue;
        const mk = resortMarkers[norm(r.name)];
        if (!mk) continue;
        bounds.extend(mk.getLatLng());
        added++;
      }

      // Fallback: alle im Verbund
      if (added === 0) {
        for (const r of entry.resorts) {
          const mk = resortMarkers[norm(r.name)];
          if (!mk) continue;
          bounds.extend(mk.getLatLng());
        }
      }

      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.15));
        setHasSearchView(true);
      setLastSearchMarker(marker);
      }
    }

    if (searchInput) {
      // Autocomplete-Modus automatisch umschalten:
      // - sobald der Nutzer "verbund:" tippt → nur Verbund-Vorschläge
      // - sobald der Nutzer "resort:" tippt → nur Resort-Vorschläge
      // - sonst → normale Resort-Vorschläge
      searchInput.addEventListener("input", () => {
        const mode = detectModeFromInputValue(searchInput.value);
        if (mode !== datalistMode) rebuildDatalist(mode);
      });

            function performSearch() {
        const raw = (searchInput.value || "").trim();
        if (!raw) return;

        // Index sicher aktuell halten (wichtig, weil resorts erst nachträglich befüllt werden)
        rebuildGroupIndex();


        // Prefix-Mode: z.B. "verbund: skiwelt" wie bei Google "site:".
        // Damit ist die Absicht eindeutig und wir müssen nicht raten.
        const m = raw.match(/^([A-Za-zÄÖÜäöüß]+)\s*:\s*(.+)$/);
        if (m) {
          const mode = String(m[1] || "").trim().toLowerCase();
          const termRaw = String(m[2] || "").trim();
          if (!termRaw) return;

          const termName = extractResortName(termRaw);
          const termNorm = norm(termName);

          const findGroupId = () => {
            // 1) Exakt über groupKeyToId (groupName, Kurzname, groupId)
            if (groupKeyToId.has(termNorm)) return groupKeyToId.get(termNorm);

            // 2) Exakt über groupById (falls User direkt groupId eingibt)
            if (groupById.has(termName)) return termName;
            if (groupById.has(termNorm)) return termNorm;

            // 3) Teiltreffer über Keys
            const keys = Array.from(groupKeyToId.keys());
            const starts = keys.filter(k => k.startsWith(termNorm));
            const contains = starts.length ? [] : keys.filter(k => k.includes(termNorm));

            const pickBestKey = (arr) => arr.sort((a, b) => a.length - b.length || a.localeCompare(b, "de"))[0] || null;
            const bestKey = starts.length ? pickBestKey(starts) : pickBestKey(contains);
            if (bestKey) return groupKeyToId.get(bestKey);
            return null;
          };

          if (mode === "verbund" || mode === "group" || mode === "v") {
            const gid = findGroupId();
            if (!gid) {
              const t = window.i18n ? window.i18n.t : (k) => k;
              alert(t('noGroupFound', { query: termRaw }));
              return;
            }
            setGroupFilter(gid);
            fitBoundsForGroup(gid);
            return;
          }

          if (mode === "resort" || mode === "gebiet" || mode === "r") {
            setGroupFilter(null);
            applyFilters(currentPct);
            focusResortByName(termName);
            return;
          }

          // Unbekannter Prefix → wie normal behandeln
        }

        const onlyName = extractResortName(raw);
        const qNorm = norm(onlyName);

        // Exaktes Resort
        if (resortMarkers[qNorm]) {
          setGroupFilter(null);
          applyFilters(currentPct); // damit evtl. wieder sichtbar
          focusResortByName(onlyName);
          return;
        }

        // Verbund (exakt oder per Teiltreffer, z.B. "Skiwelt")
        if (groupKeyToId.has(qNorm)) {
          const gid = groupKeyToId.get(qNorm);
          setGroupFilter(gid);
          fitBoundsForGroup(gid);
          return;
        }

        // Teiltreffer: erst Keys, dann displayName
        const keys = Array.from(groupKeyToId.keys());
        const starts = keys.filter(k => k.startsWith(qNorm));
        const contains = starts.length ? [] : keys.filter(k => k.includes(qNorm));

        const pickBestKey = (arr) => arr.sort((a, b) => a.length - b.length || a.localeCompare(b, "de"))[0] || null;
        const bestKey = starts.length ? pickBestKey(starts) : pickBestKey(contains);

        if (bestKey) {
          const gid = groupKeyToId.get(bestKey);
          setGroupFilter(gid);
          fitBoundsForGroup(gid);
          return;
        }
// Fallback
        focusResortByName(onlyName);
      }

      // Mobile/Touch: Form-Submit + Button
      if (searchForm) {
        searchForm.addEventListener("submit", (e) => {
          e.preventDefault();
          performSearch();
          try { searchInput.blur(); } catch (_) {}
        });
      }
      if (searchBtn) {
        searchBtn.addEventListener("click", (e) => {
          // click löst ohnehin submit aus, aber falls das Markup anders ist: fallback
          if (searchForm) return;
          e.preventDefault();
          performSearch();
          try { searchInput.blur(); } catch (_) {}
        });
      }

      // Desktop: Enter bleibt erhalten
      searchInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        performSearch();
      });

    }

    // -------- Fahrzeit-Slider --------
    function updateTimeLabel(pct) {
      if (!timeLabel) return;
      const t = window.i18n ? window.i18n.t : (k) => k;

    if (pct >= 99) {
      const maxHours = getMaxHours();
      timeLabel.textContent = t('approx', { time: fmtTime(maxHours) });
      return;
    }

      const minHours = getMinHours();
      const maxHours = getMaxHours();
      const limitHours = minHours + (pct / 100) * (maxHours - minHours);
      timeLabel.textContent = t('upToApprox', { time: fmtTime(limitHours) });
    }

    function applyFilters(pct) {
      currentPct = pct;

      Object.values(resorts).forEach(r => {
        const key = norm(r.name);
        const marker = resortMarkers[key];
        if (!marker) return;

        const inside = resortPassesAllFilters(r, pct);

        if (inside) {
          if (!markerLayer.hasLayer(marker)) markerLayer.addLayer(marker);
        } else {
          if (markerLayer.hasLayer(marker)) markerLayer.removeLayer(marker);
        }
      });

      // Re-hide markers that are in snowHiddenResorts (snow filter uses display:none)
      const snowHidden = window.snowHiddenResorts;
      if (snowHidden?.size > 0) {
        snowHidden.forEach(name => {
          const marker = resortMarkers[norm(name)];
          if (marker && markerLayer.hasLayer(marker)) {
            if (marker._icon) marker._icon.style.display = 'none';
            if (marker._path) marker._path.style.display = 'none';
          }
        });
      }

      if (typeof updateResortCounter === "function") updateResortCounter();
    }

    if (timeSlider) {
      timeSlider.addEventListener("input", (e) => {
        const pct = Number(e.target.value);
        updateTimeLabel(pct);
        applyFilters(pct);
      });
    }

    // Event-Listener für neue Filter-Slider
    if (pistesSlider) {
      pistesSlider.addEventListener("input", (e) => {
        filterValues.pistes = sliderPctToValue(Number(e.target.value), filterRanges.pistes);
        updateFilterSliderLabels();
        applyFilters(currentPct);
      });
    }

    if (liftsSlider) {
      liftsSlider.addEventListener("input", (e) => {
        filterValues.lifts = sliderPctToValue(Number(e.target.value), filterRanges.lifts);
        updateFilterSliderLabels();
        applyFilters(currentPct);
      });
    }

    if (elevationSlider) {
      elevationSlider.addEventListener("input", (e) => {
        filterValues.elevation = sliderPctToValue(Number(e.target.value), filterRanges.elevation);
        updateFilterSliderLabels();
        applyFilters(currentPct);
      });
    }

    // -------- Export --------
    function getVisibleResorts() {
      const out = [];
      const snowHidden = window.snowHiddenResorts;
      for (const r of Object.values(resorts)) {
        const key = norm(r.name);
        const marker = resortMarkers[key];
        if (!marker) continue;
        if (!markerLayer.hasLayer(marker)) continue;
        if (snowHidden?.has(r.name)) continue;
        out.push(r);
      }
      out.sort((a, b) => a.name.localeCompare(b.name, "de"));
      return out;
    }

    function exportVisibleToCsv() {
      const rows = getVisibleResorts();
      downloadText("skigebiete-filter.csv", "text/csv;charset=utf-8", toCsv(rows));
    }

    function exportVisibleToKml() {
      const rows = getVisibleResorts();
      downloadText("skigebiete-filter.kml", "application/vnd.google-earth.kml+xml;charset=utf-8", toKml(rows));
    }

    const btnCsv = document.getElementById(exportCsvBtnId);
    if (btnCsv) btnCsv.addEventListener("click", exportVisibleToCsv);

    const btnKml = document.getElementById(exportKmlBtnId);
    if (btnKml) btnKml.addEventListener("click", exportVisibleToKml);

    // ---------- init ----------
    updateVerbundUi();
    rebuildDatalist();
    updateTimeLabel(currentPct);
    computeFilterRanges();
    updateFilterSliderLabels();
    applyFilters(currentPct);

    return {
      rebuildDatalist,
      focusResortByName,
      extractResortName,
      updateTimeLabel,
      applyFilters,
      applyTimeFilter: applyFilters,
      getVisibleResorts,
      exportVisibleToCsv,
      exportVisibleToKml,
      computeFilterRanges,
      updateFilterSliderLabels,
      resetStatSliders: function() {
        filterValues.pistes = 10;  // Default: 10km
        filterValues.lifts = 0;
        filterValues.elevation = 0;
        const valueToPct = (val, range) => Math.round(((val - range.min) / (range.max - range.min)) * 100);
        if (pistesSlider) pistesSlider.value = valueToPct(10, filterRanges.pistes);
        if (liftsSlider) liftsSlider.value = 0;
        if (elevationSlider) elevationSlider.value = 0;
        updateFilterSliderLabels();
      }
    };
  }

  window.initSearchAndFilters = initSearchAndFilters;
})();
