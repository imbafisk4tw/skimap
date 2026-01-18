/**
 * Glacier Icon Cache
 *
 * Pre-renders glacier snowflake icons to cached Data URLs for better performance.
 * Uses L.icon instead of L.divIcon to avoid memory leaks.
 *
 * This replaces the old createGlacierIcon function that created new DOM elements
 * on every call, causing memory leaks during filter changes.
 */
(function() {
  'use strict';

  // Pre-rendered icon caches: "size_color" or "size" -> L.icon instance
  const glacierIconCache = {};
  const circleIconCache = {};
  const favoriteIconCache = {};
  const visitedIconCache = {};

  // Snowflake SVG path (Microsoft Fluent Emoji style)
  const SNOWFLAKE_PATH = "M23.5638 18.9L28.6756 17.54C29.229 17.39 29.8126 17.69 29.9636 18.25C30.1145 18.81 29.7824 19.37 29.229 19.52L26.1197 20.35L28.3435 21.62C28.8265 21.9 28.9976 22.51 28.7158 22.99C28.4341 23.47 27.8203 23.64 27.3373 23.36L25.1135 22.09L25.9486 25.18C26.0996 25.74 25.7776 26.3 25.2141 26.45C24.6506 26.6 24.0871 26.27 23.9361 25.72L22.5677 20.64L20.2533 19.31C19.5389 20.1 18.593 20.68 17.5062 20.9V23.53L21.2495 27.25C21.652 27.65 21.652 28.31 21.2495 28.71C20.847 29.11 20.1829 29.11 19.7804 28.71L17.5062 26.45V29C17.5062 29.55 17.0534 30 16.5 30C15.9466 30 15.4938 29.55 15.4938 29V26.46L13.2196 28.72C12.8171 29.12 12.153 29.12 11.7505 28.72C11.348 28.32 11.348 27.66 11.7505 27.26L15.4938 23.54V20.91C14.3969 20.69 13.4611 20.11 12.7467 19.32L10.4424 20.64L9.07391 25.72C8.92298 26.27 8.34942 26.6 7.79598 26.45C7.24255 26.3 6.91049 25.73 7.06142 25.18L7.89661 22.09L5.6728 23.37C5.18981 23.64 4.576 23.48 4.29425 23C4.0125 22.52 4.18356 21.91 4.6565 21.65L6.8803 20.37L3.771 19.54C3.21757 19.39 2.88551 18.82 3.03644 18.27C3.18738 17.72 3.76094 17.39 4.31437 17.54L9.4261 18.9L11.7405 17.57C11.5694 17.08 11.4587 16.55 11.4587 16C11.4587 15.45 11.5694 14.92 11.7405 14.45L9.4261 13.12L4.31437 14.48C3.75088 14.63 3.18738 14.3 3.03644 13.75C2.88551 13.19 3.21757 12.63 3.771 12.48L6.8803 11.65L4.6565 10.37C4.18356 10.09 4.0125 9.48 4.29425 9C4.56594 8.52 5.18981 8.36 5.66274 8.63L7.89661 9.91L7.06142 6.82C6.91049 6.27 7.24255 5.71 7.79598 5.56C8.34942 5.41 8.91291 5.74 9.06385 6.29L10.4323 11.37L12.7366 12.69C13.4511 11.9 14.3969 11.32 15.4837 11.1V8.47L11.7405 4.75C11.338 4.35 11.338 3.69 11.7405 3.29C12.143 2.89 12.8071 2.89 13.2096 3.29L15.4837 5.55V3C15.4837 2.45 15.9365 2 16.4899 2C17.0434 2 17.4962 2.45 17.4962 3V5.55L19.7703 3.29C20.1728 2.89 20.8369 2.89 21.2394 3.29C21.6419 3.69 21.6419 4.35 21.2394 4.75L17.4962 8.47V11.1C18.5829 11.32 19.5288 11.9 20.2332 12.68L22.5475 11.35L23.916 6.27C24.067 5.72 24.6405 5.39 25.194 5.54C25.7474 5.69 26.0795 6.26 25.9285 6.81L25.0933 9.9L27.3171 8.63C27.8001 8.36 28.4139 8.52 28.6957 9C28.9674 9.48 28.8064 10.09 28.3334 10.36L26.1096 11.63L29.2189 12.46C29.7724 12.61 30.1044 13.18 29.9535 13.73C29.8026 14.28 29.229 14.61 28.6756 14.46L23.5638 13.1L21.2495 14.43C21.4205 14.92 21.5312 15.45 21.5312 16C21.5312 16.55 21.4205 17.07 21.2495 17.57L23.5638 18.9ZM19.5087 16C19.5087 14.3431 18.1572 13 16.49 13C14.8228 13 13.4712 14.3431 13.4712 16C13.4712 17.6569 14.8228 19 16.49 19C18.1572 19 19.5087 17.6569 19.5087 16Z";

  // Snowflake gradient colors
  const SNOWFLAKE_COLORS = {
    start: '#43C4F5',
    end: '#3D8DF3'
  };

  /**
   * Create cached glacier icon (snowflake with border)
   */
  function createCachedGlacierIcon(color, size) {
    const cacheKey = `${size}_${color}`;
    if (glacierIconCache[cacheKey]) return glacierIconCache[cacheKey];

    const dpr = window.devicePixelRatio || 1;
    const canvasSize = Math.round(size * dpr);
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const circleRadius = (size - 2) / 2;

    // White background circle (no border)
    ctx.beginPath();
    ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    // Draw snowflake in center
    const snowflakeSize = size * 0.6;
    const offsetX = (size - snowflakeSize) / 2;
    const offsetY = (size - snowflakeSize) / 2;
    const scale = snowflakeSize / 32; // SVG viewBox is 0 0 32 32

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Create gradient for snowflake
    const gradient = ctx.createLinearGradient(0, 0, 32, 32);
    gradient.addColorStop(0, SNOWFLAKE_COLORS.start);
    gradient.addColorStop(1, SNOWFLAKE_COLORS.end);

    // Draw snowflake path
    const path = new Path2D(SNOWFLAKE_PATH);
    ctx.fillStyle = gradient;
    ctx.fill(path);

    ctx.restore();

    // Convert to Data URL and create L.icon
    const dataUrl = canvas.toDataURL('image/png');

    const icon = L.icon({
      iconUrl: dataUrl,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });

    glacierIconCache[cacheKey] = icon;
    return icon;
  }

  /**
   * Create cached circle icon (for glacier markers when highlight is off)
   */
  function createCachedCircleIcon(color, size) {
    const cacheKey = `${size}_${color}`;
    if (circleIconCache[cacheKey]) return circleIconCache[cacheKey];

    const dpr = window.devicePixelRatio || 1;
    const circleSize = Math.round(size * 0.6);
    const canvasSize = Math.round(circleSize * dpr);
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    ctx.scale(dpr, dpr);

    const centerX = circleSize / 2;
    const centerY = circleSize / 2;
    const radius = (circleSize - 4) / 2;

    // Filled circle with border
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Convert to Data URL and create L.icon
    const dataUrl = canvas.toDataURL('image/png');

    const icon = L.icon({
      iconUrl: dataUrl,
      iconSize: [circleSize, circleSize],
      iconAnchor: [circleSize / 2, circleSize / 2],
      popupAnchor: [0, -circleSize / 2]
    });

    circleIconCache[cacheKey] = icon;
    return icon;
  }

  /**
   * Create cached favorite star icon
   */
  function createCachedFavoriteIcon(size) {
    const cacheKey = `${size}`;
    if (favoriteIconCache[cacheKey]) return favoriteIconCache[cacheKey];

    const dpr = window.devicePixelRatio || 1;
    const canvasSize = Math.round(size * dpr);
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;

    // Draw star
    ctx.fillStyle = '#f59e0b';
    ctx.font = `bold ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text shadow effect
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillText('★', centerX, centerY);

    // Glow effect
    ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('★', centerX, centerY);

    const dataUrl = canvas.toDataURL('image/png');

    const icon = L.icon({
      iconUrl: dataUrl,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });

    favoriteIconCache[cacheKey] = icon;
    return icon;
  }

  /**
   * Create cached visited checkmark icon
   */
  function createCachedVisitedIcon(size) {
    const cacheKey = `${size}`;
    if (visitedIconCache[cacheKey]) return visitedIconCache[cacheKey];

    const dpr = window.devicePixelRatio || 1;
    const canvasSize = Math.round(size * dpr);
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = (size - 2) / 2;

    // Green circle background (no border)
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a';
    ctx.fill();

    // Shadow for depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;

    // Checkmark
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${size * 0.6}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✓', centerX, centerY);

    const dataUrl = canvas.toDataURL('image/png');

    const icon = L.icon({
      iconUrl: dataUrl,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });

    visitedIconCache[cacheKey] = icon;
    return icon;
  }

  // Public API
  window.GlacierIconCache = {
    /**
     * Get a cached glacier icon (snowflake)
     */
    getGlacierIcon: function(color, size) {
      return createCachedGlacierIcon(color, size);
    },

    /**
     * Get a cached circle icon
     */
    getCircleIcon: function(color, size) {
      return createCachedCircleIcon(color, size);
    },

    /**
     * Get a cached favorite star icon
     */
    getFavoriteIcon: function(size) {
      return createCachedFavoriteIcon(size);
    },

    /**
     * Get a cached visited checkmark icon
     */
    getVisitedIcon: function(size) {
      return createCachedVisitedIcon(size);
    },

    /**
     * Clear the icon caches (rarely needed)
     */
    clearCache: function() {
      Object.keys(glacierIconCache).forEach(k => delete glacierIconCache[k]);
      Object.keys(circleIconCache).forEach(k => delete circleIconCache[k]);
      Object.keys(favoriteIconCache).forEach(k => delete favoriteIconCache[k]);
      Object.keys(visitedIconCache).forEach(k => delete visitedIconCache[k]);
    },

    /**
     * Pre-warm the cache with common sizes and colors
     */
    warmCache: function(colors) {
      const sizes = [12, 14, 16, 18, 20, 22, 26];
      const defaultColors = colors || ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4'];
      sizes.forEach(size => {
        defaultColors.forEach(color => {
          createCachedGlacierIcon(color, size);
          createCachedCircleIcon(color, size);
        });
        createCachedFavoriteIcon(size);
        createCachedVisitedIcon(size);
      });
    },

    /**
     * Get cache stats for debugging
     */
    getCacheStats: function() {
      return {
        glacierIcons: Object.keys(glacierIconCache).length,
        circleIcons: Object.keys(circleIconCache).length,
        favoriteIcons: Object.keys(favoriteIconCache).length,
        visitedIcons: Object.keys(visitedIconCache).length
      };
    }
  };
})();
