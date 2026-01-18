// js/i18n.js
// Lightweight i18n system for Skigebiete Karte
// Supports DE and EN with localStorage persistence

(function () {
  "use strict";

  // Config-Werte mit Fallback falls config.js noch nicht geladen
  const CFG = window.APP_CONFIG || {};
  const STORAGE_KEY = CFG.storageKeys?.language || "skimap.language";
  const SUPPORTED_LANGS = ["de", "en"];
  const DEFAULT_LANG = CFG.ui?.language || "de";

  // All translations
  const translations = {
    de: {
      // Page title
      pageTitle: "Ski-Pässe: Snow Card Tirol & SuperSkiCard",

      // Search box
      searchPlaceholder: "Let's...",
      searchExecute: "Suche ausführen",
      go: "Go",
      clearFilter: "Verbundfilter aufheben",
      openFilters: "Filter und Layer öffnen",
      filterActiveTemplate: "Filter aktiv: {name} (Button zum Aufheben)",
      searchResort: "Skigebiet suchen",

      // Slider box
      travelTimeAndFilter: "Fahrzeit & Filter",
      maxTravelTime: "Max. Fahrzeit",
      selectStartpoint: "Startpunkt auswählen",
      useGps: "GPS-Standort verwenden",
      addressOrCoords: "Adresse oder lat,lon",
      calculateTimes: "Fahrzeiten berechnen",
      upToApprox: "bis ca. {time}",
      approx: "ca. {time}",
      maxTravelTimeFrom: "Max. Fahrzeit ab {name}",
      startAddress: "Startadresse (Adresse oder lat,lon)",
      exampleAddress: "z.B. München, Marienplatz oder 48.12,11.57",
      sliderToggle: "Slider ein-/ausklappen",

      // Filter sliders
      minPistes: "Min. Pistenkilometer",
      minLifts: "Min. Lifte",
      minElevation: "Min. Höhe",

      // Filter box
      filter: "Filter",
      countries: "Länder",
      austria: "Österreich",
      germany: "Deutschland",
      switzerland: "Schweiz",
      italy: "Italien",
      france: "Frankreich",
      slovenia: "Slowenien",
      international: "International",
      highlight: "Highlight",
      favorites: "Favoriten",
      visited: "Besucht",
      snowCardTirol: "Snow Card Tirol",
      superSkiCard: "SuperSkiCard",
      bothPasses: "Beide Pässe",
      moreSkiPasses: "Weitere Skipässe...",
      glacier: "Gletscher",
      verbunde: "Verbünde",
      other: "Sonstige",
      onlyHighlights: "Nur Highlights",
      darkMode: "Dark Mode",
      settings: "Einstellungen",

      // Export box
      export: "Export",
      visibleResorts: "Sichtbare Resorts",
      personalData: "Persönliche Daten",
      exportFavVisited: "Exportieren",
      importFavVisited: "Importieren",
      importSuccess: "Import erfolgreich!\n{fav} Favoriten\n{vis} besuchte Gebiete",
      importFailed: "Import fehlgeschlagen. Ungültiges Dateiformat.",

      // GPS
      gps: "GPS",
      showPosition: "Position anzeigen",
      centerOnPosition: "Auf meine Position zentrieren",
      center: "Zentrieren",
      youAreHere: "Du bist hier",
      gpsShowPosition: "GPS Position anzeigen",
      gpsActiveClickToCenter: "GPS aktiv – Klick zum Zentrieren",
      locationError: "Standort konnte nicht ermittelt werden. Prüfe Standortfreigabe.",
      locationErrorHttps: "Standort konnte nicht ermittelt werden. Prüfe Standortfreigabe und ob die Seite über HTTPS läuft.",

      // Weather box
      snowAndWeather: "❄️ Schnee & Wetter",
      snowDisplay: "Schnee-Anzeige",
      snowForecast: "Schnee-Vorhersage",
      day: "Tag",
      sumUntil: "Σ bis",
      onlyThisDay: "Nur dieser Tag",
      sumUntilThisDay: "Summe bis zu diesem Tag",
      legend: "Legende",
      legendSnowForecast: "Legende (Neuschnee-Prognose)",
      legendToday: "Legende (Heute)",
      legendSumUntil: "Legende (Σ bis {day})",
      legendDay: "Legende ({day})",
      dataSourceInfo: "Datenquellen-Info",
      mode: "Modus",
      elevation: "Höhe",
      mountain: "Berg",
      valley: "Tal",
      best: "Max",
      snowLimit: "Schneefallgrenze",
      snowEverywhere: "Schnee überall",
      snowOnlyTop: "Nur am Berg",
      noSnow: "Kein Schnee",
      todayShort: "Heu",
      weatherToggle: "Wetter ein-/ausklappen",

      // Weather info dialog
      weatherInfoTitle: "🌨️ Schnee & Wetter Info",
      weatherInfoSelection: "📍 Auswahl: {mode}",
      weatherInfoData: "Daten: {status} ({age})",
      weatherInfoDataCurrent: "Aktuell",
      weatherInfoDataOlder: "Etwas älter",
      weatherInfoDataOutdated: "Veraltet",
      weatherInfoNoData: "Keine Daten",
      weatherInfoNotAvailable: "Nicht verfügbar",
      weatherInfoMode: "🔘 Modus:",
      weatherInfoModeDay: '"Tag" = Nur Schnee für diesen Tag',
      weatherInfoModeSum: '"Σ bis" = Summe bis zu diesem Tag',
      snowIndicator: "Schnee-Indikatoren",
      weatherInfoDots: "Farbige Punkte unter den Tagen zeigen,\nwo irgendwo in den Alpen ≥10cm Schnee fällt.\nFarbe = Maximum an dem Tag.\n(Gilt für beide Modi: Tag & Σ bis)",
      weatherInfoSlider: "🎚️ Schnee-Vorhersage ({value}):",
      weatherInfoSliderDesc: "Filtert Skigebiete nach erwartetem\nNeuschnee. Gebiete unter dem Wert\nwerden auf der Karte ausgeblendet.",
      weatherInfoSource: "📡 Datenquelle:",
      weatherInfoSourceOpenMeteo: "Open-Meteo - 16-Tage-Prognose",
      weatherInfoResorts: "{count} Skigebiete",
      weatherInfoAutoUpdates: "📡 Auto-Updates: 07:00, 12:30 & 19:00 Uhr",
      weatherInfoOff: "aus",
      lastUpdate: "Stand",
      justNow: "gerade eben",

      // Day labels
      today: "Heute",
      tomorrow: "Morgen",
      dayAfterTomorrow: "Übermorgen",
      inDays: "in {n} Tagen",

      // Time periods
      hours24: "24h",
      hours48: "48h",
      days3: "3T",
      days7: "7T",

      // Popup
      glacierResort: "Gletscherskigebiet",
      addToFavorites: "Zu Favoriten hinzufügen",
      removeFromFavorites: "Aus Favoriten entfernen",
      markAsVisited: "Als besucht markieren",
      markAsNotVisited: "Als nicht besucht markieren",
      showAccessPoints: "Einstiege auf Karte anzeigen",
      searchParking: "Parkplätze bei {name} suchen",
      forecast48h: "48h-Prognose",
      forecast16d: "16-Tage-Prognose",
      time: "Zeit",
      snow: "Schnee",
      temp: "Temp",
      pistenKm: "Pistenkilometer",
      lifts: "Lifte",
      elevation: "Höhe",
      travelTime: "Fahrzeit",
      distance: "Distanz",

      // Verbund-Popup
      groupBadge: "VERBUND",
      skiResorts: "Skigebiete",
      maxElevation: "Max. Höhe",
      andMore: "+ {count} weitere",

      // KML export
      travelTimeH: "Fahrzeit (h)",
      distanceKm: "Distanz (km)",
      website: "Website",
      skiResortsExport: "Skigebiete Export",

      // Alerts
      noResortFound: "Kein Skigebiet gefunden für: {query}",
      noGroupFound: "Kein Verbund gefunden für: {query}",
      errorFetchingTimes: "Fehler beim Abrufen der Fahrzeiten (Details in Konsole).",

      // Favorites/Visited (console messages, less critical)
      favoritesLoadError: "Favoriten konnten nicht geladen werden",
      favoritesSaveError: "Favoriten konnten nicht gespeichert werden",
      visitedLoadError: "Besucht-Daten konnten nicht geladen werden",
      visitedSaveError: "Besucht-Daten konnten nicht gespeichert werden",
      invalidFormat: "Ungültiges Format",
      importError: "Import fehlgeschlagen",

      // Home selector
      noSelectFound: "kein <select> gefunden",
      homesLoadError: "homes.json konnte nicht geladen werden",

      // Counter
      resortsVisible: "{count} Skigebiete",

      // Relative time
      minutesAgo: "vor {n} Minuten",
      hoursAgo: "vor {n} Stunden",
      daysAgo: "vor {n} Tagen",

      // Language switcher
      language: "Sprache",
      german: "Deutsch",
      english: "English",

      // Layer control
      layers: "Layer",
      baseMaps: "Basiskarten",
      overlays: "Overlays",
      treeRoutes: "Baum-Routen",
      corridor: "Korridor",

      // Mobile panel
      filtersAndLayers: "Filter & Layer",
      close: "Schließen",

      // Units
      km: "km",
      m: "m",
      h: "h",
      cm: "cm",

      // Popup additional
      hourly: "stündlich",
      daily: "täglich",
      accessPoints: "Einstiege",
      passes: "Pässe",
      noPasses: "Keine Pässe",
      travelTimeLabel: "Anfahrt",
      dayNames: "So,Mo,Di,Mi,Do,Fr,Sa",
      pistes: "Pisten",
      gondolas: "Gondeln",
      chairlifts: "Sessel",
      draglifts: "Schlepp",
      season: "Saison",
      operation: "Betrieb",
      noData: "keine Angabe",
      approxShort: "ca.",

      // Travel time info
      travelTimeInfoTitle: "🚗 Fahrzeit-Info",
      travelTimeInfoHow: "Wie wird die Fahrzeit berechnet?",
      travelTimeInfoExplain: "Die Fahrzeiten werden mit OSRM (Open Source Routing Machine) vorberechnet. Für jeden Startpunkt im Dropdown werden Routen zu allen Skigebieten berechnet und gespeichert.",
      travelTimeInfoRegion: "📍 Abgedeckte Region:",
      travelTimeInfoRegionDesc: "Alpen-Bounding-Box (Lat 43.5°-48.5°, Lon 5°-17°). Skigebiete außerhalb dieser Region haben keine Fahrzeiten.",
      travelTimeInfoCount: "{count} von {total} Skigebieten haben Fahrzeiten",
      travelTimeInfoShowBbox: "Alps-Bbox auf Karte anzeigen",
      travelTimeInfoHideBbox: "Alps-Bbox ausblenden",
      travelTimeInfoGps: "📍 GPS / Manuelle Eingabe:",
      travelTimeInfoGpsDesc: "Bei GPS-Standort oder manueller Adresse werden Fahrzeiten live über OpenRouteService berechnet (keine vorberechneten Routen).",
      travelTimeInfoDifference: "📊 Unterschied der Berechnungsmethoden",
      travelTimeInfoPreCalc: "Vorberechnet (Dropdown)",
      travelTimeInfoLive: "Live (Adressfeld/GPS)",
      travelTimeInfoRowEngine: "Routing-Engine",
      travelTimeInfoRowEnginePreCalc: "OSRM (lokal)",
      travelTimeInfoRowEngineLive: "OpenRouteService (API)",
      travelTimeInfoRowRoutes: "Routen-Geometrie",
      travelTimeInfoRowRoutesPreCalc: "✅ Ja (Linie auf Karte)",
      travelTimeInfoRowRoutesLive: "❌ Nein (nur Fahrzeiten)",
      travelTimeInfoRowCoverage: "Abdeckung",
      travelTimeInfoRowCoveragePreCalc: "1160 Alps-Resorts",
      travelTimeInfoRowCoverageLive: "Alle Resorts",
      travelTimeInfoRowSpeed: "Geschwindigkeit",
      travelTimeInfoRowSpeedPreCalc: "Schnell (JSON-Datei)",
      travelTimeInfoRowSpeedLive: "Langsamer (API-Call)"
    },

    en: {
      // Page title
      pageTitle: "Ski Passes: Snow Card Tirol & SuperSkiCard",

      // Search box
      searchPlaceholder: "Search...",
      searchExecute: "Execute search",
      go: "Go",
      clearFilter: "Clear group filter",
      openFilters: "Open filters and layers",
      filterActiveTemplate: "Filter active: {name} (click to clear)",
      searchResort: "Search ski resort",

      // Slider box
      travelTimeAndFilter: "Travel Time & Filter",
      maxTravelTime: "Max. Travel Time",
      selectStartpoint: "Select starting point",
      useGps: "Use GPS location",
      addressOrCoords: "Address or lat,lon",
      calculateTimes: "Calculate travel times",
      upToApprox: "up to ~{time}",
      approx: "~{time}",
      maxTravelTimeFrom: "Max. travel time from {name}",
      startAddress: "Start address (address or lat,lon)",
      exampleAddress: "e.g. Munich, Marienplatz or 48.12,11.57",
      sliderToggle: "Toggle slider",

      // Filter sliders
      minPistes: "Min. Piste Length",
      minLifts: "Min. Lifts",
      minElevation: "Min. Elevation",

      // Filter box
      filter: "Filter",
      countries: "Countries",
      austria: "Austria",
      germany: "Germany",
      switzerland: "Switzerland",
      italy: "Italy",
      france: "France",
      slovenia: "Slovenia",
      international: "International",
      highlight: "Highlight",
      favorites: "Favorites",
      visited: "Visited",
      snowCardTirol: "Snow Card Tirol",
      superSkiCard: "SuperSkiCard",
      bothPasses: "Both Passes",
      moreSkiPasses: "More ski passes...",
      glacier: "Glacier",
      verbunde: "Groups",
      other: "Other",
      onlyHighlights: "Only Highlights",
      darkMode: "Dark Mode",
      settings: "Settings",

      // Export box
      export: "Export",
      visibleResorts: "Visible Resorts",
      personalData: "Personal Data",
      exportFavVisited: "Export",
      importFavVisited: "Import",
      importSuccess: "Import successful!\n{fav} favorites\n{vis} visited resorts",
      importFailed: "Import failed. Invalid file format.",

      // GPS
      gps: "GPS",
      showPosition: "Show position",
      centerOnPosition: "Center on my position",
      center: "Center",
      youAreHere: "You are here",
      gpsShowPosition: "Show GPS position",
      gpsActiveClickToCenter: "GPS active – click to center",
      locationError: "Could not determine location. Check location permissions.",
      locationErrorHttps: "Could not determine location. Check location permissions and that the page is served over HTTPS.",

      // Weather box
      snowAndWeather: "❄️ Snow & Weather",
      snowDisplay: "Snow Display",
      snowForecast: "Snow Forecast",
      day: "Day",
      sumUntil: "Σ to",
      onlyThisDay: "Only this day",
      sumUntilThisDay: "Sum up to this day",
      legend: "Legend",
      legendSnowForecast: "Legend (Snow Forecast)",
      legendToday: "Legend (Today)",
      legendSumUntil: "Legend (Σ to {day})",
      legendDay: "Legend ({day})",
      dataSourceInfo: "Data Source Info",
      mode: "Mode",
      elevation: "Elev.",
      mountain: "Top",
      valley: "Base",
      best: "Max",
      snowLimit: "Snow line",
      snowEverywhere: "Snow everywhere",
      snowOnlyTop: "Summit only",
      noSnow: "No snow",
      todayShort: "Tod",
      weatherToggle: "Toggle weather",

      // Weather info dialog
      weatherInfoTitle: "🌨️ Snow & Weather Info",
      weatherInfoSelection: "📍 Selection: {mode}",
      weatherInfoData: "Data: {status} ({age})",
      weatherInfoDataCurrent: "Current",
      weatherInfoDataOlder: "Somewhat older",
      weatherInfoDataOutdated: "Outdated",
      weatherInfoNoData: "No data",
      weatherInfoNotAvailable: "Not available",
      weatherInfoMode: "🔘 Mode:",
      weatherInfoModeDay: '"Day" = Only snow for this day',
      weatherInfoModeSum: '"Σ to" = Sum up to this day',
      snowIndicator: "Snow Indicators",
      weatherInfoDots: "Colored dots below days indicate\nwhere ≥10cm snow falls anywhere in the Alps.\nColor = maximum for that day.\n(Works in both modes: Day & Σ to)",
      weatherInfoSlider: "🎚️ Snow Forecast ({value}):",
      weatherInfoSliderDesc: "Filters ski resorts by expected\nsnowfall. Resorts below the\nthreshold are hidden on the map.",
      weatherInfoSource: "📡 Data source:",
      weatherInfoSourceOpenMeteo: "Open-Meteo - 16-day forecast",
      weatherInfoResorts: "{count} ski resorts",
      weatherInfoAutoUpdates: "📡 Auto-Updates: 07:00, 12:30 & 19:00 CET",
      weatherInfoOff: "off",
      lastUpdate: "Last update",
      justNow: "just now",

      // Day labels
      today: "Today",
      tomorrow: "Tomorrow",
      dayAfterTomorrow: "Day after tomorrow",
      inDays: "in {n} days",

      // Time periods
      hours24: "24h",
      hours48: "48h",
      days3: "3d",
      days7: "7d",

      // Popup
      glacierResort: "Glacier ski resort",
      addToFavorites: "Add to favorites",
      removeFromFavorites: "Remove from favorites",
      markAsVisited: "Mark as visited",
      markAsNotVisited: "Mark as not visited",
      showAccessPoints: "Show access points on map",
      searchParking: "Search parking at {name}",
      forecast48h: "48h Forecast",
      forecast16d: "16-Day Forecast",
      time: "Time",
      snow: "Snow",
      temp: "Temp",
      pistenKm: "Piste length",
      lifts: "Lifts",
      elevation: "Elevation",
      travelTime: "Travel time",
      distance: "Distance",

      // Verbund-Popup
      groupBadge: "GROUP",
      skiResorts: "Ski Resorts",
      maxElevation: "Max. Elevation",
      andMore: "+ {count} more",

      // KML export
      travelTimeH: "Travel time (h)",
      distanceKm: "Distance (km)",
      website: "Website",
      skiResortsExport: "Ski Resorts Export",

      // Alerts
      noResortFound: "No ski resort found for: {query}",
      noGroupFound: "No group found for: {query}",
      errorFetchingTimes: "Error fetching travel times (see console for details).",

      // Favorites/Visited (console messages, less critical)
      favoritesLoadError: "Could not load favorites",
      favoritesSaveError: "Could not save favorites",
      visitedLoadError: "Could not load visited data",
      visitedSaveError: "Could not save visited data",
      invalidFormat: "Invalid format",
      importError: "Import failed",

      // Home selector
      noSelectFound: "no <select> found",
      homesLoadError: "Could not load homes.json",

      // Counter
      resortsVisible: "{count} ski resorts",

      // Relative time
      minutesAgo: "{n} minutes ago",
      hoursAgo: "{n} hours ago",
      daysAgo: "{n} days ago",

      // Language switcher
      language: "Language",
      german: "Deutsch",
      english: "English",

      // Layer control
      layers: "Layers",
      baseMaps: "Base Maps",
      overlays: "Overlays",
      treeRoutes: "Tree Routes",
      corridor: "Corridor",

      // Mobile panel
      filtersAndLayers: "Filters & Layers",
      close: "Close",

      // Units
      km: "km",
      m: "m",
      h: "h",
      cm: "cm",

      // Popup additional
      hourly: "hourly",
      daily: "daily",
      accessPoints: "Access points",
      passes: "Passes",
      noPasses: "No passes",
      travelTimeLabel: "Travel",
      dayNames: "Sun,Mon,Tue,Wed,Thu,Fri,Sat",
      pistes: "Pistes",
      gondolas: "Gondolas",
      chairlifts: "Chairlifts",
      draglifts: "Drag lifts",
      season: "Season",
      operation: "Operation",
      noData: "no data",
      approxShort: "~",

      // Travel time info
      travelTimeInfoTitle: "🚗 Travel Time Info",
      travelTimeInfoHow: "How is travel time calculated?",
      travelTimeInfoExplain: "Travel times are pre-calculated using OSRM (Open Source Routing Machine). For each starting point in the dropdown, routes to all ski resorts are calculated and stored.",
      travelTimeInfoRegion: "📍 Covered Region:",
      travelTimeInfoRegionDesc: "Alps bounding box (Lat 43.5°-48.5°, Lon 5°-17°). Ski resorts outside this region have no travel times.",
      travelTimeInfoCount: "{count} of {total} ski resorts have travel times",
      travelTimeInfoShowBbox: "Show Alps bbox on map",
      travelTimeInfoHideBbox: "Hide Alps bbox",
      travelTimeInfoGps: "📍 GPS / Manual Input:",
      travelTimeInfoGpsDesc: "When using GPS location or manual address, travel times are calculated live via OpenRouteService (no pre-calculated routes).",
      travelTimeInfoDifference: "📊 Difference Between Methods",
      travelTimeInfoPreCalc: "Pre-calculated (Dropdown)",
      travelTimeInfoLive: "Live (Address/GPS)",
      travelTimeInfoRowEngine: "Routing Engine",
      travelTimeInfoRowEnginePreCalc: "OSRM (local)",
      travelTimeInfoRowEngineLive: "OpenRouteService (API)",
      travelTimeInfoRowRoutes: "Route Geometry",
      travelTimeInfoRowRoutesPreCalc: "✅ Yes (line on map)",
      travelTimeInfoRowRoutesLive: "❌ No (times only)",
      travelTimeInfoRowCoverage: "Coverage",
      travelTimeInfoRowCoveragePreCalc: "1160 Alps resorts",
      travelTimeInfoRowCoverageLive: "All resorts",
      travelTimeInfoRowSpeed: "Speed",
      travelTimeInfoRowSpeedPreCalc: "Fast (JSON file)",
      travelTimeInfoRowSpeedLive: "Slower (API call)"
    }
  };

  // Current language
  let currentLang = DEFAULT_LANG;

  // Initialize language from storage or browser
  function initLang() {
    // 1. Check localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_LANGS.includes(stored)) {
        currentLang = stored;
        return;
      }
    } catch (_) {}

    // 2. Check browser language
    try {
      const browserLang = (navigator.language || navigator.userLanguage || "").split("-")[0].toLowerCase();
      if (SUPPORTED_LANGS.includes(browserLang)) {
        currentLang = browserLang;
        return;
      }
    } catch (_) {}

    // 3. Default
    currentLang = DEFAULT_LANG;
  }

  // Get current language
  function getLang() {
    return currentLang;
  }

  // Set language and persist
  function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) {
      console.warn("i18n: Unsupported language:", lang);
      return false;
    }

    currentLang = lang;

    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}

    // Update HTML lang attribute
    document.documentElement.lang = lang;

    // Dispatch event for UI updates
    window.dispatchEvent(new CustomEvent("language-changed", { detail: { lang } }));

    return true;
  }

  // Toggle between DE and EN
  function toggleLang() {
    const newLang = currentLang === "de" ? "en" : "de";
    setLang(newLang);
    return newLang;
  }

  // Get translation with variable substitution
  function t(key, vars = {}) {
    const dict = translations[currentLang] || translations[DEFAULT_LANG];
    let text = dict[key];

    // Fallback to default language
    if (text === undefined) {
      text = translations[DEFAULT_LANG][key];
    }

    // Fallback to key itself
    if (text === undefined) {
      console.warn("i18n: Missing translation for key:", key);
      return key;
    }

    // Substitute variables: {name} -> value
    if (vars && typeof vars === "object") {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      });
    }

    return text;
  }

  // Format relative time (e.g., "vor 3 Stunden" / "3 hours ago")
  function formatRelativeTime(date) {
    if (!date) return "";

    const now = new Date();
    const then = date instanceof Date ? date : new Date(date);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return t("minutesAgo", { n: diffMins });
    } else if (diffHours < 24) {
      return t("hoursAgo", { n: diffHours });
    } else {
      return t("daysAgo", { n: diffDays });
    }
  }

  // Get day label (Heute, Morgen, in 3 Tagen, etc.)
  function getDayLabel(dayIndex) {
    if (dayIndex === 0) return t("today");
    if (dayIndex === 1) return t("tomorrow");
    if (dayIndex === 2) return t("dayAfterTomorrow");
    return t("inDays", { n: dayIndex });
  }

  // Initialize on load
  initLang();

  // Export API
  window.i18n = {
    t,
    getLang,
    setLang,
    toggleLang,
    formatRelativeTime,
    getDayLabel,
    SUPPORTED_LANGS
  };
})();
