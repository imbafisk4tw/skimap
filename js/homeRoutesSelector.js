(function () {
  "use strict";

  /**
   * HomeRoutesSelector v3 (kompatibel + robust)
   *
   * Unterstützte homes.json Formate:
   * 1) [ {id,name,lat,lon}, ... ]
   * 2) { "homes": [ {id,...}, ... ] }
   * 3) { "muc": {name,lat,lon}, "lju": {...}, ... }   (Object-Map)
   *
   * Select-Ziel finden:
   * - bevorzugt #homeSelectSlider
   * - sonst #homeSelect
   * - sonst [data-home-select="1"]
   *
   * Optional: mehrere Selects werden synchron gehalten.
   */
  async function init(opts) {
    const o = opts || {};
    const homesUrl = o.homesUrl || "data/homes.json";
    const defaultHomeId = o.defaultHomeId || null;
    const storageKey = o.storageKey || "skimap.selectedHomeId";
    const onHomeChanged = (typeof o.onHomeChanged === "function") ? o.onHomeChanged : null;

    const preferredIds = [];
    if (o.selectId) preferredIds.push(String(o.selectId));
    preferredIds.push("homeSelectSlider", "homeSelect");

    const targets = [];
    for (const id of preferredIds) {
      document.querySelectorAll(`#${CSS.escape(id)}`).forEach(el => targets.push(el));
      if (targets.length) break;
    }
    if (!targets.length) {
      document.querySelectorAll('select[data-home-select="1"]').forEach(el => targets.push(el));
    }
    if (!targets.length) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.warn("HomeRoutesSelector: " + t('noSelectFound'));
      return;
    }

    let data;
    try {
      const resp = await fetch(homesUrl, { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      data = await resp.json();
    } catch (e) {
      const t = window.i18n ? window.i18n.t : (k) => k;
      console.warn("HomeRoutesSelector: " + t('homesLoadError') + ":", e);
      // leave selects empty but not crash
      return;
    }

    // Normalize homes list for different shapes
    let homes = [];
    if (Array.isArray(data)) {
      homes = data;
    } else if (Array.isArray(data?.homes)) {
      homes = data.homes;
    } else if (data && typeof data === "object") {
      // object-map: { muc:{...}, lju:{...} }
      homes = Object.entries(data).map(([id, h]) => ({ ...(h || {}), id }));
    }

    const normalizeHome = (h) => {
      const id = (h && (h.id ?? h.homeId ?? h.key)) ? String(h.id ?? h.homeId ?? h.key) : null;
      const name = (h && h.name) ? String(h.name) : (id || "Home");
      const lat = (h && h.lat != null) ? Number(h.lat) : null;
      const lon = (h && (h.lon ?? h.lng) != null) ? Number(h.lon ?? h.lng) : null;
      return { ...h, id, name, lat, lon };
    };

    homes = homes.map(normalizeHome).filter(h => h.id);

    if (!homes.length) {
      console.warn("HomeRoutesSelector: homes.json enthält keine Homes im erwarteten Format.");
      return;
    }

    homes.sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));

    // Status-Icons: Prüfen ob travel_times existieren
    const travelTimesDir = o.travelTimesDir || "data/travel_times";
    let totalResorts = 0;

    // Anzahl der Resorts ermitteln (für Prozentberechnung)
    try {
      const resortsResp = await fetch("data/resorts.json", { cache: "no-store" });
      if (resortsResp.ok) {
        let resortsData = await resortsResp.json();
        // Handle DBeaver export format: {"v_resort_json_export": [...]}
        if (resortsData && resortsData.v_resort_json_export) {
          resortsData = resortsData.v_resort_json_export;
        }
        totalResorts = Array.isArray(resortsData) ? resortsData.length : 0;
      }
    } catch (_) {}

    // Für jedes Home den travel_times Status laden
    await Promise.all(homes.map(async (h) => {
      h.travelTimesStatus = "none"; // none, partial, full
      h.travelTimesCount = 0;
      try {
        const ttResp = await fetch(`${travelTimesDir}/home_${h.id}.json`, { cache: "no-store" });
        if (ttResp.ok) {
          const ttData = await ttResp.json();
          const count = Object.keys(ttData).length;
          h.travelTimesCount = count;
          if (totalResorts > 0) {
            const pct = count / totalResorts;
            h.travelTimesStatus = pct >= 0.95 ? "full" : "partial";
          } else {
            h.travelTimesStatus = count > 0 ? "partial" : "none";
          }
        }
      } catch (_) {}
    }));

    const stored = (typeof localStorage !== "undefined") ? localStorage.getItem(storageKey) : null;
    let selectedId = stored || defaultHomeId || (homes[0]?.id ?? null);
    if (selectedId && homes.length && !homes.some(h => h.id === selectedId)) selectedId = homes[0].id;

    function getStatusIcon(status) {
      if (status === "full") return "🟢";
      if (status === "partial") return "🟠";
      return "⚪";
    }

    function rebuildOptions(sel) {
      sel.innerHTML = "";
      for (const h of homes) {
        const opt = document.createElement("option");
        opt.value = h.id;
        const icon = getStatusIcon(h.travelTimesStatus);
        const countInfo = totalResorts > 0 ? ` (${h.travelTimesCount}/${totalResorts})` : "";
        opt.textContent = `${icon} ${h.name || h.id}${countInfo}`;
        sel.appendChild(opt);
      }
    }

    targets.forEach(rebuildOptions);
    targets.forEach(sel => { sel.value = selectedId; });

    let syncing = false;

    async function fireChange(id) {
      const meta = homes.find(h => h.id === id) || { id };
      if (typeof localStorage !== "undefined") {
        try { localStorage.setItem(storageKey, id); } catch (_) {}
      }
      if (onHomeChanged) {
        try { await onHomeChanged(id, meta); } catch (e) { console.warn("HomeRoutesSelector onHomeChanged failed:", e); }
      }
    }

    function syncAll(fromSel) {
      if (syncing) return;
      syncing = true;
      const id = String(fromSel.value || "");
      targets.forEach(sel => { if (sel !== fromSel) sel.value = id; });
      syncing = false;
      fireChange(id);
    }

    targets.forEach(sel => {
      sel.addEventListener("change", () => syncAll(sel));
    });

    await fireChange(selectedId);

    return {
      getSelectedHomeId: () => String(targets[0].value || ""),
      setSelectedHomeId: (id) => {
        if (!id) return;
        targets.forEach(sel => { sel.value = String(id); });
        fireChange(String(id));
      },
      getHomes: () => homes.slice()
    };
  }

  window.HomeRoutesSelector = { init };
})();