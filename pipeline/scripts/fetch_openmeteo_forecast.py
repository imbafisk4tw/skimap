#!/usr/bin/env python3
"""
Fetch weather forecasts from Open-Meteo API for all ski resorts.

Open-Meteo advantages over GeoSphere:
- 16 days forecast (vs 2.5 days)
- Global coverage (FR, IT, etc.)
- No API key required
- No strict rate limits

Usage:
    python fetch_openmeteo_forecast.py [--limit N]

API Docs: https://open-meteo.com/en/docs
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# ==============================================================================
# Configuration
# ==============================================================================

OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast"

# Daily parameters for ski resorts
DAILY_PARAMS = [
    "snowfall_sum",           # Total snowfall in cm
    "precipitation_sum",      # Total precipitation in mm
    "temperature_2m_max",     # Max temperature
    "temperature_2m_min",     # Min temperature
    "weathercode",            # WMO weather code
]

# Rate limiting (Open-Meteo is generous but let's be nice)
REQUEST_DELAY_S = 0.3  # 300ms between requests
BATCH_SIZE = 50        # Requests before longer pause
BATCH_PAUSE_S = 2      # Pause between batches

# ==============================================================================
# Resort Loading
# ==============================================================================

def get_resorts_from_json(json_path: Path, limit=None):
    """Load all resorts from resorts.json."""
    with open(json_path, 'r', encoding='utf-8') as f:
        resorts = json.load(f)

    result = []
    for r in resorts:
        if r.get('lat') and r.get('lon'):
            result.append({
                'stable_id': r.get('stable_id', r.get('name', '').lower().replace(' ', '-')),
                'name': r.get('name'),
                'country': r.get('country', ''),
                'lat': r['lat'],
                'lon': r['lon'],
                'max_elevation_m': r.get('maxElevation')
            })

    if limit:
        result = result[:limit]
    return result


# ==============================================================================
# Open-Meteo API
# ==============================================================================

def fetch_forecast(lat: float, lon: float, elevation: int = None) -> dict | None:
    """
    Fetch 16-day forecast from Open-Meteo API.

    Args:
        lat: Latitude
        lon: Longitude
        elevation: Optional elevation in meters (improves accuracy for mountains)

    Returns:
        API response dict or None on error
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": ",".join(DAILY_PARAMS),
        "timezone": "Europe/Berlin",
        "forecast_days": 16,
    }

    # Use resort elevation if available (better accuracy for mountain locations)
    if elevation and elevation > 500:
        params["elevation"] = elevation

    try:
        response = requests.get(OPENMETEO_URL, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error: {e}")
        return None


def parse_openmeteo_response(data: dict) -> list:
    """
    Parse Open-Meteo API response into forecast records.

    Returns list of daily forecasts with snow, temp, etc.
    """
    if not data or 'daily' not in data:
        return []

    daily = data['daily']
    dates = daily.get('time', [])
    snowfall = daily.get('snowfall_sum', [])
    precip = daily.get('precipitation_sum', [])
    temp_max = daily.get('temperature_2m_max', [])
    temp_min = daily.get('temperature_2m_min', [])
    weathercode = daily.get('weathercode', [])

    forecasts = []
    for i, date in enumerate(dates):
        forecasts.append({
            'date': date,
            'snowfall_cm': snowfall[i] if i < len(snowfall) else None,
            'precip_mm': precip[i] if i < len(precip) else None,
            'temp_max': temp_max[i] if i < len(temp_max) else None,
            'temp_min': temp_min[i] if i < len(temp_min) else None,
            'weathercode': weathercode[i] if i < len(weathercode) else None,
        })

    return forecasts


def get_weather_icon(code: int) -> str:
    """Convert WMO weather code to emoji."""
    if code is None:
        return ""
    if code in (71, 73, 75, 77, 85, 86):  # Snow
        return "❄️"
    if code in (51, 53, 55, 61, 63, 65, 80, 81, 82):  # Rain
        return "🌧️"
    if code in (95, 96, 99):  # Thunderstorm
        return "⛈️"
    if code in (45, 48):  # Fog
        return "🌫️"
    if code in (1, 2, 3):  # Partly cloudy
        return "⛅"
    if code == 0:  # Clear
        return "☀️"
    return "☁️"


# ==============================================================================
# Export
# ==============================================================================

def export_forecasts_to_json(all_forecasts: dict, output_path: Path):
    """Export all forecasts to a JSON file."""
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Open-Meteo",
        "forecast_days": 16,
        "forecasts": all_forecasts
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Exported to {output_path}")


# ==============================================================================
# Main
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="Fetch Open-Meteo weather forecasts")
    parser.add_argument("--limit", type=int, help="Limit number of resorts to fetch")
    args = parser.parse_args()

    print("=== Open-Meteo Forecast Fetcher ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print()

    # Load resorts
    json_path = Path(__file__).parent.parent.parent / "data" / "resorts.json"
    if not json_path.exists():
        print(f"Error: {json_path} not found")
        return

    resorts = get_resorts_from_json(json_path, args.limit)
    print(f"Loaded {len(resorts)} resorts from {json_path}")
    print(f"Fetching 16-day forecasts...")
    print()

    # Fetch forecasts
    all_forecasts = {}
    success_count = 0
    error_count = 0

    for i, resort in enumerate(resorts):
        stable_id = resort['stable_id']
        safe_name = resort['name'].encode('ascii', 'replace').decode('ascii')
        print(f"[{i+1}/{len(resorts)}] {safe_name}...", end=" ", flush=True)

        data = fetch_forecast(
            resort['lat'],
            resort['lon'],
            resort.get('max_elevation_m')
        )

        if data:
            forecasts = parse_openmeteo_response(data)

            if forecasts:
                # Calculate summary stats
                snow_3d = sum(f.get('snowfall_cm') or 0 for f in forecasts[:3])
                snow_7d = sum(f.get('snowfall_cm') or 0 for f in forecasts[:7])

                all_forecasts[stable_id] = {
                    'name': resort['name'],
                    'country': resort['country'],
                    'snow_3d_cm': round(snow_3d, 1),
                    'snow_7d_cm': round(snow_7d, 1),
                    'daily': forecasts
                }
                print(f"OK (3d: {snow_3d:.0f}cm, 7d: {snow_7d:.0f}cm)")
                success_count += 1
            else:
                print("No data")
                error_count += 1
        else:
            print("Failed")
            error_count += 1

        # Rate limiting
        time.sleep(REQUEST_DELAY_S)

        # Batch pause
        if (i + 1) % BATCH_SIZE == 0:
            print(f"  [Batch pause {BATCH_PAUSE_S}s...]")
            time.sleep(BATCH_PAUSE_S)

    print()
    print(f"=== Done ===")
    print(f"Success: {success_count}, Errors: {error_count}")

    # Export
    if all_forecasts:
        output_dir = Path(__file__).parent.parent.parent / "data" / "forecasts"
        output_dir.mkdir(exist_ok=True)
        export_forecasts_to_json(all_forecasts, output_dir / "openmeteo_forecast.json")


if __name__ == "__main__":
    main()
