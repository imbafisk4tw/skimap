// js/gpsControl.js
// Simple GPS / Geolocation toggle for Leaflet maps.
// Adds a checkbox into the existing ".export-box" control so it appears both
// on desktop (right control stack) and on mobile (burger side panel).

(function () {
  "use strict";

  const STORAGE_KEY = "skimap.gpsEnabled";

  let map = null;

  let enabled = false;
  let marker = null;
  let accuracyCircle = null;

  let lastLatLng = null;

  let didCenterOnce = false;
  let errorAlerted = false;

  function readStoredEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function storeEnabled(v) {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch (_) {}
  }

  function removeLayers() {
    try {
      if (marker && map && map.hasLayer(marker)) map.removeLayer(marker);
    } catch (_) {}
    try {
      if (accuracyCircle && map && map.hasLayer(accuracyCircle)) map.removeLayer(accuracyCircle);
    } catch (_) {}
    marker = null;
    accuracyCircle = null;
  }

  function stop() {
    if (!map) return;
    try { map.stopLocate(); } catch (_) {}
    removeLayers();
    didCenterOnce = false;
  }

  function start() {
    if (!map) return;

    didCenterOnce = false;
    errorAlerted = false;

    // watch:true keeps updating while you move
    map.locate({
      watch: true,
      setView: false,          // we center manually once (see locationfound)
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 15_000
    });
  }


  function centerOnce() {
    if (!map) return;

    // If we already have a fix, just center.
    if (lastLatLng) {
      const z = Math.max(map.getZoom(), 12);
      try { map.setView(lastLatLng, z, { animate: true }); } catch (_) { map.setView(lastLatLng, z); }
      return;
    }

    // Otherwise: request a one-time locate, then center on first result.
    let centered = false;

    function onceFound(e) {
      if (centered) return;
      centered = true;
      map.off("locationfound", onceFound);
      map.off("locationerror", onceError);

      const ll = e.latlng;
      lastLatLng = ll;

      const z = Math.max(map.getZoom(), 12);
      try { map.setView(ll, z, { animate: true }); } catch (_) { map.setView(ll, z); }
    }

    function onceError(e) {
      map.off("locationfound", onceFound);
      map.off("locationerror", onceError);
      alert("Standort konnte nicht ermittelt werden. Prüfe Standortfreigabe.\n\nDetails: " + (e && e.message ? e.message : "unbekannt"));
    }

    map.on("locationfound", onceFound);
    map.on("locationerror", onceError);

    try {
      map.locate({
        watch: false,
        setView: false,
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 15_000
      });
    } catch (_) {}
  }

  function setEnabled(v) {
    enabled = !!v;
    storeEnabled(enabled);

    const cb = document.getElementById("gps-toggle");
    if (cb) cb.checked = enabled;

    if (enabled) start();
    else stop();
  }

  function onLocationFound(e) {
    if (!map) return;

    const latlng = e.latlng;
    lastLatLng = latlng;
    const acc = Number(e.accuracy || 0);

    if (!marker) {
      marker = L.circleMarker(latlng, {
        radius: 7,
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map);
      marker.bindTooltip("Du bist hier", { permanent: false });
    } else {
      marker.setLatLng(latlng);
    }

    if (!accuracyCircle) {
      accuracyCircle = L.circle(latlng, {
        radius: isFinite(acc) && acc > 0 ? acc : 50,
        weight: 1,
        fillOpacity: 0.06
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latlng);
      if (isFinite(acc) && acc > 0) accuracyCircle.setRadius(acc);
    }

    // Center once when enabling (doesn't constantly "fight" the user while panning)
    if (!didCenterOnce) {
      const z = Math.max(map.getZoom(), 12);
      try { map.setView(latlng, z, { animate: true }); } catch (_) { map.setView(latlng, z); }
      didCenterOnce = true;
    }
  }

  function onLocationError(e) {
    console.warn("Geolocation error:", e);

    // Avoid repeated alerts if the browser keeps firing errors
    if (!errorAlerted) {
      errorAlerted = true;
      alert("Standort konnte nicht ermittelt werden. Prüfe Standortfreigabe und ob die Seite über HTTPS läuft.\n\nDetails: " + (e && e.message ? e.message : "unbekannt"));
    }

    setEnabled(false);
  }

  function injectUi(exportBox) {
    if (!exportBox || document.getElementById("gps-toggle")) return;

    const wrap = document.createElement("div");
    wrap.className = "gps-control";
    wrap.style.marginTop = "10px";
    wrap.style.paddingTop = "8px";
    wrap.style.borderTop = "1px solid rgba(0,0,0,0.12)";

    const row = document.createElement("div");
    row.className = "gps-row";

    const label = document.createElement("label");
    label.htmlFor = "gps-toggle";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = "gps-toggle";

    const text = document.createElement("span");
    text.textContent = "GPS: Position anzeigen";

    label.appendChild(cb);
    label.appendChild(text);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gps-center-btn";
    btn.title = "Auf meine Position zentrieren";
    btn.textContent = "📍 Zentrieren";

    row.appendChild(label);
    row.appendChild(btn);

    wrap.appendChild(row);
    exportBox.appendChild(wrap);

    cb.addEventListener("change", () => setEnabled(cb.checked));

    btn.addEventListener("click", () => centerOnce());

    // restore last state (best effort)
    const stored = readStoredEnabled();
    if (stored) setEnabled(true);
  }

  function waitForExportBoxAndInject() {
    let tries = 0;
    const t = setInterval(() => {
      const exportBox = document.querySelector(".export-box");
      if (exportBox) {
        injectUi(exportBox);
        clearInterval(t);
      }
      tries += 1;
      if (tries > 80) clearInterval(t); // ~16s
    }, 200);
  }

  function init(leafletMap) {
    map = leafletMap;
    if (!map) return;

    map.on("locationfound", onLocationFound);
    map.on("locationerror", onLocationError);

    waitForExportBoxAndInject();
  }

  window.GpsControl = { init };
})();
