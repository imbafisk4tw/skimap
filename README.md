# Skigebiete Karte

Interactive map of ~700 ski resorts in the Alps with travel times, snow forecasts, and more.

**[Live Demo](https://imbafisk4tw.github.io/skimap/)**

<img width="1275" height="597" alt="Screenshot 2026-01-15 215422" src="https://github.com/user-attachments/assets/f7d7ed0d-7213-4d4b-8c22-a2a26af8a713" />


## Features

- **Interactive Map** - Leaflet-based map with all ski resorts in AT, DE, CH, IT, FR, SI
- **Travel Time Filter** - Filter resorts by driving time from predefined locations
- **Snow Forecasts** - 48h (GeoSphere) and 16-day (Open-Meteo) snow predictions
- **Mountain/Valley Weather** - Separate forecasts for summit and base elevations
- **Glacier Resorts** - Highlighted with snowflake icons
- **Ski Pass Integration** - Snow Card Tirol, SuperSkiCard, and other regional passes
- **Resort Groups** - Connected ski areas shown as hexagon markers
- **Favorites & Visited** - Track your personal ski resort list (stored locally)
- **Dark Mode** - Easy on the eyes for evening trip planning
- **Bilingual** - German and English UI

## Tech Stack

- **Frontend:** Vanilla JavaScript, Leaflet.js, no build tools required
- **Data:** Static JSON files, updated via GitHub Actions
- **Hosting:** GitHub Pages
- **Weather APIs:** GeoSphere Austria, Open-Meteo

## Data Sources

- Resort data compiled from multiple sources
- Weather forecasts from [GeoSphere Austria](https://www.geosphere.at/) and [Open-Meteo](https://open-meteo.com/)
- Routing data from [OSRM](http://project-osrm.org/) (precomputed)
- Lift/piste vectors from OpenStreetMap via [OpenSkiMap](https://openskimap.org/)

## Local Development

Simply open `index.html` in your browser - no build step required.

For live reload during development:
```bash
npx serve .
```

## License

This project is for personal/educational use. Weather data is provided by GeoSphere Austria and Open-Meteo under their respective terms.

---

Made with :heart: for ski enthusiasts
