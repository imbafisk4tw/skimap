// isochroneOverlay.js
(function () {
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function styleFn(feature, state) {
    const t = feature?.properties?.value; // seconds (ORS)
    const minT = state.minSec;
    const maxT = state.maxSec;

    const k = clamp((t - minT) / (maxT - minT), 0, 1); // 0=near, 1=far
    const fillOpacity = state.baseOpacity * (1 - state.fadeFactor * k);

    if (state.maxSeconds != null && t > state.maxSeconds) {
      return { weight: 0, fillOpacity: 0 };
    }
    return {
      weight: 0,
      fillColor: state.fillColor,
      fillOpacity
    };
  }

  async function init(map, opts = {}) {
    const state = {
      map,
      url: opts.url || "data/isochrones/home_10-60min.geojson",
      fillColor: opts.fillColor || "#2563eb",
      baseOpacity: opts.baseOpacity ?? 0.22,
      fadeFactor: opts.fadeFactor ?? 0.75,
      enabled: opts.enabled ?? true,
      maxSeconds: null,
      paneName: opts.paneName || "isochronePane",
      minSec: opts.minSec ?? 600,   // 10 min
      maxSec: opts.maxSec ?? 3600   // 60 min
    };

    if (!map.getPane(state.paneName)) {
      map.createPane(state.paneName);
      const pane = map.getPane(state.paneName);
      pane.style.zIndex = "350";
      pane.style.mixBlendMode = "multiply";
    }

    const res = await fetch(state.url, { cache: "no-store" });
    if (!res.ok) {
      console.warn("[IsochroneOverlay] Could not load", state.url, res.status);
      return api(state);
    }
    const geojson = await res.json();

    state.layer = L.geoJSON(geojson, {
      pane: state.paneName,
      style: (f) => styleFn(f, state)
    });

    if (state.enabled) state.layer.addTo(map);

    return api(state);
  }

  function api(state) {
    return {
      setEnabled(on) {
        state.enabled = !!on;
        if (!state.layer) return;
        if (state.enabled) state.layer.addTo(state.map);
        else state.map.removeLayer(state.layer);
      },
      setMaxMinutes(minutesOrNull) {
        if (minutesOrNull == null || minutesOrNull === "" || Number.isNaN(Number(minutesOrNull))) {
          state.maxSeconds = null;
        } else {
          state.maxSeconds = Math.max(0, Number(minutesOrNull)) * 60;
        }
        if (!state.layer) return;
        state.layer.setStyle((f) => styleFn(f, state));
      },
      getLayer() {
        return state.layer || null;
      }
    };
  }

  window.IsochroneOverlay = { init };
})();
