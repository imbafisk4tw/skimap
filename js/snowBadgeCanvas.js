/**
 * Snow Badge Canvas Layer
 *
 * Renders snow badges on a single Canvas element for better performance.
 * Replaces the DOM-based DivIcon approach which caused lag during map dragging.
 */
(function() {
  'use strict';

  // Badge data storage
  const badgeData = [];
  let canvas = null;
  let ctx = null;
  let canvasLayer = null;
  let isEnabled = false;

  // Create the canvas layer
  function createCanvasLayer(map) {
    if (canvasLayer) {
      map.removeLayer(canvasLayer);
    }

    // Create custom Canvas layer
    const SnowBadgeLayer = L.Layer.extend({
      onAdd: function(map) {
        this._map = map;

        // Create canvas
        canvas = L.DomUtil.create('canvas', 'snow-badge-canvas');
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '500';

        // Add to overlay pane
        const pane = map.getPane('overlayPane');
        pane.appendChild(canvas);

        ctx = canvas.getContext('2d');

        // Bind events - nur nach Ende von Move/Zoom neu zeichnen
        map.on('moveend', this._redraw, this);
        map.on('zoomend', this._onZoomEnd, this);
        map.on('resize', this._resize, this);

        this._resize();
        this._redraw();
      },

      onRemove: function(map) {
        map.off('moveend', this._redraw, this);
        map.off('zoomend', this._onZoomEnd, this);
        map.off('resize', this._resize, this);

        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        canvas = null;
        ctx = null;
      },

      _onZoomEnd: function() {
        // Nach Zoom: Resize und Redraw
        this._resize();
        this._redraw();
      },

      _resize: function() {
        if (!canvas || !this._map) return;

        const size = this._map.getSize();
        const ratio = window.devicePixelRatio || 1;

        canvas.width = size.x * ratio;
        canvas.height = size.y * ratio;
        canvas.style.width = size.x + 'px';
        canvas.style.height = size.y + 'px';

        // Context-Einstellungen für scharfes Rendering
        if (ctx) {
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          // Schärfere Text-Darstellung
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
        }
      },

      _redraw: function() {
        if (!canvas || !ctx || !this._map) return;

        const ratio = window.devicePixelRatio || 1;
        const size = this._map.getSize();

        // Clear canvas mit korrekter Transformation
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, size.x, size.y);

        // Position canvas at map origin
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(canvas, topLeft);

        // Draw all badges
        const bounds = this._map.getBounds();
        const zoom = this._map.getZoom();

        badgeData.forEach(badge => {
          // Skip if outside view
          if (!bounds.contains([badge.lat, badge.lon])) return;

          // Convert to pixel coordinates
          const point = this._map.latLngToContainerPoint([badge.lat, badge.lon]);

          // Get size based on zoom
          const sizeMultiplier = getZoomSizeMultiplier(zoom);
          const radius = badge.radius * sizeMultiplier;
          const fontSize = Math.round(badge.fontSize * sizeMultiplier);

          // Offset: rechts oben vom Marker
          const offsetX = 4;
          const offsetY = -radius;

          // Runde auf ganze Pixel für schärfere Darstellung
          const x = Math.round(point.x + offsetX + radius);
          const y = Math.round(point.y + offsetY);

          // Draw badge circle
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = badge.color;
          ctx.fill();

          // White border - etwas dicker für bessere Sichtbarkeit
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Draw text - ohne Shadow für schärfere Darstellung
          ctx.fillStyle = 'white';
          ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Text-Outline für bessere Lesbarkeit (statt Shadow)
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.strokeText(badge.text, x, y);

          // Weißer Text darüber
          ctx.fillText(badge.text, x, y);
        });
      },

      update: function() {
        this._redraw();
      }
    });

    canvasLayer = new SnowBadgeLayer();
    canvasLayer.addTo(map);

    return canvasLayer;
  }

  // Zoom-based size multiplier
  function getZoomSizeMultiplier(zoom) {
    if (zoom >= 9) return 1.0;
    if (zoom === 8) return 0.85;
    if (zoom === 7) return 0.75;
    if (zoom === 6) return 0.65;
    return 0.55;
  }

  // Bergfex color scale
  function getBergfexSnowColor(cm) {
    if (cm >= 90) return '#FF4500';  // Rot-Orange
    if (cm >= 70) return '#FF8C00';  // Orange
    if (cm >= 50) return '#9932CC';  // Lila
    if (cm >= 40) return '#0000CD';  // Dunkelblau
    if (cm >= 30) return '#1E90FF';  // Blau
    if (cm >= 20) return '#00CED1';  // Cyan
    if (cm >= 15) return '#00FFFF';  // Hellcyan
    if (cm >= 10) return '#FFFF00';  // Gelb
    if (cm >= 5)  return '#ADFF2F';  // Gelbgrün
    return '#98FB98';                 // Hellgrün
  }

  // Badge size based on snow amount
  function getSnowBadgeParams(cm) {
    if (cm >= 50) return { radius: 11, fontSize: 12 };  // large
    if (cm >= 20) return { radius: 9, fontSize: 10 };   // medium
    return { radius: 7, fontSize: 8 };                   // small
  }

  // Public API
  window.SnowBadgeCanvas = {
    /**
     * Initialize the canvas layer on a map
     */
    init: function(map) {
      createCanvasLayer(map);
    },

    /**
     * Clear all badges
     */
    clear: function() {
      badgeData.length = 0;
      if (canvasLayer && canvasLayer._redraw) {
        canvasLayer._redraw();
      }
    },

    /**
     * Add a snow badge
     */
    addBadge: function(lat, lon, snowCm, stableId) {
      if (snowCm < 5) return; // Nur ab 5cm anzeigen

      const params = getSnowBadgeParams(snowCm);

      badgeData.push({
        lat: lat,
        lon: lon,
        snow: snowCm,
        text: Math.round(snowCm).toString(),
        color: getBergfexSnowColor(snowCm),
        radius: params.radius,
        fontSize: params.fontSize,
        stableId: stableId
      });
    },

    /**
     * Batch add badges (more efficient)
     */
    setBadges: function(badges) {
      badgeData.length = 0;

      badges.forEach(b => {
        if (b.snow < 5) return;

        const params = getSnowBadgeParams(b.snow);

        badgeData.push({
          lat: b.lat,
          lon: b.lon,
          snow: b.snow,
          text: Math.round(b.snow).toString(),
          color: getBergfexSnowColor(b.snow),
          radius: params.radius,
          fontSize: params.fontSize,
          stableId: b.stableId
        });
      });

      if (canvasLayer && canvasLayer._redraw) {
        canvasLayer._redraw();
      }
    },

    /**
     * Redraw the canvas
     */
    redraw: function() {
      if (canvasLayer && canvasLayer._redraw) {
        canvasLayer._redraw();
      }
    },

    /**
     * Enable/disable the canvas layer
     */
    setEnabled: function(enabled) {
      isEnabled = enabled;
      if (canvas) {
        canvas.style.display = enabled ? 'block' : 'none';
      }
      if (!enabled) {
        this.clear();
      }
    },

    /**
     * Check if enabled
     */
    isEnabled: function() {
      return isEnabled;
    },

    /**
     * Get badge count
     */
    getBadgeCount: function() {
      return badgeData.length;
    },

    /**
     * Remove the layer completely
     */
    remove: function(map) {
      if (canvasLayer && map) {
        map.removeLayer(canvasLayer);
        canvasLayer = null;
      }
      badgeData.length = 0;
    }
  };
})();
