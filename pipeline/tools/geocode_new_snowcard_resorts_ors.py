
import json
import time
import requests

"""
Geocoding-Script für SnowCard-Tirol-Resorts mit OpenRouteService-Geocoder.

Voraussetzung:
    pip install requests

Dateien:
    - new_snowcard_resorts_block.json   (nur die neuen Gebiete)
    - resorts.json                      (deine bestehende Datei)

Konfiguration:
    - ORS_API_KEY unten eintragen!

Ablauf:
    1. Dieses Script im gleichen Ordner wie beide JSON-Dateien speichern.
    2. python geocode_new_snowcard_resorts_ors.py ausführen.
    3. Es wird resorts_geocoded.json erzeugt.
       Wenn alles passt, kannst du die alte resorts.json durch diese ersetzen.
"""

ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImRhZjIxYzViN2RhZjQ1ZmNhZGY4ZjNlZThhZjEzODE3IiwiaCI6Im11cm11cjY0In0="

GEOCODE_URL = "https://api.openrouteservice.org/geocode/search"

HEADERS = {
    "User-Agent": "Snowcard-Geocoder-ORS/1.0"
}

def geocode(name):
    if not ORS_API_KEY or ORS_API_KEY.startswith("HIER_"):
        raise RuntimeError("Bitte zuerst ORS_API_KEY im Script eintragen.")
    params = {
        "api_key": ORS_API_KEY,
        "text": f"{name}, Tirol, Austria, Skigebiet",
        "size": 1
    }
    resp = requests.get(GEOCODE_URL, params=params, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    feats = data.get("features") or []
    if not feats:
        return None
    geom = feats[0].get("geometry", {})
    coords = geom.get("coordinates")
    if not coords or len(coords) < 2:
        return None
    lon, lat = coords[0], coords[1]
    try:
        return float(lat), float(lon)
    except (TypeError, ValueError):
        return None

def norm(name: str) -> str:
    return " ".join(name.lower().replace("–", "-").replace("—", "-").split())

def main():
    with open("resorts.json", "r", encoding="utf-8") as f:
        resorts_all = json.load(f)

    with open("new_snowcard_resorts_block.json", "r", encoding="utf-8") as f:
        new_block = json.load(f)

    existing_names = {norm(r["name"]) for r in resorts_all}

    enriched = []
    for r in new_block:
        n = r["name"]
        if norm(n) in existing_names:
            print(f"[SKIP] {n} existiert bereits in resorts.json")
            continue

        print(f"[GEOCODE] {n} ...", end=" ", flush=True)
        try:
            coords = geocode(n)
        except Exception as e:
            print(f"Fehler: {e}; lat/lon bleiben 0.0")
            r["lat"] = 0.0
            r["lon"] = 0.0
            enriched.append(r)
            continue

        if coords is None:
            print("keine Treffer, lat/lon bleiben 0.0")
            r["lat"] = 0.0
            r["lon"] = 0.0
        else:
            lat, lon = coords
            r["lat"] = lat
            r["lon"] = lon
            print(f"OK -> {lat:.5f}, {lon:.5f}")

        enriched.append(r)
        time.sleep(0.5)

    print(f"\n{len(enriched)} neue Resorts, werden ans Ende von resorts.json angehängt.")

    merged = resorts_all + enriched

    with open("resorts_geocoded.json", "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print("Fertig. Neue Datei: resorts_geocoded.json")

if __name__ == "__main__":
    main()
