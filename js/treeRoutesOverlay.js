(function () {
  "use strict";

  // TreeRoutesOverlay: visualizes many routes (LineStrings) as a "reachability tree / chaos layer".
  // Expected GeoJSON FeatureCollection with LineString geometries and properties including:
  // - name OR resort_name (used for matching to resorts filter)
  // - duration_min OR duration_sec (used for time filtering + coloring)
  //
  // The overlay is intentionally low-opacity so overlaps naturally create "thicker" corridors.

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
    return (p && (p.name || p.resort_name || p.resort || p.resortId || p.resort_id)) ? String(p.name || p.resort_name || p.resort || p.resortId || p.resort_id) : "";
  }

  async function init(map, opts) {
    if (typeof L === "undefined") throw new Error("Leaflet (L) not available.");
    if (!map) throw new Error("TreeRoutesOverlay.init: map missing.");

    const {
      url,
      enabled = false,
      baseOpacity = 0.18,
      weight = 2,
      renderer = L.canvas({ padding: 0.5 })
    } = (opts || {});

    if (!url) throw new Error("TreeRoutesOverlay.init: url missing.");

    let allFeatures = [];
    let maxMinutes = Infinity;
    let predicate = null;

    const layer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
      renderer,
      style: (feature) => {
        const props = feature && feature.properties ? feature.properties : {};
        const min = minutesFromProps(props);
        return {
          color: colorByMinutes(min),
          weight: weight,
          opacity: baseOpacity
        };
      }
    });

    async function load() {
      const resp = await fetch(url);
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

      layer.clearLayers();
      layer.addData({ type: "FeatureCollection", features: filtered });
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

    function getLayer() { return layer; }

    await load();

    if (enabled) layer.addTo(map);

    return {
      getLayer,
      setMaxHours,
      setMaxMinutes,
      setPredicate,
      // helper for matching by name if you want it
      defaultNameFromProps
    };
  }

  window.TreeRoutesOverlay = { init: init };
})();
