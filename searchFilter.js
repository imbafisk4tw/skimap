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
    
    const clearVerbundBtn = document.getElementById("clear-verbund-btn");
const timeSlider = document.getElementById("time-slider");
    const timeLabel = document.getElementById("time-slider-label");

    // -------- Verbund-Filter --------
    // Nutzer sollen auch kurze Eingaben wie "Skiwelt" treffen können,
    // selbst wenn groupName in resorts.json länger ist (z.B. "SkiWelt Wilder Kaiser – Brixental").
    // Deshalb indexieren wir mehrere Keys je Verbund (groupName, groupId und ggf. Kurzname aus r.name).
    let currentGroupId = null;
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

    // Verbund-Index wird dynamisch aus `resorts` aufgebaut.
    // Wichtig: `initSearchAndFilters()` wird bei dir *vor* dem Laden von resorts.json aufgerufen,
    // deshalb muss der Index später (nachdem `resorts` befüllt wurde) erneut aufgebaut werden.
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
        const shortNameRaw = parseVerbund(r.name); // z.B. "SkiWelt"

        const groupNameRaw =
          (typeof r.groupName === "string" && r.groupName.trim()) ? r.groupName.trim()
          : (r.verbund && typeof r.verbund.name === "string" && r.verbund.name.trim()) ? r.verbund.name.trim()
          : shortNameRaw;

        const groupIdRaw =
          (typeof r.groupId === "string" && r.groupId.trim()) ? r.groupId.trim()
          : (r.verbund && typeof r.verbund.id === "string" && r.verbund.id.trim()) ? r.verbund.id.trim()
          : (shortNameRaw ? norm(shortNameRaw) : (groupNameRaw ? norm(groupNameRaw) : null));

        if (!groupIdRaw) return;

        if (!groupById.has(groupIdRaw)) {
          groupById.set(groupIdRaw, { id: groupIdRaw, displayName: null, names: new Set(), resorts: [] });
        }

        const entry = groupById.get(groupIdRaw);
        entry.resorts.push(r);

        // Keys sammeln
        if (groupNameRaw) entry.names.add(groupNameRaw);
        if (shortNameRaw) entry.names.add(shortNameRaw);
        entry.names.add(groupIdRaw);

        // displayName: möglichst kurz & menschenlesbar
        const candidates = [shortNameRaw, groupNameRaw].filter(Boolean);
        for (const c of candidates) {
          if (!entry.displayName) entry.displayName = c;
          else {
            const cur = String(entry.displayName);
            const cand = String(c);
            if (cand.length < cur.length) entry.displayName = cand;
          }
        }
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

    // Verbund-Reset Button neben Suchfeld (hebt nur Verbundfilter auf, andere Filter bleiben unberührt)
    if (clearVerbundBtn) {
      clearVerbundBtn.addEventListener("click", () => {
        setGroupFilter(null);
        searchInput.value = "";
        searchInput.focus();
      });
    }

    function updateVerbundUi() {
      if (!searchInput) return;

      const active = !!currentGroupId;

      if (clearVerbundBtn) {
        clearVerbundBtn.disabled = !active;
      }

      if (active) {
        const vName = groupById.get(currentGroupId)?.displayName || groupById.get(currentGroupId)?.id || "Verbund";
        searchInput.placeholder = `Filter aktiv: ${vName} (Button zum Aufheben)`;
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
      // Basis-Gruppen (OR-Logik)
      const isSctOnly = !!(r.sct && !r.ssc);
      const isSscOnly = !!(r.ssc && !r.sct);
      const isBoth = !!(r.sct && r.ssc);
      const isNear = !!r.nearMuc;
      const isGlacier = !!r.glacier;

      const baseSelected = !!(filterState.sctOnly || filterState.sscOnly || filterState.both || filterState.nearMuc);

      const baseMatch = (
        (filterState.sctOnly && isSctOnly) ||
        (filterState.sscOnly && isSscOnly) ||
        (filterState.both && isBoth) ||
        (filterState.nearMuc && isNear)
      );

      // Gletscher:
      // - Wenn abgewählt: Gletscher NIE anzeigen (auch nicht, wenn sie SCT/SSC sind)
      // - Wenn ausgewählt: Gletscher zusätzlich anzeigen (auch wenn keine Basisgruppe ausgewählt ist)
      if (!filterState.glacier && isGlacier) return false;

      const glacierMatch = filterState.glacier && isGlacier;

      // Wenn alle Basisgruppen abgewählt sind, zeigen wir nur (optional) Gletscher.
      if (!baseSelected) return glacierMatch;

      return baseMatch || glacierMatch;
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
        const addOpt = (value, label) => {
          const opt = document.createElement("option");
          opt.value = value;
          if (label) opt.label = label;
          datalist.appendChild(opt);
        };

        // 1) zuverlässig: groupId
        addOpt(`verbund: ${g.id}`, g.displayName && g.displayName !== g.id ? String(g.displayName) : "");

        // 2) komfortabel: Anzeigename (falls anders als groupId)
        if (g.displayName && String(g.displayName).trim() && String(g.displayName) !== String(g.id)) {
          addOpt(`verbund: ${String(g.displayName)}`, String(g.id));
        }
      }
    }

    function fillDatalistForResorts(prefix) {
      if (!datalist) return;
      Object.values(resorts)
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .forEach(r => {
          const opt = document.createElement("option");
          const namePart = (r.travelHours != null && isFinite(r.travelHours))
            ? (r.name + " – " + fmtTime(r.travelHours))
            : r.name;
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
        // default: nur Resorts (kein Verbund-Mischen → weniger Verwirrung)
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
      // Verbund-Filter (primär über groupId/groupName aus resorts.json)
      let inVerbund = true;
      if (currentGroupId) {
        const thisGroupId =
          (typeof r.groupId === "string" && r.groupId.trim()) ? r.groupId.trim()
          : (r.verbund && typeof r.verbund.id === "string" && r.verbund.id.trim()) ? r.verbund.id.trim()
          : (parseVerbund(r.name) ? norm(parseVerbund(r.name)) : null);

        inVerbund = !!thisGroupId && String(thisGroupId) === String(currentGroupId);
      }


      // Wenn travelHours fehlt: Zeitfilter nicht blockieren
      const inTime = (pct >= 99) || (r.travelHours == null) || (r.travelHours <= limitHours + 1e-6);

      const inCategory = categoryMatch(r);

      return inVerbund && inTime && inCategory;
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

      if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
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

      searchInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();

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
              alert("Kein Verbund gefunden für: " + termRaw);
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
