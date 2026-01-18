(function () {
  "use strict";

  // --- Favoriten-Verwaltung mit localStorage ---
  const STORAGE_KEY = "skimap_favorites";

  // Set für schnellen Lookup
  let favorites = new Set();

  // Lädt Favoriten aus localStorage
  function loadFavorites() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          favorites = new Set(arr);
        }
      }
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.warn(t('favoritesLoadError') + ":", e);
      favorites = new Set();
    }
    return favorites;
  }

  // Speichert Favoriten in localStorage
  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.warn(t('favoritesSaveError') + ":", e);
    }
  }

  // Prüft ob ein Resort ein Favorit ist
  function isFavorite(stableId) {
    return favorites.has(stableId);
  }

  // Fügt ein Resort zu den Favoriten hinzu
  function addFavorite(stableId) {
    if (!stableId) return false;
    favorites.add(stableId);
    saveFavorites();
    window.dispatchEvent(new CustomEvent("favorites-changed", { detail: { stableId, action: "add" } }));
    return true;
  }

  // Entfernt ein Resort aus den Favoriten
  function removeFavorite(stableId) {
    if (!stableId) return false;
    const removed = favorites.delete(stableId);
    if (removed) {
      saveFavorites();
      window.dispatchEvent(new CustomEvent("favorites-changed", { detail: { stableId, action: "remove" } }));
    }
    return removed;
  }

  // Toggle Favoriten-Status
  function toggleFavorite(stableId) {
    if (isFavorite(stableId)) {
      removeFavorite(stableId);
      return false;
    } else {
      addFavorite(stableId);
      return true;
    }
  }

  // Gibt alle Favoriten als Array zurück
  function getAllFavorites() {
    return [...favorites];
  }

  // Gibt die Anzahl der Favoriten zurück
  function getFavoriteCount() {
    return favorites.size;
  }

  // Exportiert Favoriten als JSON-String
  function exportFavorites() {
    return JSON.stringify({
      version: 1,
      exported: new Date().toISOString(),
      favorites: [...favorites]
    }, null, 2);
  }

  // Importiert Favoriten aus JSON-String (merged mit bestehenden)
  function importFavorites(jsonString, replace = false) {
    try {
      const data = JSON.parse(jsonString);
      let imported = [];

      // Unterstütze verschiedene Formate
      if (Array.isArray(data)) {
        imported = data;
      } else if (data.favorites && Array.isArray(data.favorites)) {
        imported = data.favorites;
      } else {
        const t = window.i18n ? window.i18n.t : (k) => k;
        throw new Error(t('invalidFormat'));
      }

      if (replace) {
        favorites = new Set(imported);
      } else {
        imported.forEach(id => favorites.add(id));
      }

      saveFavorites();
      window.dispatchEvent(new CustomEvent("favorites-changed", { detail: { action: "import" } }));
      return imported.length;
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.error(t('importError') + ":", e);
      return -1;
    }
  }

  // Initial laden
  loadFavorites();

  // API exportieren
  window.Favorites = {
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    getAllFavorites,
    getFavoriteCount,
    exportFavorites,
    importFavorites,
    reload: loadFavorites
  };

  // --- Besucht-Verwaltung mit localStorage (inkl. Timestamp) ---
  const VISITED_STORAGE_KEY = "skimap_visited";

  // Map: stableId -> { visitedAt: ISO-String, notes?: string }
  let visited = new Map();

  // Lädt Visited aus localStorage
  function loadVisited() {
    try {
      const stored = localStorage.getItem(VISITED_STORAGE_KEY);
      if (stored) {
        const obj = JSON.parse(stored);
        if (obj && typeof obj === "object") {
          visited = new Map(Object.entries(obj));
        }
      }
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.warn(t('visitedLoadError') + ":", e);
      visited = new Map();
    }
    return visited;
  }

  // Speichert Visited in localStorage
  function saveVisited() {
    try {
      localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify(Object.fromEntries(visited)));
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.warn(t('visitedSaveError') + ":", e);
    }
  }

  // Prüft ob ein Resort besucht wurde
  function isVisited(stableId) {
    return visited.has(stableId);
  }

  // Markiert ein Resort als besucht
  function markVisited(stableId, timestamp = null) {
    if (!stableId) return false;
    visited.set(stableId, {
      visitedAt: timestamp || new Date().toISOString()
    });
    saveVisited();
    window.dispatchEvent(new CustomEvent("visited-changed", { detail: { stableId, action: "add" } }));
    return true;
  }

  // Entfernt ein Resort aus den Besuchten
  function unmarkVisited(stableId) {
    if (!stableId) return false;
    const removed = visited.delete(stableId);
    if (removed) {
      saveVisited();
      window.dispatchEvent(new CustomEvent("visited-changed", { detail: { stableId, action: "remove" } }));
    }
    return removed;
  }

  // Toggle Besucht-Status
  function toggleVisited(stableId) {
    if (isVisited(stableId)) {
      unmarkVisited(stableId);
      return false;
    } else {
      markVisited(stableId);
      return true;
    }
  }

  // Gibt Besucht-Info für ein Resort zurück
  function getVisitedInfo(stableId) {
    return visited.get(stableId) || null;
  }

  // Gibt alle besuchten Resorts als Array zurück
  function getAllVisited() {
    return [...visited.keys()];
  }

  // Gibt die Anzahl der besuchten Resorts zurück
  function getVisitedCount() {
    return visited.size;
  }

  // Exportiert Visited-Daten als JSON-String
  function exportVisited() {
    return JSON.stringify({
      version: 1,
      exported: new Date().toISOString(),
      visited: Object.fromEntries(visited)
    }, null, 2);
  }

  // Importiert Visited aus JSON-String (merged mit bestehenden)
  function importVisited(jsonString, replace = false) {
    try {
      const data = JSON.parse(jsonString);
      let importedObj = {};

      // Unterstütze verschiedene Formate
      if (data.visited && typeof data.visited === "object") {
        importedObj = data.visited;
      } else if (typeof data === "object" && !Array.isArray(data)) {
        importedObj = data;
      } else {
        const t = window.i18n ? window.i18n.t : (k) => k;
        throw new Error(t('invalidFormat'));
      }

      if (replace) {
        visited = new Map(Object.entries(importedObj));
      } else {
        Object.entries(importedObj).forEach(([id, info]) => visited.set(id, info));
      }

      saveVisited();
      window.dispatchEvent(new CustomEvent("visited-changed", { detail: { action: "import" } }));
      return Object.keys(importedObj).length;
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.error(t('importError') + " (visited):", e);
      return -1;
    }
  }

  // Initial laden
  loadVisited();

  // Visited API exportieren
  window.Visited = {
    isVisited,
    markVisited,
    unmarkVisited,
    toggleVisited,
    getVisitedInfo,
    getAllVisited,
    getVisitedCount,
    exportVisited,
    importVisited,
    reload: loadVisited
  };
})();
