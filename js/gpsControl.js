// js/gpsControl.js
// Simple GPS / Geolocation toggle for Leaflet maps.
// Shows a map button (above zoom controls on mobile) + checkbox in export-box.

(function () {
  "use strict";

  const STORAGE_KEY = "skimap.gpsEnabled";

  let map = null;
  let mapButton = null;

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


  // Show pulse effect around GPS marker
  function showPulseEffect(latlng) {
    if (!map || !latlng) return;
    const point = map.latLngToContainerPoint(latlng);
    const ring = document.createElement("div");
    ring.className = "gps-pulse-ring";
    ring.style.left = (point.x - 10) + "px";
    ring.style.top = (point.y - 10) + "px";
    map.getContainer().appendChild(ring);
    setTimeout(() => ring.remove(), 850);
  }

  function centerOnce() {
    if (!map) return;

    // If we already have a fix, just center.
    if (lastLatLng) {
      const z = Math.max(map.getZoom(), 12);
      try { map.setView(lastLatLng, z, { animate: true }); } catch (_) { map.setView(lastLatLng, z); }
      setTimeout(() => showPulseEffect(lastLatLng), 300);
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
      setTimeout(() => showPulseEffect(ll), 300);
    }

    function onceError(e) {
      map.off("locationfound", onceFound);
      map.off("locationerror", onceError);
      const t = window.i18n ? window.i18n.t : (k) => k;
      alert(t('locationError') + "\n\nDetails: " + (e && e.message ? e.message : "unknown"));
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

    // Update map button state
    if (mapButton) {
      mapButton.classList.toggle("gps-active", enabled);
      const t = window.i18n ? window.i18n.t : (k) => k;
      mapButton.title = enabled ? t('gpsActiveClickToCenter') : t('gpsShowPosition');
    }

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
        radius: 8,
        weight: 3,
        color: '#ffffff',        // Weißer Rand
        fillColor: '#00E676',    // Leuchtendes Grün
        fillOpacity: 1
      }).addTo(map);
      const t = window.i18n ? window.i18n.t : (k) => k;
      marker.bindTooltip(t('youAreHere'), { permanent: false });
    } else {
      marker.setLatLng(latlng);
    }

    if (!accuracyCircle) {
      accuracyCircle = L.circle(latlng, {
        radius: isFinite(acc) && acc > 0 ? acc : 50,
        weight: 2,
        color: '#00E676',        // Grüner Rand passend zum Marker
        fillColor: '#00E676',
        fillOpacity: 0.1
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
      const t = window.i18n ? window.i18n.t : (k) => k;
      alert(t('locationErrorHttps') + "\n\nDetails: " + (e && e.message ? e.message : "unknown"));
    }

    setEnabled(false);
  }

  // Create the standalone map button (shown on mobile above zoom controls)
  function createMapButton() {
    if (!map || mapButton) return;

    const GpsControl = L.Control.extend({
      options: { position: "bottomright" },
      onAdd: function () {
        const container = L.DomUtil.create("div", "leaflet-bar leaflet-control gps-map-btn-container");
        const btn = L.DomUtil.create("a", "gps-map-btn", container);
        btn.href = "#";
        btn.role = "button";
        const t = window.i18n ? window.i18n.t : (k) => k;
        btn.title = t('gpsShowPosition');
        // Crosshair / GPS icon - wie Leaflet/Google Maps Style
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" style="display:block">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="12" cy="12" r="3" fill="currentColor"/>
          <line x1="12" y1="1" x2="12" y2="5" stroke="currentColor" stroke-width="1.5"/>
          <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="1.5"/>
          <line x1="1" y1="12" x2="5" y2="12" stroke="currentColor" stroke-width="1.5"/>
          <line x1="19" y1="12" x2="23" y2="12" stroke="currentColor" stroke-width="1.5"/>
        </svg>`;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(btn, "click", function (e) {
          L.DomEvent.preventDefault(e);
          if (enabled) {
            // Already enabled: center on position
            centerOnce();
          } else {
            // Enable GPS
            setEnabled(true);
          }
        });

        mapButton = btn;
        return container;
      }
    });

    new GpsControl().addTo(map);
  }

  function createGpsBox() {
    if (document.getElementById("gps-toggle")) return;

    // Eigene GPS-Box als Leaflet Control erstellen
    const GpsControl = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        const div = L.DomUtil.create("div", "gps-box leaflet-control collapsed");
        const t = window.i18n ? window.i18n.t : (k) => k;
        div.innerHTML = `
          <button type="button" class="panel-toggle" aria-label="${t('gps')}" aria-expanded="false">
            <span class="toggle-title">${t('gps')}</span>
            <span class="toggle-icon">▼</span>
          </button>
          <div class="panel-content">
            <div class="gps-row">
              <label for="gps-toggle">
                <input type="checkbox" id="gps-toggle">
                <span>${t('showPosition')}</span>
              </label>
              <button type="button" class="gps-center-btn" title="${t('centerOnPosition')}">📍 ${t('center')}</button>
            </div>
          </div>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      }
    });

    new GpsControl().addTo(map);

    // Wiring nach kurzem Delay (DOM muss bereit sein)
    setTimeout(() => {
      const gpsBox = document.querySelector(".gps-box");
      if (!gpsBox) return;

      // Toggle-Button
      const toggleBtn = gpsBox.querySelector(".panel-toggle");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          const isCollapsed = gpsBox.classList.toggle("collapsed");
          toggleBtn.setAttribute("aria-expanded", !isCollapsed);
          // Weather-Box Position aktualisieren
          if (window.updateWeatherBoxPosition) {
            setTimeout(window.updateWeatherBoxPosition, 50);
          }
        });
      }

      // Checkbox
      const cb = document.getElementById("gps-toggle");
      if (cb) {
        cb.addEventListener("change", () => setEnabled(cb.checked));
        // restore last state
        const stored = readStoredEnabled();
        if (stored) setEnabled(true);
      }

      // Zentrieren-Button
      const centerBtn = gpsBox.querySelector(".gps-center-btn");
      if (centerBtn) {
        centerBtn.addEventListener("click", () => centerOnce());
      }
    }, 0);
  }

  function waitForMapAndCreate() {
    let tries = 0;
    const t = setInterval(() => {
      if (map && typeof L !== "undefined") {
        createGpsBox();
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

    // Create standalone map button (above zoom controls on mobile)
    createMapButton();

    // Create GPS box as separate Leaflet control (desktop)
    waitForMapAndCreate();
  }

  window.GpsControl = { init };
})();
