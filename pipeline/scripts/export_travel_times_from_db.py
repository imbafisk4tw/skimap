#!/usr/bin/env python3
"""
Export travel times from V2 database to JSON files for the frontend.

Usage:
  # Export all homes
  python export_travel_times_from_db.py

  # Export specific home
  python export_travel_times_from_db.py --home-id muc

  # Show statistics only
  python export_travel_times_from_db.py --stats
"""

import json
import sys
import argparse
import os

import psycopg2

sys.stdout.reconfigure(encoding='utf-8')

DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "database": "skigebiete_v2",
    "user": "ski",
    "password": "ski"
}

OUTPUT_DIR = "../../data/travel_times"


def export_travel_times(conn, home_id, output_dir):
    """Export travel times for a specific home to JSON."""
    cur = conn.cursor()

    # Get home info
    cur.execute("""
        SELECT id, stable_id, name
        FROM home
        WHERE stable_id = %s
    """, (home_id,))

    home = cur.fetchone()
    if not home:
        print(f"Home '{home_id}' nicht gefunden!")
        return False

    home_uuid, home_stable_id, home_name = home

    # Get all routes for this home
    cur.execute("""
        SELECT
            r.stable_id as resort_id,
            pr.duration_s,
            pr.distance_m
        FROM precomputed_route pr
        JOIN resort r ON r.id = pr.resort_id
        WHERE pr.home_id = %s
        ORDER BY pr.duration_s
    """, (home_uuid,))

    routes = cur.fetchall()

    if not routes:
        print(f"Keine Routen für '{home_id}' gefunden!")
        return False

    # Build JSON structure (compatible with existing frontend)
    travel_times = {}
    for resort_id, duration_s, distance_m in routes:
        travel_times[resort_id] = {
            "duration_min": round(duration_s / 60, 1),
            "duration_sec": duration_s,
            "distance_km": round(distance_m / 1000, 1) if distance_m else None
        }

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    # Write JSON file
    output_path = os.path.join(output_dir, f"home_{home_stable_id}.json")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(travel_times, f, indent=2, ensure_ascii=False)

    print(f"  {home_name}: {len(routes)} Routen -> {output_path}")
    return True


def show_stats(conn):
    """Show statistics about routes in the database."""
    cur = conn.cursor()

    print("\n=== Routen-Statistik ===\n")

    cur.execute("""
        SELECT
            h.stable_id,
            h.name,
            COUNT(pr.resort_id) as route_count,
            MIN(pr.duration_s) / 60 as min_min,
            MAX(pr.duration_s) / 60 as max_min,
            AVG(pr.duration_s) / 60 as avg_min
        FROM home h
        LEFT JOIN precomputed_route pr ON pr.home_id = h.id
        GROUP BY h.id, h.stable_id, h.name
        ORDER BY h.stable_id
    """)

    print(f"{'Home':<15} {'Name':<25} {'Routen':>8} {'Min':>8} {'Max':>8} {'Avg':>8}")
    print("-" * 80)

    for row in cur.fetchall():
        stable_id, name, count, min_m, max_m, avg_m = row
        name_short = name[:24] if len(name) > 24 else name

        if count and count > 0:
            print(f"{stable_id:<15} {name_short:<25} {count:>8} {min_m:>7.0f}m {max_m:>7.0f}m {avg_m:>7.0f}m")
        else:
            print(f"{stable_id:<15} {name_short:<25} {0:>8} {'--':>8} {'--':>8} {'--':>8}")

    # Total resorts in Alps region
    cur.execute("""
        SELECT COUNT(*)
        FROM resort
        WHERE center_geom IS NOT NULL
          AND ST_Y(center_geom) BETWEEN 43.5 AND 48.5
          AND ST_X(center_geom) BETWEEN 5.0 AND 17.0
    """)
    total_resorts = cur.fetchone()[0]
    print(f"\nGesamte Resorts in Alpen-Region: {total_resorts}")


def main():
    parser = argparse.ArgumentParser(description="Export travel times from V2 database")
    parser.add_argument("--home-id", type=str, help="Specific home ID to export")
    parser.add_argument("--output-dir", type=str, default=OUTPUT_DIR, help="Output directory")
    parser.add_argument("--stats", action="store_true", help="Show statistics only")

    args = parser.parse_args()

    conn = psycopg2.connect(**DB_CONFIG)

    try:
        if args.stats:
            show_stats(conn)
            return

        cur = conn.cursor()

        if args.home_id:
            # Export single home
            print(f"=== Export Fahrzeiten für '{args.home_id}' ===")
            export_travel_times(conn, args.home_id, args.output_dir)
        else:
            # Export all homes
            cur.execute("SELECT stable_id FROM home ORDER BY stable_id")
            home_ids = [row[0] for row in cur.fetchall()]

            if not home_ids:
                print("Keine Homes in der Datenbank!")
                return

            print(f"=== Export Fahrzeiten für {len(home_ids)} Homes ===\n")

            for hid in home_ids:
                export_travel_times(conn, hid, args.output_dir)

        print("\n=== FERTIG ===")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
