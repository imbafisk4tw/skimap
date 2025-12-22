(function () {
  "use strict";

  function defaultExtractResortName(raw) {
    if (!raw) return "";
    const idx = raw.indexOf(" – ");
    if (idx === -1) return raw.trim();
    return raw.slice(0, idx).trim();
  }

  /**
   * Initialisiert Suche + Fahrzeit-Slider Filter UI.
   * Erwartet dieselben Datenstrukturen wie in deinem index.html:
   * - resorts: { [key]: {name, lat, lon, sct, ssc, glacier, nearMuc, travelHours, ...} }
   * - resortMarkers: { [normName]: Leaflet Marker/CircleMarker }
   */
  function initSearchAndFilters(opts) {
    const {
      map,
      resorts,
      resortMarkers,
      layers,
      fmtTime,
      norm,
      getMinHours,
      getMaxHours,
      updateResortCounter
    } = opts || {};

    if (!map || !resorts || !resortMarkers || !layers || !fmtTime || !norm || !getMinHours || !getMaxHours) {
      throw new Error("initSearchAndFilters: Missing required options.");
    }

    // --- Elemente ---
    const searchInput = document.getElementById("resort-search");
    const datalist = document.getElementById("resort-datalist");

    const timeSlider = document.getElementById("time-slider");
    const timeLabel = document.getElementById("time-slider-label");

    // --- Suche ---
    function rebuildDatalist() {
      if (!datalist) return;

      while (datalist.firstChild) {
        datalist.removeChild(datalist.firstChild);
      }

      Object.values(resorts)
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .forEach(r => {
          const opt = document.createElement("option");
          if (r.travelHours != null && isFinite(r.travelHours)) {
            opt.value = r.name + " – " + fmtTime(r.travelHours);
          } else {
            opt.value = r.name;
          }
          datalist.appendChild(opt);
        });
    }

    function focusResortByName(query) {
      if (!query) return;
      const qNorm = norm(query);
      const keys = Object.keys(resortMarkers);

      let bestKey = null;

      if (resortMarkers[qNorm]) {
        bestKey = qNorm;
      } else {
        for (const k of keys) {
          if (k.startsWith(qNorm)) { bestKey = k; break; }
        }
        if (!bestKey) {
          for (const k of keys) {
            if (k.includes(qNorm)) { bestKey = k; break; }
          }
        }
      }

      if (!bestKey) {
        alert("Kein Skigebiet gefunden für: " + query);
        return;
      }

      const marker = resortMarkers[bestKey];
      const latLng = marker.getLatLng();
      map.setView(latLng, 11);
      marker.openPopup();
    }

    function extractResortName(raw) {
      return defaultExtractResortName(raw);
    }

    if (searchInput) {
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const onlyName = extractResortName(searchInput.value);
          focusResortByName(onlyName);
        }
      });
    }

    // --- Fahrzeit-Filter ---
    function updateTimeLabel(pct) {
      if (!timeLabel) return;

      if (pct >= 99) {
        timeLabel.textContent = "Voll (alle Gebiete)";
        return;
      }
      const minHours = getMinHours();
      const maxHours = getMaxHours();
      const limitHours = minHours + (pct / 100) * (maxHours - minHours);
      timeLabel.textContent = "bis ca. " + fmtTime(limitHours);
    }

    function applyTimeFilter(pct) {
      const minHours = getMinHours();
      const maxHours = getMaxHours();
      const limitHours = minHours + (pct / 100) * (maxHours - minHours);

      Object.values(resorts).forEach(r => {
        const key = norm(r.name);
        const marker = resortMarkers[key];
        if (!marker || r.travelHours == null) return;

        const inside = (pct >= 99) || (r.travelHours <= limitHours + 1e-6);

        if (r.sct) {
          if (inside) layers.sctLayer.addLayer(marker);
          else layers.sctLayer.removeLayer(marker);
        }
        if (r.ssc) {
          if (inside) layers.sscLayer.addLayer(marker);
          else layers.sscLayer.removeLayer(marker);
        }
        if (r.sct && r.ssc) {
          if (inside) layers.overlapLayer.addLayer(marker);
          else layers.overlapLayer.removeLayer(marker);
        }
        if (r.glacier) {
          if (inside) layers.glacierLayer.addLayer(marker);
          else layers.glacierLayer.removeLayer(marker);
        }
        if (r.nearMuc) {
          if (inside) layers.nearMucLayer.addLayer(marker);
          else layers.nearMucLayer.removeLayer(marker);
        }
      });

      if (typeof updateResortCounter === "function") {
        updateResortCounter();
      }
    }

    if (timeSlider) {
      timeSlider.addEventListener("input", (e) => {
        const pct = Number(e.target.value);
        updateTimeLabel(pct);
        applyTimeFilter(pct);
      });
    }

    return {
      rebuildDatalist,
      focusResortByName,
      extractResortName,
      updateTimeLabel,
      applyTimeFilter
    };
  }

  window.initSearchAndFilters = initSearchAndFilters;
})();
