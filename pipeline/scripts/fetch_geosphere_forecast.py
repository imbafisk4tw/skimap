#!/usr/bin/env python3
"""
Fetch weather forecasts from GeoSphere Austria API and store in database.

Usage:
    python fetch_geosphere_forecast.py [--dry-run] [--limit N]

GeoSphere API:
    - Dataset: nwp-v1-1h-2500m (Numerische Wettervorhersage)
    - Horizont: 61 Stunden
    - Auflösung: 2.5km, stündlich
    - Abdeckung: Österreich + Umgebung (5.5°-22.1°E, 43°-51.8°N)
    - Keine Authentifizierung erforderlich

Cron: Empfohlen 2x täglich (06:00 und 18:00 UTC)
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# Database connection (optional - can also export to JSON)
try:
    import psycopg2
    from psycopg2.extras import execute_values
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False
    print("Warning: psycopg2 not installed. Will export to JSON only.")

# ==============================================================================
# Configuration
# ==============================================================================

GEOSPHERE_BASE_URL = "https://dataset.api.hub.geosphere.at/v1"
DATASET = "nwp-v1-1h-2500m"

# Parameters to fetch (exact API names from metadata)
PARAMETERS = [
    "snow_acc",  # Total snowfall amount (kg/m², roughly = mm water equivalent)
    "snowlmt",   # Snowlimit (m) - height where snow melts
    "t2m",       # Temperature 2m (°C)
    "rr_acc",    # Total precipitation (mm)
]

# Rate limiting (GeoSphere has strict rate limits: 5/s, 240/h)
REQUEST_DELAY_S = 1.0  # Delay between batch requests
MAX_RETRIES = 3        # Retry on 502/503/429 errors
RATE_LIMIT_BACKOFF_S = 30  # Wait time when hitting rate limit (429)
BATCH_SIZE = 20        # Number of locations per request (API supports multiple lat_lon)

# Bounding box for Alps (skip resorts outside GeoSphere coverage)
# Note: GeoSphere covers AT + surrounding area, but FR/IT mostly return errors
GEOSPHERE_BBOX = {
    "min_lat": 43.0,
    "max_lat": 51.8,
    "min_lon": 5.5,
    "max_lon": 22.1
}

# Countries with reliable GeoSphere coverage
COVERED_COUNTRIES = {"AT", "DE", "CH", "SI"}  # FR, IT have limited coverage

# ==============================================================================
# Database Functions
# ==============================================================================

def get_db_connection():
    """Get database connection from environment variables."""
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ.get("DB_NAME", "skigebiete"),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", "")
    )


def get_resorts_from_db(conn, limit=None):
    """Fetch resorts with coordinates from database."""
    query = """
        SELECT
            id,
            stable_id,
            name,
            ST_Y(center_geom::geometry) as lat,
            ST_X(center_geom::geometry) as lon,
            max_elevation_m
        FROM resort
        WHERE center_geom IS NOT NULL
        ORDER BY stable_id
    """
    if limit:
        query += f" LIMIT {limit}"

    with conn.cursor() as cur:
        cur.execute(query)
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def get_resorts_from_json(json_path: Path, limit=None, countries=None):
    """Fallback: Load resorts from resorts.json."""
    with open(json_path, 'r', encoding='utf-8') as f:
        resorts = json.load(f)

    result = []
    for r in resorts:
        if r.get('lat') and r.get('lon'):
            country = r.get('country', '')
            # Filter by country if specified
            if countries and country not in countries:
                continue
            result.append({
                'id': None,  # No UUID in JSON
                'stable_id': r.get('stable_id', r.get('name', '').lower().replace(' ', '-')),
                'name': r.get('name'),
                'country': country,
                'lat': r['lat'],
                'lon': r['lon'],
                'max_elevation_m': r.get('maxElevation')
            })

    if limit:
        result = result[:limit]
    return result


def save_forecasts_to_db(conn, resort_id: str, forecasts: list):
    """Save forecasts to database."""
    if not forecasts:
        return 0

    query = """
        INSERT INTO weather_forecast
            (resort_id, provider, forecast_time, snowfall_mm, snowfall_cm,
             snow_limit_m, temp_2m, precip_mm, fetched_at)
        VALUES %s
        ON CONFLICT (resort_id, provider, forecast_time)
        DO UPDATE SET
            snowfall_mm = EXCLUDED.snowfall_mm,
            snowfall_cm = EXCLUDED.snowfall_cm,
            snow_limit_m = EXCLUDED.snow_limit_m,
            temp_2m = EXCLUDED.temp_2m,
            precip_mm = EXCLUDED.precip_mm,
            fetched_at = EXCLUDED.fetched_at
    """

    now = datetime.now(timezone.utc)
    values = [
        (
            resort_id,
            'geosphere',
            f['timestamp'],
            f.get('snowfall_mm'),
            f.get('snowfall_cm'),
            f.get('snow_limit_m'),
            f.get('temp_2m'),
            f.get('precip_mm'),
            now
        )
        for f in forecasts
    ]

    with conn.cursor() as cur:
        execute_values(cur, query, values)

    return len(values)


# ==============================================================================
# GeoSphere API Functions
# ==============================================================================

def is_in_geosphere_coverage(lat: float, lon: float) -> bool:
    """Check if coordinates are within GeoSphere API coverage."""
    return (
        GEOSPHERE_BBOX["min_lat"] <= lat <= GEOSPHERE_BBOX["max_lat"] and
        GEOSPHERE_BBOX["min_lon"] <= lon <= GEOSPHERE_BBOX["max_lon"]
    )


def fetch_forecast_batch(locations: list[tuple[float, float]]) -> dict | None:
    """
    Fetch weather forecast from GeoSphere API for multiple points in one request.

    Args:
        locations: List of (lat, lon) tuples

    Returns:
        Parsed GeoJSON data with multiple features, or None on error.
    """
    url = f"{GEOSPHERE_BASE_URL}/timeseries/forecast/{DATASET}"

    # Build params with multiple lat_lon entries
    # requests library handles list values as repeated params: lat_lon=x,y&lat_lon=a,b
    params = [
        ("parameters", ",".join(PARAMETERS)),
        ("output_format", "geojson"),
    ]
    for lat, lon in locations:
        params.append(("lat_lon", f"{lat},{lon}"))

    for attempt in range(MAX_RETRIES + 1):
        try:
            response = requests.get(url, params=params, timeout=60)  # Longer timeout for batch
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            status = getattr(e.response, 'status_code', None) if hasattr(e, 'response') else None
            # Retry on 502, 503, 429 errors
            if status in (502, 503, 429) and attempt < MAX_RETRIES:
                # Rate limit (429) needs longer backoff
                if status == 429:
                    wait_time = RATE_LIMIT_BACKOFF_S
                    print(f"\n  [429 Rate Limit] Waiting {wait_time}s before retry {attempt+1}/{MAX_RETRIES}...", end=" ", flush=True)
                else:
                    wait_time = (attempt + 1) * 3  # Exponential backoff: 3s, 6s, 9s
                    print(f"  [{status}] Retry {attempt+1}/{MAX_RETRIES} in {wait_time}s...", end=" ", flush=True)
                time.sleep(wait_time)
                continue
            print(f"  Error: {e}")
            return None
    return None


def fetch_forecast(lat: float, lon: float) -> dict | None:
    """Fetch forecast for a single point (wrapper for backwards compatibility)."""
    return fetch_forecast_batch([(lat, lon)])


def parse_feature_forecasts(feature: dict, timestamps: list) -> list:
    """Parse a single GeoJSON feature into forecast records."""
    props = feature.get('properties', {})
    parameters = props.get('parameters', {})

    # Extract parameter arrays (using correct API parameter names)
    snowfall = parameters.get('snow_acc', {}).get('data', [])   # kg/m² ≈ mm
    snow_limit = parameters.get('snowlmt', {}).get('data', [])  # m
    temp = parameters.get('t2m', {}).get('data', [])            # °C
    precip = parameters.get('rr_acc', {}).get('data', [])       # mm

    forecasts = []
    for i, ts in enumerate(timestamps):
        snowfall_mm = snowfall[i] if i < len(snowfall) else None

        # Estimate snow cm from water equivalent
        # Ratio depends on temperature, typically 1:10 to 1:20
        snowfall_cm = None
        if snowfall_mm is not None and snowfall_mm > 0:
            temp_at_time = temp[i] if i < len(temp) else 0
            # Colder = fluffier snow = higher ratio
            if temp_at_time < -10:
                ratio = 15
            elif temp_at_time < -5:
                ratio = 12
            elif temp_at_time < 0:
                ratio = 10
            else:
                ratio = 8
            snowfall_cm = round(snowfall_mm * ratio / 10, 1)

        forecasts.append({
            'timestamp': ts,
            'snowfall_mm': round(snowfall_mm, 1) if snowfall_mm else None,
            'snowfall_cm': snowfall_cm,
            'snow_limit_m': int(snow_limit[i]) if i < len(snow_limit) and snow_limit[i] else None,
            'temp_2m': round(temp[i], 1) if i < len(temp) and temp[i] is not None else None,
            'precip_mm': round(precip[i], 1) if i < len(precip) and precip[i] else None,
        })

    return forecasts


def parse_geosphere_batch_response(data: dict, resorts: list) -> dict:
    """
    Parse GeoSphere API batch response into forecast records per resort.

    Args:
        data: GeoSphere API response (GeoJSON with multiple features)
        resorts: List of resort dicts with lat/lon (in same order as request)

    Returns:
        Dict mapping stable_id to forecast data
    """
    if not data or 'features' not in data:
        return {}

    features = data.get('features', [])
    timestamps = data.get('timestamps', [])

    if not features or not timestamps:
        return {}

    results = {}

    # Features are returned in same order as requested lat_lon params
    for i, feature in enumerate(features):
        if i >= len(resorts):
            break

        resort = resorts[i]
        forecasts = parse_feature_forecasts(feature, timestamps)

        if forecasts:
            results[resort['stable_id']] = {
                'name': resort['name'],
                'lat': resort['lat'],
                'lon': resort['lon'],
                'forecasts': forecasts
            }

    return results


def parse_geosphere_response(data: dict, max_elevation_m: int = None) -> list:
    """Parse single-location response (backwards compatibility)."""
    if not data or 'features' not in data:
        return []

    features = data.get('features', [])
    timestamps = data.get('timestamps', [])

    if not features or not timestamps:
        return []

    return parse_feature_forecasts(features[0], timestamps)


# ==============================================================================
# Export Functions
# ==============================================================================

def export_forecasts_to_json(all_forecasts: dict, output_path: Path):
    """Export all forecasts to a JSON file."""
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "GeoSphere Austria",
        "dataset": DATASET,
        "forecasts": all_forecasts
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Exported to {output_path}")


# ==============================================================================
# Main
# ==============================================================================

def load_existing_forecasts(output_path: Path) -> tuple[dict, datetime | None]:
    """Load existing forecasts to resume from previous run.

    Returns:
        Tuple of (forecasts dict, generated_at datetime or None)
    """
    if output_path.exists():
        try:
            with open(output_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                forecasts = data.get('forecasts', {})
                generated_at = None
                if 'generated_at' in data:
                    try:
                        generated_at = datetime.fromisoformat(data['generated_at'].replace('Z', '+00:00'))
                    except (ValueError, AttributeError):
                        pass
                return forecasts, generated_at
        except Exception as e:
            print(f"Warning: Could not load existing forecasts: {e}")
    return {}, None


def main():
    parser = argparse.ArgumentParser(description="Fetch GeoSphere weather forecasts")
    parser.add_argument("--dry-run", action="store_true", help="Don't save to database")
    parser.add_argument("--limit", type=int, help="Limit number of resorts to fetch")
    parser.add_argument("--json-only", action="store_true", help="Export to JSON, skip database")
    parser.add_argument("--resorts-json", type=Path, help="Path to resorts.json (fallback if no DB)")
    parser.add_argument("--resume", action="store_true", help="Resume from previous run (skip already fetched)")
    parser.add_argument("--max-age", type=float, default=12.0, help="Max age in hours before re-fetching (default: 12)")
    parser.add_argument("--save-interval", type=int, default=20, help="Save progress every N resorts")
    args = parser.parse_args()

    print(f"=== GeoSphere Forecast Fetcher ===")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print()

    # Get resorts
    conn = None
    if HAS_PSYCOPG2 and not args.json_only:
        try:
            conn = get_db_connection()
            resorts = get_resorts_from_db(conn, args.limit)
            print(f"Loaded {len(resorts)} resorts from database")
        except Exception as e:
            print(f"Database error: {e}")
            conn = None

    if conn is None:
        # Fallback to JSON (filter to countries with GeoSphere coverage)
        json_path = args.resorts_json or Path(__file__).parent.parent.parent / "data" / "resorts.json"
        if json_path.exists():
            resorts = get_resorts_from_json(json_path, args.limit, countries=COVERED_COUNTRIES)
            print(f"Loaded {len(resorts)} resorts from {json_path} (filtered to {', '.join(COVERED_COUNTRIES)})")
        else:
            print(f"Error: No database connection and {json_path} not found")
            sys.exit(1)

    # Filter to GeoSphere coverage
    resorts_in_coverage = [r for r in resorts if is_in_geosphere_coverage(r['lat'], r['lon'])]
    skipped = len(resorts) - len(resorts_in_coverage)
    if skipped > 0:
        print(f"Skipping {skipped} resorts outside GeoSphere coverage")

    # Output path
    output_dir = Path(__file__).parent.parent.parent / "data" / "forecasts"
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / "current_forecast.json"

    # Load existing forecasts if resuming
    all_forecasts = {}
    data_is_fresh = False
    if args.resume:
        all_forecasts, generated_at = load_existing_forecasts(output_path)
        if all_forecasts:
            # Check if data is still fresh
            if generated_at:
                age_hours = (datetime.now(timezone.utc) - generated_at).total_seconds() / 3600
                data_is_fresh = age_hours < args.max_age
                print(f"Existing data: {len(all_forecasts)} forecasts, {age_hours:.1f}h old (max: {args.max_age}h)")
                if not data_is_fresh:
                    print(f"Data too old, will re-fetch all resorts")
                    all_forecasts = {}  # Clear old data
            else:
                print(f"Resuming: loaded {len(all_forecasts)} existing forecasts (no timestamp)")
                data_is_fresh = True  # Assume fresh if no timestamp

    # Filter out already fetched resorts (only if data is fresh)
    if all_forecasts and data_is_fresh:
        resorts_to_fetch = [r for r in resorts_in_coverage if r['stable_id'] not in all_forecasts]
        already_done = len(resorts_in_coverage) - len(resorts_to_fetch)
        if already_done > 0:
            print(f"Skipping {already_done} already fetched resorts")
    else:
        resorts_to_fetch = resorts_in_coverage

    # Calculate batches
    num_batches = (len(resorts_to_fetch) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"Fetching forecasts for {len(resorts_to_fetch)} resorts in {num_batches} batches (batch size: {BATCH_SIZE})...")
    print()

    # Fetch forecasts in batches
    success_count = 0
    error_count = 0
    consecutive_errors = 0
    MAX_CONSECUTIVE_ERRORS = 3  # Stop if too many batch errors in a row

    for batch_idx in range(num_batches):
        batch_start = batch_idx * BATCH_SIZE
        batch_end = min(batch_start + BATCH_SIZE, len(resorts_to_fetch))
        batch_resorts = resorts_to_fetch[batch_start:batch_end]

        # Build location list for batch request
        locations = [(r['lat'], r['lon']) for r in batch_resorts]

        total_done = len(all_forecasts)
        print(f"Batch {batch_idx+1}/{num_batches} ({len(batch_resorts)} resorts, {total_done} total done)...", end=" ", flush=True)

        data = fetch_forecast_batch(locations)

        if data:
            batch_results = parse_geosphere_batch_response(data, batch_resorts)

            if batch_results:
                # Merge results into all_forecasts
                all_forecasts.update(batch_results)
                batch_success = len(batch_results)
                success_count += batch_success
                consecutive_errors = 0

                print(f"OK ({batch_success}/{len(batch_resorts)} resorts)")

                # Save progress after each batch
                export_forecasts_to_json(all_forecasts, output_path)
            else:
                print("No data in response")
                error_count += len(batch_resorts)
                consecutive_errors += 1
        else:
            print("Failed")
            error_count += len(batch_resorts)
            consecutive_errors += 1

        # Stop if too many consecutive batch errors
        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            print(f"\n*** Too many consecutive batch errors ({consecutive_errors}), stopping early ***")
            print(f"*** Run again with --resume to continue ***")
            break

        # Rate limiting between batches
        time.sleep(REQUEST_DELAY_S)

    # Commit database changes
    if conn and not args.dry_run:
        conn.commit()
        conn.close()

    print()
    print(f"=== Done ===")
    print(f"This run: Success: {success_count}, Errors: {error_count}")
    print(f"Total forecasts: {len(all_forecasts)}")

    # Export final JSON
    if all_forecasts:
        export_forecasts_to_json(all_forecasts, output_path)


if __name__ == "__main__":
    main()
