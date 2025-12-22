(function () {
  "use strict";

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

  function toCsv(rows) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["name", "lat", "lon", "travelHours", "distKm", "sct", "ssc", "glacier", "nearMuc", "website"];
    const lines = [header.join(",")];

    for (const r of rows) {
      lines.push([
        esc(r.name),
        esc(r.lat),
        esc(r.lon),
        esc(r.travelHours),
        esc(r.distKm),
        esc(!!r.sct),
        esc(!!r.ssc),
        esc(!!r.glacier),
        esc(!!r.nearMuc),
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

  /**
   * initSearchAndFilters
   * - Filter/Slider/Suche
   * - optional: LayerControl + Counter-Update bei Layer-Toggle
   * - Export der aktuell sichtbaren Resorts (berücksichtigt Time-Filter + LayerControl)
   */
  function initSearchAndFilters(opts) {
    const {
      map,
      resorts,
      resortMarkers,
      layers, // { sctLayer, sscLayer, overlapLayer, glacierLayer, nearMucLayer }
      fmtTime,
      norm,
      getMinHours,
      getMaxHours,
      updateResortCounter,

      // optional: Layer control auslagern
      layerControlOverlays, // { "Label": layerGroup, ... }
      layerControlCollapsed = false,

      // optional: Export button IDs
      exportCsvBtnId = "btn-export-visible-csv",
      exportKmlBtnId = "btn-export-visible-kml",
    } = opts || {};

    if (!map || !resorts || !resortMarkers || !layers || !fmtTime || !norm || !getMinHours || !getMaxHours) {
      throw new Error("initSearchAndFilters: Missing required options.");
    }

    // --- optional: Layer-Control hier erstellen + Counter bei Toggle ---
    if (layerControlOverlays && typeof L !== "undefined") {
      L.control.layers({}, layerControlOverlays, { collapsed: !!layerControlCollapsed }).addTo(map);

      if (typeof updateResortCounter === "function") {
        map.on("overlayadd", updateResortCounter);
        map.on("overlayremove", updateResortCounter);
      }
    }

    // --- Elemente ---
    const searchInput = document.getElementById("resort-search");
    const datalist = document.getElementById("resort-datalist");

    const timeSlider = document.getElementById("time-slider");
    const timeLabel = document.getElementById("time-slider-label");

    // --- Suche ---
    function rebuildDatalist() {
      if (!datalist) return;

      while (datalist.firstChild) datalist.removeChild(datalist.firstChild);

      Object.values(resorts)
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .forEach(r => {
          const opt = document.createElement("option");
          if (r.travelHours != null && isFinite(r.travelHours)) opt.value = r.name + " – " + fmtTime(r.travelHours);
          else opt.value = r.name;
          datalist.appendChild(opt);
        });
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

        if (r.sct)      inside ? layers.sctLayer.addLayer(marker)      : layers.sctLayer.removeLayer(marker);
        if (r.ssc)      inside ? layers.sscLayer.addLayer(marker)      : layers.sscLayer.removeLayer(marker);
        if (r.sct && r.ssc)
                      inside ? layers.overlapLayer.addLayer(marker)    : layers.overlapLayer.removeLayer(marker);
        if (r.glacier)  inside ? layers.glacierLayer.addLayer(marker)  : layers.glacierLayer.removeLayer(marker);
        if (r.nearMuc)  inside ? layers.nearMucLayer.addLayer(marker)  : layers.nearMucLayer.removeLayer(marker);
      });

      if (typeof updateResortCounter === "function") updateResortCounter();
    }

    if (timeSlider) {
      timeSlider.addEventListener("input", (e) => {
        const pct = Number(e.target.value);
        updateTimeLabel(pct);
        applyTimeFilter(pct);
      });
    }

    // --- Sichtbarkeit unter Berücksichtigung des LayerControls ---
    function isMarkerVisibleOnMap(marker) {
      // Sichtbar, wenn Marker in einem aktuell eingeblendeten Layer steckt
      if (map.hasLayer(layers.sctLayer)     && layers.sctLayer.hasLayer(marker)) return true;
      if (map.hasLayer(layers.sscLayer)     && layers.sscLayer.hasLayer(marker)) return true;
      if (map.hasLayer(layers.overlapLayer) && layers.overlapLayer.hasLayer(marker)) return true;
      if (map.hasLayer(layers.glacierLayer) && layers.glacierLayer.hasLayer(marker)) return true;
      if (map.hasLayer(layers.nearMucLayer) && layers.nearMucLayer.hasLayer(marker)) return true;
      return false;
    }

    function getVisibleResorts() {
      const out = [];
      for (const r of Object.values(resorts)) {
        const key = norm(r.name);
        const marker = resortMarkers[key];
        if (!marker) continue;
        if (isMarkerVisibleOnMap(marker)) out.push(r);
      }
      out.sort((a, b) => a.name.localeCompare(b.name, "de"));
      return out;
    }

    function exportVisibleToCsv() {
      const rows = getVisibleResorts();
      const csv = toCsv(rows);
      downloadText("skigebiete-filter.csv", "text/csv;charset=utf-8", csv);
    }

    function exportVisibleToKml() {
      const rows = getVisibleResorts();
      const kml = toKml(rows);
      downloadText("skigebiete-filter.kml", "application/vnd.google-earth.kml+xml;charset=utf-8", kml);
    }

    // --- Buttons auto-wire (wenn vorhanden) ---
    const btnCsv = document.getElementById(exportCsvBtnId);
    if (btnCsv) btnCsv.addEventListener("click", exportVisibleToCsv);

    const btnKml = document.getElementById(exportKmlBtnId);
    if (btnKml) btnKml.addEventListener("click", exportVisibleToKml);

    return {
      rebuildDatalist,
      focusResortByName,
      extractResortName,
      updateTimeLabel,
      applyTimeFilter,

      getVisibleResorts,
      exportVisibleToCsv,
      exportVisibleToKml
    };
  }

  window.initSearchAndFilters = initSearchAndFilters;
})();
