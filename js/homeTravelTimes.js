// js/homeTravelTimes.js
// Loads precomputed travel times per home profile (for the time slider + popup drive text).
//
// Expected files:
// - data/travel_times/home_<homeId>.json
//   format: { "<Resort Name>": { "hours": 2.15, "km": 180.2 }, ... }
//
// This module is safe to call before resorts are loaded; it will apply once resorts are ready.

(function () {
  const mod = {};
  const cache = {}; // homeId -> ttMap
  let pendingHomeId = null;

  const STORAGE_KEY = "skimap.selectedHomeId";
  const DEFAULT_HOME = "muc";

  function getSelectedHomeId() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_HOME;
  }

  function setSelectedHomeId(homeId) {
    if (!homeId) return;
    localStorage.setItem(STORAGE_KEY, homeId);
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
    return r.json();
  }

  function applyIfReady(homeId, ttMap) {
    // resorts may not be loaded yet
    const ready = !!window.__resortsReady;
    if (!ready) {
      pendingHomeId = homeId;
      cache[homeId] = ttMap;
      return;
    }
    if (typeof window.applyTravelTimesFromMap === "function") {
      window.applyTravelTimesFromMap(ttMap);
    }
  }

  mod.getSelectedHomeId = getSelectedHomeId;
  mod.setSelectedHomeId = setSelectedHomeId;

  mod.load = async function load(homeId) {
    const hid = homeId || getSelectedHomeId();

    if (cache[hid]) {
      applyIfReady(hid, cache[hid]);
      return cache[hid];
    }

    const url = `data/travel_times/home_${hid}.json`;
    const data = await fetchJson(url);

    cache[hid] = data;
    applyIfReady(hid, data);
    return data;
  };

  mod.onResortsReady = function onResortsReady() {
    if (!pendingHomeId) return;
    const hid = pendingHomeId;
    pendingHomeId = null;
    if (cache[hid]) {
      applyIfReady(hid, cache[hid]);
    }
  };

  window.HomeTravelTimes = mod;
})();
