import json
from pathlib import Path
import requests
import math

# ORS_API_KEY wird aus Umgebungsvariable oder .env-Datei gelesen
import os

def load_api_key():
    # 1. Umgebungsvariable versuchen
    key = os.environ.get("ORS_API_KEY")
    if key:
        return key.strip()
    # 2. .env-Datei im aktuellen Ordner
    env_path = Path(".env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("ORS_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None

ORS_API_KEY = load_api_key()

# resorts.json ist die einzige Quelle der Skigebiete
RESORTS_FILE = Path("resorts.json")

# Durchschnittsgeschwindigkeit für Fallback (km/h)
AVG_SPEED_KMH = 70.0

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def load_resorts():
    if not RESORTS_FILE.exists():
        raise SystemExit(f"{RESORTS_FILE} nicht gefunden. Bitte resorts.json in diesen Ordner legen.")
    with RESORTS_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)

def ask_origin():
    print("Startadresse für diese Session eingeben:")
    print("  - Leer lassen = Claude-Lorrain-Str. 23, 81543 München (Standard)")
    print("  - 'lat,lon' = Koordinaten direkt (z.B. 48.12,11.57)")
    print("  - sonst: Adresse, die über ORS Geocoding gesucht wird")


    s = input("Adresse: ").strip()
    if not s:
        # Standard: Claude-Lorrain-Str. 23 (ungefähre Koordinaten)
        return 48.119782, 11.569842

    if "," in s:
        try:
            lat_str, lon_str = s.split(",", 1)
            lat = float(lat_str.strip())
            lon = float(lon_str.strip())
            return lat, lon
        except ValueError:
            print("Konnte Eingabe nicht als lat,lon interpretieren, versuche Geocoding...")


    url = "https://api.openrouteservice.org/geocode/search"
    params = {
        "api_key": ORS_API_KEY,
        "text": s,
        "size": 1,
    }
    resp = requests.get(url, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    feats = data.get("features") or []
    if not feats:
        raise SystemExit("Adresse konnte nicht gefunden werden.")
    lon, lat = feats[0]["geometry"]["coordinates"]
    print(f"Gefundene Koordinaten: lat={lat:.6f}, lon={lon:.6f}")
    return lat, lon

def main():
    if not ORS_API_KEY:
        raise SystemExit("Bitte zuerst ORS_API_KEY als Umgebungsvariable oder in .env setzen (ORS_API_KEY=...).")

    resorts = load_resorts()
    if not resorts:
        raise SystemExit("Keine Skigebiete in resorts.json gefunden.")

    origin_lat, origin_lon = ask_origin()

    locations = [[origin_lon, origin_lat]] + [[r["lon"], r["lat"]] for r in resorts]
    sources = [0]
    destinations = list(range(1, len(locations)))

    body = {
        "locations": locations,
        "metrics": ["distance", "duration"],
        "units": "km",
        "sources": sources,
        "destinations": destinations,
    }

    url = "https://api.openrouteservice.org/v2/matrix/driving-car"

    print(f"Sende Matrix-Anfrage an ORS für {len(resorts)} Skigebiete ...")


    resp = requests.post(
        url,
        headers={
            "Authorization": ORS_API_KEY,
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    durations = data.get("durations", [[]])[0]
    distances = data.get("distances", [[]])[0]

    travel_times = {}

    for idx, r in enumerate(resorts):
        name = r["name"]
        lat = r["lat"]
        lon = r["lon"]

        dur_sec = durations[idx] if idx < len(durations) else None
        dist_km = distances[idx] if idx < len(distances) else None

        if dur_sec is None or dist_km is None:
            print(f"Warnung: keine Routingdaten für '{name}', nutze Haversine-Fallback.")
            dist_km = haversine_km(origin_lat, origin_lon, lat, lon)
            dur_sec = dist_km / AVG_SPEED_KMH * 3600.0

        hours = round(dur_sec / 3600.0, 2)
        km = round(dist_km, 1)

        travel_times[name] = {
            "hours": hours,
            "km": km,
        }

    out_file = Path("travel_times.json")
    with out_file.open("w", encoding="utf-8") as f:
        json.dump(travel_times, f, ensure_ascii=False, indent=2)

    print(f"Fertig. {out_file.name} mit {len(travel_times)} Einträgen geschrieben.")
    any_item = next(iter(travel_times.items()))
    print("Beispiel:", any_item)


if __name__ == "__main__":
    main()
