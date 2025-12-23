/**
 * Leaflet helper to load and manage the "Tree Routes" overlay.
 * - routes: two-pass render (outline + colored) for contrast
 * - optional corridors: trunk/corridor segments (overlap counts)
 *
 * Public API:
 *  - layerGroup: Leaflet layer group for LayerControl
 *  - setMaxHours(h), setPredicate(fn), setResortsById(map), refresh()
 *  - setRouteStyle({ ... }) for live tuning
 */

export async function createTreeLayer(opts) {
  const {
    map,
    homeId,
    routesUrl,
    corridorsUrl = null,

    // route stroke defaults (tune)
    baseOpacity = 0.85,        // colored stroke opacity
    weight = 3,                // colored stroke width
    outlineOpacity = 0.25,
    outlineWeight = 6,
    outlineColor = "#000",

    // corridor defaults
    corridorOpacity = 0.18,

    // behavior
    enabled = false
  } = opts || {};

  if (!map) throw new Error("createTreeLayer: missing map");
  if (!routesUrl) throw new Error("createTreeLayer: missing routesUrl");

  const canvasRenderer = L.canvas({ padding: 0.5 });

  // user-managed join map: resortsById should be set by caller (resorts.json join)
  let resortsById = opts.resortsById || null;

  // state
  let maxHours = (typeof opts.maxHours === "number") ? opts.maxHours : 3;
  let predicate = null;

  // Load data
  const routesFc = await fetch(routesUrl).then(r => r.json());
  const allRoutes = Array.isArray(routesFc.features) ? routesFc.features : [];

  const corridorsFc = corridorsUrl ? await fetch(corridorsUrl).then(r => r.json()) : null;

  // Style helpers
  function minutesFromProps(p) {
    if (!p) return 999999;
    if (typeof p.duration_min === "number" && isFinite(p.duration_min)) return p.duration_min;
    if (typeof p.duration_sec === "number" && isFinite(p.duration_sec)) return p.duration_sec / 60;
    if (typeof p.duration === "number" && isFinite(p.duration)) return p.duration / 60;
    return 999999;
  }

  function colorByMinutes(min) {
    if (min <= 60) return "#1a9850";
    if (min <= 120) return "#91cf60";
    if (min <= 180) return "#fee08b";
    if (min <= 240) return "#fc8d59";
    return "#d73027";
  }

  function corridorWeight(count) {
    const w = Math.sqrt(count || 1);
    return Math.max(1, Math.min(10, w));
  }

  // Corridors (optional)
  const corridorsLayer = corridorsFc ? L.geoJSON(corridorsFc, {
    renderer: canvasRenderer,
    style: (f) => ({
      color: "#222",
      weight: corridorWeight(f.properties?.count),
      opacity: corridorOpacity
    })
  }) : null;

  // Two-pass routes
  const routesOutlineLayer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
    renderer: canvasRenderer,
    style: () => ({
      color: outlineColor,
      weight: outlineWeight,
      opacity: outlineOpacity
    })
  });

  const routesColorLayer = L.geoJSON({ type: "FeatureCollection", features: [] }, {
    renderer: canvasRenderer,
    style: (f) => ({
      color: colorByMinutes(minutesFromProps(f.properties)),
      weight: weight,
      opacity: baseOpacity
    })
  });

  // One checkbox in LayerControl:
  const treeRoutesLayer = L.layerGroup([routesOutlineLayer, routesColorLayer]);

  // Predicate + time filter
  function passes(routeFt) {
    const minutes = minutesFromProps(routeFt.properties);
    if (minutes > maxHours * 60) return false;

    if (!predicate) return true;

    const resortId = routeFt.properties?.resort_id;
    const resort = resortsById && resortId ? resortsById[resortId] : null;
    return !!predicate(routeFt.properties, resort, routeFt);
  }

  function refresh() {
    const filtered = allRoutes.filter(f => f && f.geometry?.type === "LineString").filter(passes);
    const fcFiltered = { type: "FeatureCollection", features: filtered };

    routesOutlineLayer.clearLayers();
    routesOutlineLayer.addData(fcFiltered);

    routesColorLayer.clearLayers();
    routesColorLayer.addData(fcFiltered);
  }

  // Group for LayerControl / external management
  const layerGroup = L.layerGroup([]);
  if (corridorsLayer) layerGroup.addLayer(corridorsLayer);
  layerGroup.addLayer(treeRoutesLayer);

  if (enabled) layerGroup.addTo(map);

  // Public API
  const api = {
    homeId,
    layerGroup,

    // expose sublayers for devtools tuning
    treeRoutesLayer,
    routesOutlineLayer,
    routesColorLayer,
    corridorsLayer,

    setMaxHours(h) { maxHours = Number(h) || 0; refresh(); },
    setPredicate(fn) { predicate = (typeof fn === "function") ? fn : null; refresh(); },
    setResortsById(mapObj) { resortsById = mapObj || null; refresh(); },

    setRouteStyle(patch) {
      if (!patch || typeof patch !== "object") return;
      // update outline
      const oCol = (typeof patch.outlineColor === "string") ? patch.outlineColor : outlineColor;
      const oW = (typeof patch.outlineWeight === "number") ? patch.outlineWeight : outlineWeight;
      const oOp = (typeof patch.outlineOpacity === "number") ? patch.outlineOpacity : outlineOpacity;

      routesOutlineLayer.setStyle(() => ({
        color: oCol,
        weight: oW,
        opacity: oOp
      }));

      // update colored
      const w = (typeof patch.weight === "number") ? patch.weight : weight;
      const op = (typeof patch.baseOpacity === "number") ? patch.baseOpacity : baseOpacity;
      const customColorFn = (typeof patch.colorByMinutes === "function") ? patch.colorByMinutes : colorByMinutes;

      routesColorLayer.setStyle((f) => ({
        color: customColorFn(minutesFromProps(f.properties)),
        weight: w,
        opacity: op
      }));
    },

    refresh
  };

  // initial
  refresh();

  return api;
}
