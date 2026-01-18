/**
 * Verbund Marker Icon Cache
 *
 * Pre-renders Verbund hexagon icons to cached Data URLs for better performance.
 * Uses L.icon instead of L.divIcon to avoid memory leaks while keeping interactivity.
 *
 * Features:
 * - Icons rendered once per size and cached as Data URLs
 * - Full Leaflet marker interactivity (popups, clicks)
 * - No memory leak from DOM element recreation
 */
(function() {
  'use strict';

  // Pre-rendered icon cache: "size_letter" -> L.icon instance
  const iconCache = {};

  // Get marker letter based on current language
  function getMarkerLetter() {
    if (window.i18n && typeof window.i18n.getLang === 'function') {
      return window.i18n.getLang() === 'en' ? 'G' : 'V';
    }
    return 'V'; // Default to German
  }

  // Colors
  const COLORS = {
    fillStart: '#8B5CF6',  // Violett Gradient Start
    fillEnd: '#6366F1',    // Violett Gradient End
    stroke: '#4C1D95',     // Dunkles Violett
    text: '#FFFFFF'        // Weiß
  };

  // Create hexagon path on canvas
  function drawHexagon(ctx, x, y, radius) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const hx = x + radius * Math.cos(angle);
      const hy = y + radius * Math.sin(angle);
      if (i === 0) {
        ctx.moveTo(hx, hy);
      } else {
        ctx.lineTo(hx, hy);
      }
    }
    ctx.closePath();
  }

  // Pre-render a hexagon icon to Data URL and create L.icon
  function createCachedIcon(size) {
    const letter = getMarkerLetter();
    const cacheKey = `${size}_${letter}`;
    if (iconCache[cacheKey]) return iconCache[cacheKey];

    const dpr = window.devicePixelRatio || 1;
    const canvasSize = Math.round(size * dpr);
    const offCanvas = document.createElement('canvas');
    offCanvas.width = canvasSize;
    offCanvas.height = canvasSize;
    const ctx = offCanvas.getContext('2d');

    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.42;

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, COLORS.fillStart);
    gradient.addColorStop(1, COLORS.fillEnd);

    // Draw hexagon
    drawHexagon(ctx, centerX, centerY, radius);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Stroke
    ctx.strokeStyle = COLORS.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw letter text (V=Verbund in DE, G=Group in EN)
    const fontSize = Math.round(size * 0.35);
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, centerX, centerY + 1);

    // Convert to Data URL and create L.icon
    const dataUrl = offCanvas.toDataURL('image/png');

    const icon = L.icon({
      iconUrl: dataUrl,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });

    iconCache[cacheKey] = icon;
    return icon;
  }

  // Get icon size based on zoom level
  function getIconSize(zoom) {
    if (zoom >= 10) return 28;
    if (zoom >= 9) return 24;
    if (zoom >= 8) return 20;
    if (zoom >= 7) return 16;
    if (zoom >= 6) return 14;
    return 12;
  }

  // Public API
  window.VerbundIconCache = {
    /**
     * Get a cached L.icon for the given size
     */
    getIcon: function(size) {
      return createCachedIcon(size);
    },

    /**
     * Get icon for current zoom level
     */
    getIconForZoom: function(zoom) {
      const size = getIconSize(zoom);
      return createCachedIcon(size);
    },

    /**
     * Get the icon size for a zoom level
     */
    getIconSize: getIconSize,

    /**
     * Clear the icon cache (rarely needed)
     */
    clearCache: function() {
      Object.keys(iconCache).forEach(k => delete iconCache[k]);
    },

    /**
     * Pre-warm the cache with common sizes
     */
    warmCache: function() {
      [12, 14, 16, 20, 24, 28].forEach(size => createCachedIcon(size));
    }
  };
})();
