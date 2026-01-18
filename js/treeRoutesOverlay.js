(function () {
  "use strict";

  // TreeRoutesOverlay: visualizes many routes (LineStrings) as a "reachability tree / chaos layer".
  // Expected GeoJSON FeatureCollection with LineString geometries and properties including:
  // - duration_min OR duration_sec OR duration (seconds) (used for time filtering + coloring)
  //
  // New in this version:
  // - Optional start marker (e.g. home) via opts.startPoint = [lat, lon] or {lat, lon}
  // - Optional cache busting via opts.cacheBust = true | "v=123" | number

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function minutesFromProps(p) {
    if (!p) return null;
    if (typeof p.duration_min === "number" && isFinite(p.duration_min)) return p.duration_min;
    if (typeof p.duration_sec === "number" && isFinite(p.duration_sec)) return p.duration_sec / 60;
    if (typeof p.duration === "number" && isFinite(p.duration)) return p.duration / 60;
    return null;
  }

  function colorByMinutes(min) {
    if (min == null || !isFinite(min)) return "#666";
    if (min <= 60) return "#1a9850";
    if (min <= 120) return "#91cf60";
    if (min <= 180) return "#fee08b";
    if (min <= 240) return "#fc8d59";
    return "#d73027";
  }

  function defaultNameFromProps(p) {
    return (p && (p.name || p.resort_name || p.resort || p.resortId || p.resort_id))
      ? String(p.name || p.resort_name || p.resort || p.resortId || p.resort_id)
      : "";
  }

  function normalizeStartPoint(sp) {
    // Accept [lat, lon] or {lat, lon}
    if (!sp) return null;
    if (Array.isArray(sp) && sp.length >= 2) {
      const lat = Number(sp[0]);
      const lon = Number(sp[1]);
      if (isFinite(lat) && isFinite(lon)) return [lat, lon];
      return null;
    }
    if (typeof sp === "object") {
      const lat = Number(sp.lat);
      const lon = Number(sp.lon);
      if (isFinite(lat) && isFinite(lon)) return [lat, lon];
    }
    return null;
  }

  function withCacheBust(url, cacheBust) {
    if (!cacheBust) return url;
    const sep = url.includes("?") ? "&" : "?";
    if (cacheBust === true) return url + sep + "v=" + Date.now();
    if (typeof cacheBust === "number" && isFinite(cacheBust)) return url + sep + "v=" + cacheBust;
    if (typeof cacheBust === "string" && cacheBust.trim()) return url + sep + cacheBust.trim().replace(/^\?+/, "");
    return url + sep + "v=" + Date.now();
  }

  async function init(map, opts) {
    if (typeof L === "undefined") throw new Error("Leaflet (L) not available.");
    if (!map) throw new Error("TreeRoutesOverlay.init: map missing.");

    const o = (opts || {});
    const url = o.url;
    const enabled = !!o.enabled;

    // Optional start marker (e.g. home)
    const startPoint = normalizeStartPoint(o.startPoint);
    const startMarkerOptions = o.startMarkerOptions || {}; // Leaflet marker options
    const startPopupText = (typeof o.startPopupText === "string") ? o.startPopupText : null;

    // Style defaults (tunable)
    const styleState = {
      baseOpacity: (typeof o.baseOpacity === "number") ? o.baseOpacity : 0.18,
      weight: (typeof o.weight === "number") ? o.weight : 3.0,

      outlineColor: o.outlineColor || "#000",
      outlineOpacity: (typeof o.outlineOpacity === "number") ? o.outlineOpacity : 0.25,
      outlineWeight: (typeof o.outlineWeight === "number") ? o.outlineWeight : 6.0
    };

    const renderer = o.renderer || L.canvas({ padding: 0.5 });

    if (!url) throw new Error("TreeRoutesOverlay.init: url missing.");

    let allFeatures = [];
    let maxMinutes = Infinity;
    let predicate = null;

    const outlineLayer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
      renderer,
      style: () => ({
        color: styleState.outlineColor,
        weight: styleState.outlineWeight,
        opacity: styleState.outlineOpacity
      })
    });

    const colorLayer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
      renderer,
      style: (feature) => {
        const props = feature && feature.properties ? feature.properties : {};
        const min = minutesFromProps(props);
        return {
          color: colorByMinutes(min),
          weight: styleState.weight,
          opacity: styleState.baseOpacity
        };
      }
    });

    const layers = [outlineLayer, colorLayer];

    // Optional home/start marker
    let startMarkerLayer = null;
    if (startPoint) {
      startMarkerLayer = L.marker(startPoint, startMarkerOptions);
      if (startPopupText) startMarkerLayer.bindPopup(startPopupText);
      layers.push(startMarkerLayer);
    }

    // One checkbox in LayerControl
    const layerGroup = L.layerGroup(layers);

    async function load() {
      const fetchUrl = withCacheBust(url, o.cacheBust);
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error("Failed to load routes GeoJSON: HTTP " + resp.status);
      const fc = await resp.json();
      const feats = Array.isArray(fc && fc.features) ? fc.features : [];
      // keep only LineStrings
      allFeatures = feats.filter(f => f && f.geometry && f.geometry.type === "LineString");
      rebuild();
    }

    function rebuild() {
      const filtered = [];

      for (const f of allFeatures) {
        const props = f.properties || {};
        const mins = minutesFromProps(props);

        // Time filter
        if (isFinite(maxMinutes) && mins != null && isFinite(mins) && mins > maxMinutes) continue;

        // Predicate filter (e.g., pass/verbund/other filters)
        if (typeof predicate === "function") {
          try {
            if (!predicate(props, f)) continue;
          } catch (e) {
            // fail-open to avoid breaking map
            console.warn("TreeRoutesOverlay predicate error:", e);
          }
        }

        filtered.push(f);
      }

      const fcFiltered = { type: "FeatureCollection", features: filtered };
      outlineLayer.clearLayers();
      outlineLayer.addData(fcFiltered);
      colorLayer.clearLayers();
      colorLayer.addData(fcFiltered);
    }

    function setMaxHours(hours) {
      if (hours == null || !isFinite(hours)) {
        maxMinutes = Infinity;
      } else {
        maxMinutes = clamp(Number(hours) * 60, 0, 24 * 60);
      }
      rebuild();
    }

    function setMaxMinutes(minutes) {
      if (minutes == null || !isFinite(minutes)) maxMinutes = Infinity;
      else maxMinutes = clamp(Number(minutes), 0, 24 * 60);
      rebuild();
    }

    function setPredicate(fnOrNull) {
      predicate = (typeof fnOrNull === "function") ? fnOrNull : null;
      rebuild();
    }

    // Live tuning: call from DevTools
    function setStyle(patch) {
      if (!patch || typeof patch !== "object") return;
      if (typeof patch.baseOpacity === "number") styleState.baseOpacity = patch.baseOpacity;
      if (typeof patch.weight === "number") styleState.weight = patch.weight;
      if (typeof patch.outlineOpacity === "number") styleState.outlineOpacity = patch.outlineOpacity;
      if (typeof patch.outlineWeight === "number") styleState.outlineWeight = patch.outlineWeight;
      if (typeof patch.outlineColor === "string") styleState.outlineColor = patch.outlineColor;

      // Force restyle
      outlineLayer.setStyle(() => ({
        color: styleState.outlineColor,
        weight: styleState.outlineWeight,
        opacity: styleState.outlineOpacity
      }));
      colorLayer.setStyle((feature) => {
        const props = feature && feature.properties ? feature.properties : {};
        const min = minutesFromProps(props);
        return {
          color: colorByMinutes(min),
          weight: styleState.weight,
          opacity: styleState.baseOpacity
        };
      });
    }

    function getLayer() { return layerGroup; }
    function getOutlineLayer() { return outlineLayer; }
    function getColorLayer() { return colorLayer; }

    await load();

    if (enabled) layerGroup.addTo(map);

    return {
      getLayer,
      getOutlineLayer,
      getColorLayer,
      setMaxHours,
      setMaxMinutes,
      setPredicate,
      setStyle,
      // helper for matching by name if you want it
      defaultNameFromProps
    };
  }

  window.TreeRoutesOverlay = { init: init };
})();
