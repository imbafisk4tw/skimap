// js/config.js
// Zentrale Konfiguration für Skigebiete Karte
// Diese Werte dienen als Defaults und können später durch User-Settings überschrieben werden

window.APP_CONFIG = {
  // ===== API Keys =====
  ORS_API_KEY: "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImRhZjIxYzViN2RhZjQ1ZmNhZGY4ZjNlZThhZjEzODE3IiwiaCI6Im11cm11cjY0In0=",

  // ===== Karte =====
  map: {
    center: [46.8, 11.0],       // Zentriert über den Alpen
    zoomDesktop: 7,
    zoomMobile: 7,
    defaultBasemap: "osm",      // osm, satellite, clean, terrain, topo, grey
    defaultOverlays: ["hillshade"]  // hillshade, slopes
  },

  // ===== Startpunkt (Home) =====
  home: {
    defaultId: "muc",           // München als Default
    storageKey: "skimap.selectedHomeId"
  },

  // ===== Fahrzeit & Filter-Slider =====
  sliders: {
    travelTime: 100,            // 100% = alle anzeigen
    minElevation: 0,            // Meter
    minPistes: 0,               // km
    minLifts: 0                 // Anzahl
  },

  // ===== Wetter/Schnee =====
  weather: {
    enabled: true,
    dayIndex: 7,                // +7 Tage (Wochenübersicht)
    cumulative: true,           // true = Σ bis, false = einzelner Tag
    minSnowCm: 0,
    location: "mountain"        // mountain, valley, best
  },

  // ===== Länder-Filter =====
  countries: {
    AT: true,
    DE: true,
    CH: true,
    IT: true,
    FR: true,
    SI: true
  },

  // ===== Highlight-Filter =====
  highlights: {
    favorites: false,
    visited: false,
    glacier: false,
    verbunde: false,
    sct: false,                 // Snow Card Tirol
    ssc: false,                 // SuperSkiCard
    both: false                 // Beide Pässe
  },

  // ===== Sonstige Filter =====
  filters: {
    onlyHighlights: false
  },

  // ===== UI =====
  ui: {
    darkMode: false,
    language: "de",             // de, en
    filterBoxCollapsed: true,
    sliderBoxCollapsedMobile: true,
    sliderBoxCollapsedDesktop: false,
    weatherBoxCollapsed: false,
    bottomSheetState: "peek"    // peek, half, full (Mobile)
  },

  // ===== Marker-Farben =====
  colors: {
    // Pässe
    SCT: "#9C2419",             // Snow Card Tirol (Rot)
    SSC: "#004A8F",             // SuperSkiCard (Blau)
    BOTH: "#9C27B0",            // Beide Pässe (Violett)
    OTHER: "#888888",           // Kein Pass (Grau)
    // Länder
    AT: "#C08080",              // Österreich (Verblasstes Rot)
    DE: "#C9B037",              // Deutschland (Sand)
    CH: "#9E9E9E",              // Schweiz (Mittelgrau)
    IT: "#7D8B6A",              // Italien (Gedämpftes Olivgrün)
    FR: "#7896A8",              // Frankreich (Blaugrau)
    SI: "#6BA3A0"               // Slowenien (Gedämpftes Türkis)
  },

  // ===== Dark Mode Filter =====
  darkModeFilter: "saturate(0.55) brightness(0.18) contrast(0.92)",

  // ===== localStorage Keys =====
  storageKeys: {
    language: "skimap.language",
    selectedHome: "skimap.selectedHomeId",
    favorites: "skimap.favorites",
    visited: "skimap.visited",
    userSettings: "skimap.userSettings"  // Für zukünftige User-Settings
  }
};

// ===== Helper: User-Settings laden und mit Defaults mergen =====
window.getSettings = function() {
  const defaults = window.APP_CONFIG;
  try {
    const stored = localStorage.getItem(defaults.storageKeys.userSettings);
    if (stored) {
      const userSettings = JSON.parse(stored);
      // Deep merge (einfache Version - überschreibt nur top-level keys)
      return { ...defaults, ...userSettings };
    }
  } catch (e) {
    console.warn("Could not load user settings:", e);
  }
  return defaults;
};

// ===== Helper: User-Settings speichern =====
window.saveUserSettings = function(settings) {
  try {
    // Nur die Abweichungen von den Defaults speichern (optional, spart Platz)
    localStorage.setItem(window.APP_CONFIG.storageKeys.userSettings, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.warn("Could not save user settings:", e);
    return false;
  }
};
