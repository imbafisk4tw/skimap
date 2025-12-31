#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

try:
    import psycopg2
except ImportError as e:
    raise SystemExit("Missing dependency: psycopg2-binary. Install via: pip install psycopg2-binary") from e


def row_to_resort(row):
    stable_id, name, country, region, website, is_glacier, lat, lon, meta = row
    obj = {
        "stable_id": stable_id,
        "name": name,
        "country": country,
        "region": region,
        "website": website,
        "is_glacier": is_glacier,
    }
    if lat is not None and lon is not None:
        obj["lat"] = float(lat)
        obj["lon"] = float(lon)
    if meta:
        obj.update(meta)
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-url", required=True)
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(args.db_url)
    with conn:
        with conn.cursor() as cur:
            # Resorts
            cur.execute(
                """
                SELECT
                  r.stable_id, r.name, r.country, r.region, r.website, r.is_glacier,
                  ST_Y(r.center_geom) AS lat, ST_X(r.center_geom) AS lon,
                  r.meta
                FROM resort r
                ORDER BY r.name;
                """
            )
            resorts_rows = cur.fetchall()

            # Passes
            cur.execute(
                """
                SELECT r.stable_id, p.stable_id, p.name
                FROM resort r
                JOIN resort_pass rp ON rp.resort_id=r.id
                JOIN pass p ON p.id=rp.pass_id
                ORDER BY r.stable_id;
                """
            )
            resort_pass = {}
            for r_sid, p_sid, p_name in cur.fetchall():
                resort_pass.setdefault(r_sid, []).append({"stable_id": p_sid, "name": p_name})

            # Groups
            cur.execute(
                """
                SELECT r.stable_id, g.stable_id, g.name, g.kind
                FROM resort r
                JOIN resort_group rg ON rg.resort_id=r.id
                JOIN grp g ON g.id=rg.group_id
                ORDER BY r.stable_id;
                """
            )
            resort_groups = {}
            for r_sid, g_sid, g_name, g_kind in cur.fetchall():
                resort_groups.setdefault(r_sid, []).append({"stable_id": g_sid, "name": g_name, "kind": g_kind})

            resorts = []
            for row in resorts_rows:
                obj = row_to_resort(row)
                r_sid = obj["stable_id"]
                if r_sid in resort_pass:
                    obj["passes"] = resort_pass[r_sid]
                if r_sid in resort_groups:
                    obj["groups"] = resort_groups[r_sid]
                resorts.append(obj)

            (out_dir / "resorts_export.json").write_text(json.dumps(resorts, ensure_ascii=False, indent=2), encoding="utf-8")

            # Access points
            cur.execute(
                """
                SELECT
                  ap.stable_id, r.stable_id as resort_stable_id, ap.name, ap.kind, ap.priority,
                  ST_Y(ap.geom) AS lat, ST_X(ap.geom) AS lon,
                  ap.meta
                FROM access_point ap
                JOIN resort r ON r.id=ap.resort_id
                ORDER BY r.stable_id, ap.priority DESC, ap.name;
                """
            )
            access_points = []
            for ap_sid, r_sid, name, kind, priority, lat, lon, meta in cur.fetchall():
                obj = {
                    "stable_id": ap_sid,
                    "resort_stable_id": r_sid,
                    "name": name,
                    "kind": kind,
                    "priority": int(priority),
                    "lat": float(lat),
                    "lon": float(lon),
                }
                if meta:
                    obj.update(meta)
                access_points.append(obj)
            (out_dir / "access_points_export.json").write_text(json.dumps(access_points, ensure_ascii=False, indent=2), encoding="utf-8")

            # Parkings
            cur.execute(
                """
                SELECT
                  p.stable_id, ap.stable_id as access_point_stable_id, p.name,
                  ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon,
                  p.capacity_hint, p.paid, p.meta
                FROM parking p
                JOIN access_point ap ON ap.id=p.access_point_id
                ORDER BY ap.stable_id, p.name;
                """
            )
            parkings = []
            for p_sid, ap_sid, name, lat, lon, cap, paid, meta in cur.fetchall():
                obj = {
                    "stable_id": p_sid,
                    "access_point_stable_id": ap_sid,
                    "name": name,
                    "lat": float(lat),
                    "lon": float(lon),
                    "capacity_hint": cap,
                    "paid": paid,
                }
                if meta:
                    obj.update(meta)
                parkings.append(obj)
            (out_dir / "parkings_export.json").write_text(json.dumps(parkings, ensure_ascii=False, indent=2), encoding="utf-8")

    conn.close()
    print(f"✅ Export finished. Files written to: {out_dir}")


if __name__ == "__main__":
    main()
