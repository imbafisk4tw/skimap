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
      exportKmlBtnId = "btn-export-visible-kml"
    } = opts || {};

    if (!map || !resorts || !resortMarkers || !markerLayer || !fmtTime || !norm || !getMinHours || !getMaxHours) {
      throw new Error("initSearchAndFilters: Missing required options.");
    }

    const searchInput = document.getElementById("resort-search");
    const datalist = document.getElementById("resort-datalist");
    const timeSlider = document.getElementById("time-slider");
    const timeLabel = document.getElementById("time-slider-label");

    // -------- Verbund-Filter --------
    let currentVerbundNorm = null;
    let currentPct = Number(timeSlider?.value ?? 100);

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

    const verbundIndex = new Map(); // norm(ver) -> { name, resorts[] }
    Object.values(resorts).forEach(r => {
      const v = parseVerbund(r.name);
      if (!v) return;
      const k = norm(v);
      if (!verbundIndex.has(k)) verbundIndex.set(k, { name: v, resorts: [] });
      verbundIndex.get(k).resorts.push(r);
    });

    function setVerbundFilter(verbundNameOrNull) {
      currentVerbundNorm = verbundNameOrNull ? norm(verbundNameOrNull) : null;
      updateVerbundUi();
      applyFilters(currentPct);
    }

    // X-Button neben Suchfeld (Verbundfilter löschen)
    let clearVerbundBtn = null;

    function ensureClearButton() {
      if (!searchInput) return;
      if (clearVerbundBtn) return;

      const box = searchInput.closest(".search-box") || searchInput.parentElement;
      if (!box) return;

      // IMPORTANT:
      // Do NOT blindly set `position: relative` on the whole search box.
      // That would override the CSS (`position: fixed`) and push the box into
      // normal document flow -> it ends up UNDER the map and adds page height.
      // We only need a positioned ancestor for the absolute "×" button.
      // `fixed`/`absolute`/`relative` already work; only `static` needs change.
      try {
        const computedPos = window.getComputedStyle(box).position;
        if (computedPos === "static") {
          box.style.position = "relative";
        }
      } catch (e) {
        // very old browsers: fallback to not touching position
      }
      searchInput.style.paddingRight = "30px";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.title = "Verbundfilter löschen";
      btn.setAttribute("aria-label", "Verbundfilter löschen");

      btn.style.position = "absolute";
      btn.style.right = "10px";
      btn.style.top = "32px";
      btn.style.width = "22px";
      btn.style.height = "22px";
      btn.style.lineHeight = "20px";
      btn.style.borderRadius = "4px";
      btn.style.border = "1px solid #666";
      btn.style.background = "#f0f0f0";
      btn.style.cursor = "pointer";
      btn.style.display = "none";

      btn.addEventListener("click", () => {
        setVerbundFilter(null);
        searchInput.value = "";
        searchInput.focus();
      });

      box.appendChild(btn);
      clearVerbundBtn = btn;
    }

    function updateVerbundUi() {
      ensureClearButton();
      if (!clearVerbundBtn || !searchInput) return;

      const active = !!currentVerbundNorm;
      clearVerbundBtn.style.display = active ? "block" : "none";

      if (active) {
        const vName = verbundIndex.get(currentVerbundNorm)?.name || "Verbund";
        searchInput.placeholder = `Filter aktiv: ${vName} (X zum löschen)`;
      } else {
        searchInput.placeholder = "Name eingeben & Enter drücken...";
      }
    }

    // -------- Filter-Box (Saisonkarten / Gletscher / Überschneidung / Nahe München) --------
    const filterState = {
      sctOnly: true,
      sscOnly: true,
      both: true,
      glacier: true,
      nearMuc: true
    };

    function categoryMatch(r) {
      const matches = [];

      const isSctOnly = !!(r.sct && !r.ssc);
      const isSscOnly = !!(r.ssc && !r.sct);
      const isBoth = !!(r.sct && r.ssc);
      const isGlacier = !!r.glacier;
      const isNear = !!r.nearMuc;

      if (filterState.sctOnly) matches.push(isSctOnly);
      if (filterState.sscOnly) matches.push(isSscOnly);
      if (filterState.both) matches.push(isBoth);
      if (filterState.glacier) matches.push(isGlacier);
      if (filterState.nearMuc) matches.push(isNear);

      // Wenn alles abgewählt ist, nichts anzeigen
      if (matches.length === 0) return false;

      // OR-Logik (Union der gewählten Gruppen)
      return matches.some(Boolean);
    }

    function buildFilterControl() {
      if (!createFilterControl || typeof L === "undefined") return;

      const ctrl = L.control({ position: "topright" });
      ctrl.onAdd = function () {
        const div = L.DomUtil.create("div", "filter-box leaflet-control");
        div.innerHTML = `
          <div class="title">Filter</div>
          <label><input type="checkbox" id="flt-sct" checked> Nur Snow Card Tirol</label>
          <label><input type="checkbox" id="flt-ssc" checked> Nur SuperSkiCard</label>
          <label><input type="checkbox" id="flt-both" checked> Beide Pässe</label>
          <label><input type="checkbox" id="flt-glacier" checked> Gletscher</label>
          <label><input type="checkbox" id="flt-muc" checked> Nahe München</label>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      };
      ctrl.addTo(map);

      // wiring (nachdem es im DOM ist)
      const wire = () => {
        const elSct = document.getElementById("flt-sct");
        const elSsc = document.getElementById("flt-ssc");
        const elBoth = document.getElementById("flt-both");
        const elGl = document.getElementById("flt-glacier");
        const elMuc = document.getElementById("flt-muc");

        const handler = () => {
          filterState.sctOnly = !!elSct?.checked;
          filterState.sscOnly = !!elSsc?.checked;
          filterState.both = !!elBoth?.checked;
          filterState.glacier = !!elGl?.checked;
          filterState.nearMuc = !!elMuc?.checked;
          applyFilters(currentPct);
        };

        [elSct, elSsc, elBoth, elGl, elMuc].forEach(el => {
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
        const div = L.DomUtil.create("div", "export-box leaflet-control");
        div.innerHTML = `
          <div class="title">Export (aktueller Filter)</div>
          <button id="${exportCsvBtnId}" type="button">CSV → Google My Maps</button>
          <button id="${exportKmlBtnId}" type="button">KML → Google My Maps</button>
          <div class="hint">Import in Google My Maps, danach in Google Maps nutzbar.</div>
        `;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      };
      exportControl.addTo(map);
    }

    buildFilterControl();
    buildExportControl();

    // -------- Suche --------
    function rebuildDatalist() {
      if (!datalist) return;
      while (datalist.firstChild) datalist.removeChild(datalist.firstChild);

      // Verbünde zuerst
      Array.from(verbundIndex.values())
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .forEach(v => {
          const opt = document.createElement("option");
          opt.value = v.name;
          datalist.appendChild(opt);
        });

      // Resorts danach
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

    function resortPassesAllFilters(r, pct) {
      const minHours = getMinHours();
      const maxHours = getMaxHours();
      const limitHours = minHours + (pct / 100) * (maxHours - minHours);

      const v = parseVerbund(r.name);
      const inVerbund = !currentVerbundNorm || (v && norm(v) === currentVerbundNorm);

      // Wenn travelHours fehlt: Zeitfilter nicht blockieren
      const inTime = (pct >= 99) || (r.travelHours == null) || (r.travelHours <= limitHours + 1e-6);

      const inCategory = categoryMatch(r);

      return inVerbund && inTime && inCategory;
    }

    function fitBoundsForVerbund(verbundNormKey) {
      if (typeof L === "undefined") return;
      const entry = verbundIndex.get(verbundNormKey);
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

      if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
    }

    if (searchInput) {
      searchInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();

        const raw = (searchInput.value || "").trim();
        if (!raw) return;

        const onlyName = extractResortName(raw);
        const qNorm = norm(onlyName);

        // Exaktes Resort
        if (resortMarkers[qNorm]) {
          setVerbundFilter(null);
          applyFilters(currentPct); // damit evtl. wieder sichtbar
          focusResortByName(onlyName);
          return;
        }

        // Verbund
        if (verbundIndex.has(qNorm)) {
          setVerbundFilter(verbundIndex.get(qNorm).name);
          fitBoundsForVerbund(qNorm);
          return;
        }

        // Fallback
        focusResortByName(onlyName);
      });
    }

    // -------- Fahrzeit-Slider --------
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

      if (typeof updateResortCounter === "function") updateResortCounter();
    }

    if (timeSlider) {
      timeSlider.addEventListener("input", (e) => {
        const pct = Number(e.target.value);
        updateTimeLabel(pct);
        applyFilters(pct);
      });
    }

    // -------- Export --------
    function getVisibleResorts() {
      const out = [];
      for (const r of Object.values(resorts)) {
        const key = norm(r.name);
        const marker = resortMarkers[key];
        if (!marker) continue;
        if (markerLayer.hasLayer(marker)) out.push(r);
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
      exportVisibleToKml
    };
  }

  window.initSearchAndFilters = initSearchAndFilters;
})();
