#!/usr/bin/env python3
"""
Sync homes from homes.json to V2 database and calculate routes via OSRM.

Usage:
  # Import homes only
  python sync_homes_and_routes_to_db.py --import-homes

  # Calculate routes for a specific home (requires OSRM running)
  python sync_homes_and_routes_to_db.py --calc-routes --home-id muc --osrm http://localhost:5000

  # Both: import homes and calculate routes for all
  python sync_homes_and_routes_to_db.py --import-homes --calc-routes --osrm http://localhost:5000

  # List homes in DB
  python sync_homes_and_routes_to_db.py --list-homes
"""

import json
import sys
import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
import requests

sys.stdout.reconfigure(encoding='utf-8')

DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "database": "skigebiete_v2",
    "user": "ski",
    "password": "ski"
}

HOMES_JSON_PATH = "../../data/homes.json"


def load_homes_json():
    """Load homes from JSON file."""
    with open(HOMES_JSON_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def import_homes(conn):
    """Import homes from homes.json into the home table."""
    homes = load_homes_json()
    cur = conn.cursor()

    imported = 0
    updated = 0

    for stable_id, data in homes.items():
        name = data.get('name', stable_id)
        lat = data['lat']
        lon = data['lon']

        # Upsert: insert or update on conflict
        cur.execute("""
            INSERT INTO home (stable_id, name, geom, is_public, source)
            VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), true, 'json_import')
            ON CONFLICT (stable_id) DO UPDATE SET
                name = EXCLUDED.name,
                geom = EXCLUDED.geom,
                updated_at = now()
            RETURNING (xmax = 0) as is_insert
        """, (stable_id, name, lon, lat))

        is_insert = cur.fetchone()[0]
        if is_insert:
            imported += 1
        else:
            updated += 1

    conn.commit()
    print(f"Homes: {imported} importiert, {updated} aktualisiert")
    return imported + updated


def list_homes(conn):
    """List all homes in the database."""
    cur = conn.cursor()
    cur.execute("""
        SELECT stable_id, name, ST_Y(geom) as lat, ST_X(geom) as lon, is_public
        FROM home
        ORDER BY stable_id
    """)

    print("Homes in der Datenbank:")
    for row in cur.fetchall():
        stable_id, name, lat, lon, is_public = row
        public_flag = "🟢" if is_public else "⚪"
        print(f"  {public_flag} {stable_id}: {name} ({lat:.4f}, {lon:.4f})")


def get_resorts(conn):
    """Get all resorts with GPS coordinates from the Alps region."""
    cur = conn.cursor()
    cur.execute("""
        SELECT id, stable_id, name, ST_Y(center_geom) as lat, ST_X(center_geom) as lon
        FROM resort
        WHERE center_geom IS NOT NULL
          AND ST_Y(center_geom) BETWEEN 43.5 AND 48.5
          AND ST_X(center_geom) BETWEEN 5.0 AND 17.0
    """)
    return cur.fetchall()


def get_home(conn, home_id):
    """Get home by stable_id."""
    cur = conn.cursor()
    cur.execute("""
        SELECT id, stable_id, name, ST_Y(geom) as lat, ST_X(geom) as lon
        FROM home
        WHERE stable_id = %s
    """, (home_id,))
    return cur.fetchone()


def fetch_route(osrm_base, origin_lat, origin_lon, dest_lat, dest_lon, retries=3):
    """Fetch route from OSRM."""
    url = f"{osrm_base}/route/v1/driving/{origin_lon},{origin_lat};{dest_lon},{dest_lat}"
    params = {
        "overview": "simplified",
        "geometries": "geojson",
        "steps": "false"
    }

    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            if data.get("code") != "Ok":
                return None

            route = data.get("routes", [{}])[0]
            return {
                "duration_s": int(route.get("duration", 0)),
                "distance_m": int(route.get("distance", 0)),
                "geometry": route.get("geometry")
            }
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))
            else:
                print(f"  Route-Fehler: {e}")
                return None

    return None


def calculate_routes(conn, home_id, osrm_base, concurrency=6):
    """Calculate routes from a home to all resorts."""
    home = get_home(conn, home_id)
    if not home:
        print(f"Home '{home_id}' nicht gefunden!")
        return

    home_uuid, home_stable_id, home_name, home_lat, home_lon = home
    print(f"\nBerechne Routen von: {home_name} ({home_lat:.4f}, {home_lon:.4f})")

    resorts = get_resorts(conn)
    print(f"Ziel-Resorts: {len(resorts)}")

    cur = conn.cursor()

    # Delete existing routes for this home
    cur.execute("DELETE FROM precomputed_route WHERE home_id = %s", (home_uuid,))
    conn.commit()
    print(f"Alte Routen gelöscht")

    success = 0
    failed = 0

    def process_resort(resort):
        resort_uuid, resort_stable_id, resort_name, resort_lat, resort_lon = resort
        route = fetch_route(osrm_base, home_lat, home_lon, resort_lat, resort_lon)
        return (resort, route)

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(process_resort, r): r for r in resorts}

        for future in as_completed(futures):
            resort, route = future.result()
            resort_uuid, resort_stable_id, resort_name, resort_lat, resort_lon = resort

            if route:
                # Insert route
                geometry_wkt = None
                if route.get("geometry") and route["geometry"].get("coordinates"):
                    coords = route["geometry"]["coordinates"]
                    if len(coords) >= 2:
                        coord_str = ", ".join([f"{c[0]} {c[1]}" for c in coords])
                        geometry_wkt = f"LINESTRING({coord_str})"

                cur.execute("""
                    INSERT INTO precomputed_route (home_id, resort_id, duration_s, distance_m, geometry, provider)
                    VALUES (%s, %s, %s, %s,
                            CASE WHEN %s IS NOT NULL THEN ST_SetSRID(ST_GeomFromText(%s), 4326) ELSE NULL END,
                            'osrm')
                """, (home_uuid, resort_uuid, route["duration_s"], route["distance_m"], geometry_wkt, geometry_wkt))

                success += 1
                if success % 50 == 0:
                    print(f"  ... {success}/{len(resorts)} berechnet")
                    conn.commit()
            else:
                failed += 1
                print(f"  Fehlgeschlagen: {resort_name}")

    conn.commit()
    print(f"\nFertig: {success} OK, {failed} fehlgeschlagen")

    # Show statistics
    cur.execute("""
        SELECT
            COUNT(*) as total,
            MIN(duration_s) / 60 as min_min,
            MAX(duration_s) / 60 as max_min,
            AVG(duration_s) / 60 as avg_min
        FROM precomputed_route
        WHERE home_id = %s
    """, (home_uuid,))

    stats = cur.fetchone()
    if stats and stats[0] > 0:
        print(f"\nStatistik für {home_name}:")
        print(f"  Routen: {stats[0]}")
        print(f"  Min: {stats[1]:.0f} min")
        print(f"  Max: {stats[2]:.0f} min")
        print(f"  Durchschnitt: {stats[3]:.0f} min")


def main():
    parser = argparse.ArgumentParser(description="Sync homes and calculate routes to V2 database")
    parser.add_argument("--import-homes", action="store_true", help="Import homes from homes.json")
    parser.add_argument("--calc-routes", action="store_true", help="Calculate routes via OSRM")
    parser.add_argument("--home-id", type=str, help="Specific home ID for route calculation (default: all)")
    parser.add_argument("--osrm", type=str, default="http://localhost:5000", help="OSRM server URL")
    parser.add_argument("--list-homes", action="store_true", help="List homes in database")
    parser.add_argument("--concurrency", type=int, default=6, help="Parallel requests (default: 6)")

    args = parser.parse_args()

    if not any([args.import_homes, args.calc_routes, args.list_homes]):
        parser.print_help()
        return

    conn = psycopg2.connect(**DB_CONFIG)

    try:
        if args.list_homes:
            list_homes(conn)
            return

        if args.import_homes:
            print("=== Homes importieren ===")
            import_homes(conn)

        if args.calc_routes:
            print("\n=== Routen berechnen ===")

            if args.home_id:
                # Single home
                calculate_routes(conn, args.home_id, args.osrm, args.concurrency)
            else:
                # All homes
                cur = conn.cursor()
                cur.execute("SELECT stable_id FROM home ORDER BY stable_id")
                home_ids = [row[0] for row in cur.fetchall()]

                if not home_ids:
                    print("Keine Homes in der Datenbank. Erst --import-homes ausführen!")
                    return

                print(f"Berechne Routen für {len(home_ids)} Homes: {', '.join(home_ids)}")

                for hid in home_ids:
                    calculate_routes(conn, hid, args.osrm, args.concurrency)

        print("\n=== FERTIG ===")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
