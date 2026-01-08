(function () {
  "use strict";

  // CorridorOverlay: visualizes route corridors with line width based on usage count
  // and color based on travel time (like TreeRoutes).
  //
  // Expected GeoJSON FeatureCollection with LineString geometries and properties:
  // - count: number of routes using this segment
  // - duration_min: minimum travel time to reach this segment (in minutes)

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  // Color by travel time (same scheme as TreeRoutes)
  // Green = close (< 1h), Yellow = medium (2-3h), Red = far (> 4h)
  function colorByDuration(minutes) {
    if (minutes == null || !isFinite(minutes)) return "#666";
    if (minutes <= 60) return "#1a9850";   // Green - under 1 hour
    if (minutes <= 120) return "#91cf60";  // Light green - 1-2 hours
    if (minutes <= 180) return "#fee08b";  // Yellow - 2-3 hours
    if (minutes <= 240) return "#fc8d59";  // Orange - 3-4 hours
    return "#d73027";                       // Red - over 4 hours
  }

  // Line weight scales with route count
  function weightByCount(count, maxCount, minWeight, maxWeight) {
    if (!count || !maxCount) return minWeight;
    const ratio = clamp(count / maxCount, 0, 1);
    // Use sqrt for more gradual scaling
    return minWeight + (maxWeight - minWeight) * Math.sqrt(ratio);
  }

  // Format duration for tooltip
  function formatDuration(minutes) {
    if (minutes == null) return "?";
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m} min`;
    return `${h}h ${m}min`;
  }

  async function init(map, opts) {
    if (typeof L === "undefined") throw new Error("Leaflet (L) not available.");
    if (!map) throw new Error("CorridorOverlay.init: map missing.");

    const o = opts || {};
    const url = o.url;
    const enabled = !!o.enabled;

    if (!url) throw new Error("CorridorOverlay.init: url missing.");

    // Style config
    const styleState = {
      minWeight: typeof o.minWeight === "number" ? o.minWeight : 2,
      maxWeight: typeof o.maxWeight === "number" ? o.maxWeight : 10,
      baseOpacity: typeof o.baseOpacity === "number" ? o.baseOpacity : 0.8
    };

    const renderer = o.renderer || L.canvas({ padding: 0.5 });

    let allFeatures = [];
    let maxCount = 1;
    let maxDurationMin = 300;

    // Outline layer (dark border for better visibility)
    const outlineLayer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
      renderer,
      style: (feature) => {
        const props = feature?.properties || {};
        const count = props.count || 1;
        return {
          color: "#000",
          weight: weightByCount(count, maxCount, styleState.minWeight, styleState.maxWeight) + 2,
          opacity: styleState.baseOpacity * 0.4,
          lineCap: "round",
          lineJoin: "round"
        };
      }
    });

    // Main corridor layer (colored by duration)
    const corridorLayer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
      renderer,
      style: (feature) => {
        const props = feature?.properties || {};
        const count = props.count || 1;
        const duration = props.duration_min;
        return {
          color: colorByDuration(duration),
          weight: weightByCount(count, maxCount, styleState.minWeight, styleState.maxWeight),
          opacity: styleState.baseOpacity,
          lineCap: "round",
          lineJoin: "round"
        };
      },
      onEachFeature: (feature, layer) => {
        const props = feature?.properties || {};
        const duration = formatDuration(props.duration_min);
        const count = props.count || 0;
        layer.bindTooltip(`${duration} | ${count} Routen`, { sticky: true });
      }
    });

    const layerGroup = L.layerGroup([outlineLayer, corridorLayer]);

    async function load() {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Failed to load corridors GeoJSON: HTTP " + resp.status);
      const fc = await resp.json();

      // Extract max values from properties
      if (fc.properties?.max_count) {
        maxCount = fc.properties.max_count;
      }
      if (fc.properties?.max_duration_min) {
        maxDurationMin = fc.properties.max_duration_min;
      }

      const feats = Array.isArray(fc?.features) ? fc.features : [];
      allFeatures = feats.filter(f => f?.geometry?.type === "LineString");

      // Calculate maxCount if not in properties
      if (!fc.properties?.max_count && allFeatures.length > 0) {
        maxCount = Math.max(...allFeatures.map(f => f.properties?.count || 0));
      }

      rebuild();
    }

    function rebuild() {
      const fcFiltered = { type: "FeatureCollection", features: allFeatures };
      outlineLayer.clearLayers();
      outlineLayer.addData(fcFiltered);
      corridorLayer.clearLayers();
      corridorLayer.addData(fcFiltered);
    }

    function setStyle(patch) {
      if (!patch || typeof patch !== "object") return;
      if (typeof patch.minWeight === "number") styleState.minWeight = patch.minWeight;
      if (typeof patch.maxWeight === "number") styleState.maxWeight = patch.maxWeight;
      if (typeof patch.baseOpacity === "number") styleState.baseOpacity = patch.baseOpacity;

      outlineLayer.setStyle((feature) => {
        const props = feature?.properties || {};
        const count = props.count || 1;
        return {
          color: "#000",
          weight: weightByCount(count, maxCount, styleState.minWeight, styleState.maxWeight) + 2,
          opacity: styleState.baseOpacity * 0.4,
          lineCap: "round",
          lineJoin: "round"
        };
      });

      corridorLayer.setStyle((feature) => {
        const props = feature?.properties || {};
        const count = props.count || 1;
        const duration = props.duration_min;
        return {
          color: colorByDuration(duration),
          weight: weightByCount(count, maxCount, styleState.minWeight, styleState.maxWeight),
          opacity: styleState.baseOpacity,
          lineCap: "round",
          lineJoin: "round"
        };
      });
    }

    function getLayer() { return layerGroup; }
    function getMaxCount() { return maxCount; }
    function getMaxDurationMin() { return maxDurationMin; }
    function getFeatureCount() { return allFeatures.length; }

    await load();

    if (enabled) layerGroup.addTo(map);

    return {
      getLayer,
      getMaxCount,
      getMaxDurationMin,
      getFeatureCount,
      setStyle,
      rebuild
    };
  }

  window.CorridorOverlay = { init };
})();
