#!/usr/bin/env python3
"""
Fetch weather forecasts from Open-Meteo API for all ski resorts.

Open-Meteo advantages over GeoSphere:
- 16 days forecast (vs 2.5 days)
- Global coverage (FR, IT, etc.)
- No API key required
- No strict rate limits
- Supports explicit elevation parameter for mountain/valley forecasts

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

# Batch configuration - Open-Meteo supports multiple locations per request
BATCH_SIZE = 50        # Locations per request (Open-Meteo allows ~50)
BATCH_PAUSE_S = 1      # Pause between batch requests
REQUEST_TIMEOUT_S = 60 # Timeout per batch request (longer for multi-location)
MAX_RETRIES = 3        # Retry failed batches

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
                'min_elevation_m': r.get('minElevation'),
                'max_elevation_m': r.get('maxElevation')
            })

    if limit:
        result = result[:limit]
    return result


# ==============================================================================
# Open-Meteo API (Batch Requests)
# ==============================================================================

def fetch_batch_forecast(resorts: list, elevation_key: str = None, retry_count: int = 0) -> list | None:
    """
    Fetch 16-day forecasts for multiple locations in a single request.

    Open-Meteo supports comma-separated lat/lon values for batch requests.
    When elevation_key is specified, uses that elevation for weather calculation.

    Args:
        resorts: List of resort dicts with lat, lon, min_elevation_m, max_elevation_m
        elevation_key: 'min_elevation_m' for valley, 'max_elevation_m' for mountain, None for default
        retry_count: Current retry attempt

    Returns:
        List of API responses (one per location) or None on error
    """
    if not resorts:
        return []

    # Build comma-separated coordinate strings
    lats = ",".join(str(r['lat']) for r in resorts)
    lons = ",".join(str(r['lon']) for r in resorts)

    params = {
        "latitude": lats,
        "longitude": lons,
        "daily": ",".join(DAILY_PARAMS),
        "timezone": "Europe/Berlin",
        "forecast_days": 16,
    }

    # Add elevation if specified (for mountain/valley differentiation)
    if elevation_key:
        elevations = []
        for r in resorts:
            elev = r.get(elevation_key)
            if elev is not None:
                elevations.append(str(int(elev)))
            else:
                # Fallback: use API default (terrain model)
                elevations.append("nan")
        params["elevation"] = ",".join(elevations)

    try:
        response = requests.get(OPENMETEO_URL, params=params, timeout=REQUEST_TIMEOUT_S)
        response.raise_for_status()
        data = response.json()

        # Single location returns dict, multiple returns list
        if isinstance(data, dict):
            return [data]
        return data

    except requests.exceptions.Timeout as e:
        if retry_count < MAX_RETRIES:
            wait_time = (retry_count + 1) * 5
            print(f"\n  Timeout, retrying in {wait_time}s (attempt {retry_count + 1}/{MAX_RETRIES})...")
            time.sleep(wait_time)
            return fetch_batch_forecast(resorts, elevation_key, retry_count + 1)
        print(f"\n  Error after {MAX_RETRIES} retries: {e}")
        return None

    except requests.exceptions.RequestException as e:
        if retry_count < MAX_RETRIES and "429" in str(e):
            wait_time = (retry_count + 1) * 10
            print(f"\n  Rate limited, waiting {wait_time}s...")
            time.sleep(wait_time)
            return fetch_batch_forecast(resorts, elevation_key, retry_count + 1)
        print(f"\n  Error: {e}")
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

def process_batch(batch_resorts: list, all_forecasts: dict, elevation_key: str, location_type: str) -> tuple[int, int]:
    """
    Process a batch of resorts and update the forecasts dict.

    Args:
        batch_resorts: List of resort dicts
        all_forecasts: Dict to update with results
        elevation_key: 'min_elevation_m' or 'max_elevation_m'
        location_type: 'valley' or 'mountain'

    Returns:
        Tuple of (success_count, error_count)
    """
    success = 0
    errors = 0

    responses = fetch_batch_forecast(batch_resorts, elevation_key)

    if responses is None:
        # Entire batch failed
        return 0, len(batch_resorts)

    for resort, data in zip(batch_resorts, responses):
        stable_id = resort['stable_id']
        forecasts = parse_openmeteo_response(data)

        if forecasts:
            snow_3d = sum(f.get('snowfall_cm') or 0 for f in forecasts[:3])
            snow_7d = sum(f.get('snowfall_cm') or 0 for f in forecasts[:7])

            # Initialize resort entry if not exists
            if stable_id not in all_forecasts:
                all_forecasts[stable_id] = {
                    'name': resort['name'],
                    'country': resort['country'],
                }

            # Add mountain or valley data
            all_forecasts[stable_id][location_type] = {
                'elevation_m': resort.get(elevation_key),
                'snow_3d_cm': round(snow_3d, 1),
                'snow_7d_cm': round(snow_7d, 1),
                'daily': forecasts
            }
            success += 1
        else:
            errors += 1

    return success, errors


def fetch_all_forecasts(resorts: list, elevation_key: str, location_type: str, all_forecasts: dict) -> tuple[int, int]:
    """
    Fetch forecasts for all resorts at a specific elevation (mountain or valley).

    Args:
        resorts: List of resort dicts
        elevation_key: 'min_elevation_m' or 'max_elevation_m'
        location_type: 'valley' or 'mountain'
        all_forecasts: Dict to update with results

    Returns:
        Tuple of (total_success, total_errors)
    """
    num_batches = (len(resorts) + BATCH_SIZE - 1) // BATCH_SIZE
    total_success = 0
    total_errors = 0

    for batch_idx in range(num_batches):
        batch_start = batch_idx * BATCH_SIZE
        batch_end = min(batch_start + BATCH_SIZE, len(resorts))
        batch_resorts = resorts[batch_start:batch_end]

        # Show batch progress
        first_name = batch_resorts[0]['name'].encode('ascii', 'replace').decode('ascii')
        last_name = batch_resorts[-1]['name'].encode('ascii', 'replace').decode('ascii')
        print(f"  [{location_type.capitalize()} {batch_idx + 1}/{num_batches}] {first_name} ... {last_name}...", end=" ", flush=True)

        success, errors = process_batch(batch_resorts, all_forecasts, elevation_key, location_type)
        total_success += success
        total_errors += errors

        print(f"OK ({success}/{len(batch_resorts)})")

        # Pause between batches (except after the last one)
        if batch_idx < num_batches - 1:
            time.sleep(BATCH_PAUSE_S)

    return total_success, total_errors


def main():
    parser = argparse.ArgumentParser(description="Fetch Open-Meteo weather forecasts")
    parser.add_argument("--limit", type=int, help="Limit number of resorts to fetch")
    args = parser.parse_args()

    print("=== Open-Meteo Forecast Fetcher (Mountain/Valley Mode) ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print()

    # Load resorts
    json_path = Path(__file__).parent.parent.parent / "data" / "resorts.json"
    if not json_path.exists():
        print(f"Error: {json_path} not found")
        return

    resorts = get_resorts_from_json(json_path, args.limit)
    print(f"Loaded {len(resorts)} resorts from {json_path}")

    # Count resorts with elevation data
    with_elevation = sum(1 for r in resorts if r.get('min_elevation_m') and r.get('max_elevation_m'))
    print(f"Resorts with elevation data: {with_elevation}/{len(resorts)}")
    print()

    # Calculate total batches (2x for mountain + valley)
    num_batches = (len(resorts) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"Fetching 16-day forecasts: {num_batches} batches x 2 (mountain + valley)...")
    print()

    all_forecasts = {}
    start_time = time.time()

    # First pass: Mountain (max_elevation)
    print("--- Fetching MOUNTAIN forecasts (max elevation) ---")
    mountain_success, mountain_errors = fetch_all_forecasts(
        resorts, 'max_elevation_m', 'mountain', all_forecasts
    )
    print(f"Mountain: {mountain_success} success, {mountain_errors} errors")
    print()

    # Second pass: Valley (min_elevation)
    print("--- Fetching VALLEY forecasts (min elevation) ---")
    valley_success, valley_errors = fetch_all_forecasts(
        resorts, 'min_elevation_m', 'valley', all_forecasts
    )
    print(f"Valley: {valley_success} success, {valley_errors} errors")
    print()

    elapsed = time.time() - start_time
    print(f"=== Done in {elapsed:.1f}s ===")
    print(f"Total: {mountain_success + valley_success} forecasts, {mountain_errors + valley_errors} errors")

    # Export
    if all_forecasts:
        output_dir = Path(__file__).parent.parent.parent / "data" / "forecasts"
        output_dir.mkdir(exist_ok=True)
        export_forecasts_to_json(all_forecasts, output_dir / "openmeteo_forecast.json")


if __name__ == "__main__":
    main()
