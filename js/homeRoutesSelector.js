// js/homeRoutesSelector.js
// Home dropdown that auto-detects which precomputed route files exist (based on data/homes.json + existence check)
// and lets the user switch the active home profile.
//
// Expected:
// - data/homes.json: { "muc": { "name": "...", "lat": 48.1, "lon": 11.5 }, ... }
// - data/routes/home_<homeId>.geojson exists for homes you want selectable.

(function () {
  const mod = {};

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
    return r.json();
  }

  async function fileExists(url) {
    try {
      // GitHub Pages is fine with GET; HEAD sometimes fails depending on setup.
      const r = await fetch(url, { method: "GET", cache: "no-cache" });
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  function placeBox({ box, desktopHostSelector, mobileHostId }) {
    if (!box) return;

    if (isMobile()) {
      const host = document.getElementById(mobileHostId);
      if (host) {
        if (host.firstChild) host.insertBefore(box, host.firstChild);
        else host.appendChild(box);
      }
    } else {
      const host = document.querySelector(desktopHostSelector) || document.querySelector(".leaflet-top.leaflet-right");
      if (host) host.appendChild(box);
    }
  }

  mod.init = async function init(opts) {
    const {
      homesUrl,
      routeFile,
      defaultHomeId,
      selectId,
      boxId,
      desktopHostSelector,
      mobileHostId,
      storageKey,
      onHomeChanged
    } = opts;

    const select = document.getElementById(selectId);
    const box = document.getElementById(boxId);
    if (!select || !box) return;

    let homesObj;
    try {
      homesObj = await fetchJson(homesUrl);
    } catch (e) {
      console.warn("HomeRoutesSelector: homes.json not available:", e);
      return;
    }

    const homesAll = Object.entries(homesObj).map(([id, h]) => ({
      id,
      name: (h && h.name) ? String(h.name) : id,
      lat: h?.lat,
      lon: h?.lon
    }));

    const checks = await Promise.all(
      homesAll.map(async (h) => (await fileExists(routeFile(h.id))) ? h : null)
    );
    const available = checks.filter(Boolean);

    if (!available.length) {
      box.style.display = "none";
      return;
    }

    select.innerHTML = "";
    for (const h of available) {
      const opt = document.createElement("option");
      opt.value = h.id;
      opt.textContent = h.name;
      select.appendChild(opt);
    }

    const saved = storageKey ? localStorage.getItem(storageKey) : null;
    const initial = (saved && available.some(h => h.id === saved))
      ? saved
      : (available.some(h => h.id === defaultHomeId) ? defaultHomeId : available[0].id);

    select.value = initial;

    box.style.display = "";
    placeBox({ box, desktopHostSelector, mobileHostId });

    const rePlace = () => placeBox({ box, desktopHostSelector, mobileHostId });
    window.addEventListener("resize", rePlace);
    if (window.matchMedia) {
      const mq = window.matchMedia("(max-width: 720px)");
      if (mq.addEventListener) mq.addEventListener("change", rePlace);
    }

    const meta0 = available.find(h => h.id === initial);
    if (typeof onHomeChanged === "function") {
      try { await onHomeChanged(initial, meta0); } catch (e) { console.warn("HomeRoutesSelector onHomeChanged failed:", e); }
    }

    select.addEventListener("change", async () => {
      const homeId = select.value;
      const meta = available.find(h => h.id === homeId);
      if (storageKey) localStorage.setItem(storageKey, homeId);

      if (typeof onHomeChanged === "function") {
        try { await onHomeChanged(homeId, meta); } catch (e) { console.warn("HomeRoutesSelector onHomeChanged failed:", e); }
      }
    });
  };

  window.HomeRoutesSelector = mod;
})();
