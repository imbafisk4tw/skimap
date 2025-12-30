#!/usr/bin/env python3
import argparse
import json
import re
from typing import Any, Dict, List, Optional, Tuple

try:
    import psycopg2
    from psycopg2.extras import Json
except ImportError as e:
    raise SystemExit("Missing dependency: psycopg2-binary. Install via: pip install psycopg2-binary") from e


def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text or "item"


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def guess_point(obj: Dict[str, Any],
                lat_keys=("lat", "latitude"),
                lon_keys=("lon", "lng", "longitude")) -> Optional[Tuple[float, float]]:
    lat = None
    lon = None
    for k in lat_keys:
        if k in obj and obj[k] not in (None, ""):
            lat = obj[k]
            break
    for k in lon_keys:
        if k in obj and obj[k] not in (None, ""):
            lon = obj[k]
            break
    if lat is None or lon is None:
        return None
    return float(lat), float(lon)


def ensure_unique_stable_id(cur, table: str, stable_id: str) -> str:
    """If stable_id exists, add -2, -3, ..."""
    base = stable_id
    i = 2
    while True:
        cur.execute(f"SELECT 1 FROM {table} WHERE stable_id=%s LIMIT 1", (stable_id,))
        if cur.fetchone() is None:
            return stable_id
        stable_id = f"{base}-{i}"
        i += 1


def upsert_pass(cur, stable_id: str, name: str, pass_type: str = "season",
                website: Optional[str] = None, meta: Optional[dict] = None) -> str:
    cur.execute(
        """
        INSERT INTO pass (stable_id, name, pass_type, website, meta)
        VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (stable_id) DO UPDATE
        SET name=EXCLUDED.name,
            pass_type=EXCLUDED.pass_type,
            website=COALESCE(EXCLUDED.website, pass.website),
            meta=pass.meta || EXCLUDED.meta
        RETURNING id
        """,
        (stable_id, name, pass_type, website, Json(meta or {})),
    )
    return cur.fetchone()[0]


def upsert_group(cur, stable_id: str, name: str, kind: str,
                 website: Optional[str] = None, meta: Optional[dict] = None) -> str:
    cur.execute(
        """
        INSERT INTO grp (stable_id, name, kind, website, meta)
        VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (stable_id) DO UPDATE
        SET name=EXCLUDED.name,
            kind=EXCLUDED.kind,
            website=COALESCE(EXCLUDED.website, grp.website),
            meta=grp.meta || EXCLUDED.meta
        RETURNING id
        """,
        (stable_id, name, kind, website, Json(meta or {})),
    )
    return cur.fetchone()[0]


def upsert_resort(cur, stable_id: str, name: str,
                  country: Optional[str], region: Optional[str],
                  website: Optional[str], is_glacier: bool,
                  center: Optional[Tuple[float, float]], meta: dict) -> str:
    # Update if exists
    cur.execute("SELECT id FROM resort WHERE stable_id=%s", (stable_id,))
    row = cur.fetchone()
    if row:
        resort_id = row[0]
        if center is None:
            cur.execute(
                """
                UPDATE resort
                SET name=%s,
                    country=COALESCE(%s, country),
                    region=COALESCE(%s, region),
                    website=COALESCE(%s, website),
                    is_glacier=%s,
                    meta=resort.meta || %s::jsonb
                WHERE id=%s
                """,
                (name, country, region, website, is_glacier, json.dumps(meta), resort_id),
            )
        else:
            lat, lon = center
            cur.execute(
                """
                UPDATE resort
                SET name=%s,
                    country=COALESCE(%s, country),
                    region=COALESCE(%s, region),
                    website=COALESCE(%s, website),
                    is_glacier=%s,
                    center_geom=ST_SetSRID(ST_MakePoint(%s,%s),4326),
                    meta=resort.meta || %s::jsonb
                WHERE id=%s
                """,
                (name, country, region, website, is_glacier, float(lon), float(lat), json.dumps(meta), resort_id),
            )
        return resort_id

    # Insert new
    stable_id = ensure_unique_stable_id(cur, "resort", stable_id)
    if center is None:
        cur.execute(
            """
            INSERT INTO resort (stable_id, name, country, region, website, is_glacier, meta)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
            """,
            (stable_id, name, country, region, website, is_glacier, Json(meta)),
        )
    else:
        lat, lon = center
        cur.execute(
            """
            INSERT INTO resort (stable_id, name, country, region, website, is_glacier, center_geom, meta)
            VALUES (%s,%s,%s,%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s)
            RETURNING id
            """,
            (stable_id, name, country, region, website, is_glacier, float(lon), float(lat), Json(meta)),
        )
    return cur.fetchone()[0]


def insert_resort_group(cur, resort_id: str, group_id: str) -> None:
    cur.execute(
        "INSERT INTO resort_group (resort_id, group_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
        (resort_id, group_id),
    )


def insert_resort_pass(cur, resort_id: str, pass_id: str) -> None:
    cur.execute(
        "INSERT INTO resort_pass (resort_id, pass_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
        (resort_id, pass_id),
    )


def upsert_access_point(cur, stable_id: str, resort_id: str,
                        name: str, kind: str,
                        geom: Tuple[float, float], priority: int = 0,
                        meta: Optional[dict] = None) -> str:
    lat, lon = geom
    cur.execute(
        """
        INSERT INTO access_point (stable_id, resort_id, name, kind, geom, priority, meta)
        VALUES (%s,%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s, %s)
        ON CONFLICT (stable_id) DO UPDATE
        SET resort_id=EXCLUDED.resort_id,
            name=EXCLUDED.name,
            kind=EXCLUDED.kind,
            geom=EXCLUDED.geom,
            priority=EXCLUDED.priority,
            meta=access_point.meta || EXCLUDED.meta
        RETURNING id
        """,
        (stable_id, resort_id, name, kind, float(lon), float(lat), int(priority), Json(meta or {})),
    )
    return cur.fetchone()[0]


def upsert_parking(cur, stable_id: str, access_point_id: str,
                   name: str, geom: Tuple[float, float],
                   meta: Optional[dict] = None,
                   capacity_hint: Optional[int] = None,
                   paid: Optional[bool] = None) -> str:
    lat, lon = geom
    cur.execute(
        """
        INSERT INTO parking (stable_id, access_point_id, name, geom, capacity_hint, paid, meta)
        VALUES (%s,%s,%s, ST_SetSRID(ST_MakePoint(%s,%s),4326), %s, %s, %s)
        ON CONFLICT (stable_id) DO UPDATE
        SET access_point_id=EXCLUDED.access_point_id,
            name=EXCLUDED.name,
            geom=EXCLUDED.geom,
            capacity_hint=COALESCE(EXCLUDED.capacity_hint, parking.capacity_hint),
            paid=COALESCE(EXCLUDED.paid, parking.paid),
            meta=parking.meta || EXCLUDED.meta
        RETURNING id
        """,
        (stable_id, access_point_id, name, float(lon), float(lat), capacity_hint, paid, Json(meta or {})),
    )
    return cur.fetchone()[0]


def infer_passes_from_resort(resort_obj: Dict[str, Any]) -> List[Tuple[str, str]]:
    """
    Tries to infer passes from common boolean flags, e.g.:
      { "sct": true, "ssc": true }
    Also supports:
      { "passes": ["Snow Card Tirol", "SuperSkiCard"] }
    """
    mapping = [
        ("sct", "snowcard-tirol", "Snow Card Tirol"),
        ("ssc", "superskicard", "SuperSkiCard"),
        ("scc", "snow-card-carinthia", "Snow Card Kärnten / Carinthia"),
    ]
    out: List[Tuple[str, str]] = []
    for flag, sid, name in mapping:
        if resort_obj.get(flag) is True:
            out.append((sid, name))

    passes = resort_obj.get("passes")
    if isinstance(passes, list):
        for p in passes:
            if isinstance(p, str) and p.strip():
                out.append((slugify(p), p.strip()))

    # uniq by stable_id
    seen = set()
    uniq = []
    for sid, name in out:
        if sid not in seen:
            uniq.append((sid, name))
            seen.add(sid)
    return uniq


def infer_groups_from_resort(resort_obj: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    """
    Supports either:
      - "verbund": "SkiWelt" (-> kind='verbund')
      - "groups": [{name, kind, stable_id?}] or ["SkiWelt", ...]
      - "brand"/"marke": "Mayrhofner Bergbahnen" (-> kind='brand')
    """
    out: List[Tuple[str, str, str]] = []

    verbund = resort_obj.get("verbund") or resort_obj.get("verbuende") or resort_obj.get("association")
    if isinstance(verbund, str) and verbund.strip():
        out.append((slugify(verbund), verbund.strip(), "verbund"))

    brand = resort_obj.get("brand") or resort_obj.get("marke")
    if isinstance(brand, str) and brand.strip():
        out.append((slugify(brand), brand.strip(), "brand"))

    groups = resort_obj.get("groups") or resort_obj.get("cluster") or resort_obj.get("clusters")
    if isinstance(groups, list):
        for g in groups:
            if isinstance(g, str) and g.strip():
                out.append((slugify(g), g.strip(), "group"))
            elif isinstance(g, dict):
                name = g.get("name") or g.get("title")
                if not name:
                    continue
                sid = g.get("stable_id") or slugify(str(name))
                kind = g.get("kind") or g.get("type") or "group"
                out.append((str(sid), str(name), str(kind)))

    # uniq by stable_id
    seen = set()
    uniq: List[Tuple[str, str, str]] = []
    for sid, name, kind in out:
        if sid not in seen:
            uniq.append((sid, name, kind))
            seen.add(sid)
    return uniq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-url", required=True, help="postgresql://user:pass@host:5432/dbname")
    ap.add_argument("--resorts", required=True, help="Path to resorts.json (array)")
    ap.add_argument("--access-points", help="Optional: access_points_candidates.json (array)")
    ap.add_argument("--parkings", help="Optional: parkings_candidates.json (array)")
    args = ap.parse_args()

    resorts_data = load_json(args.resorts)
    if not isinstance(resorts_data, list):
        raise SystemExit("Expected resorts.json to be a JSON array of resort objects.")

    access_points_data = load_json(args.access_points) if args.access_points else None
    parkings_data = load_json(args.parkings) if args.parkings else None

    conn = psycopg2.connect(args.db_url)
    conn.autocommit = False

    with conn:
        with conn.cursor() as cur:
            resort_id_by_stable: Dict[str, str] = {}

            # --- resorts ---
            for r in resorts_data:
                if not isinstance(r, dict):
                    continue

                stable_id = r.get("stable_id") or r.get("id") or slugify(r.get("name") or r.get("resort") or "resort")
                name = r.get("name") or r.get("resort") or stable_id

                center = guess_point(r)
                if center is None and isinstance(r.get("location"), dict):
                    center = guess_point(r["location"])

                meta = {k: v for k, v in r.items() if k not in {
                    "id", "stable_id", "name", "resort",
                    "lat", "lon", "lng", "longitude", "latitude",
                    "location"
                }}

                resort_id = upsert_resort(
                    cur=cur,
                    stable_id=str(stable_id),
                    name=str(name),
                    country=r.get("country"),
                    region=r.get("region"),
                    website=r.get("website") or r.get("url"),
                    is_glacier=bool(r.get("is_glacier") or r.get("glacier") or r.get("gletscher") or False),
                    center=center,
                    meta=meta
                )
                resort_id_by_stable[str(stable_id)] = resort_id

                for pass_sid, pass_name in infer_passes_from_resort(r):
                    pid = upsert_pass(cur, pass_sid, pass_name)
                    insert_resort_pass(cur, resort_id, pid)

                for g_sid, g_name, g_kind in infer_groups_from_resort(r):
                    gid = upsert_group(cur, g_sid, g_name, g_kind)
                    insert_resort_group(cur, resort_id, gid)

            # --- access points ---
            access_point_id_by_stable: Dict[str, str] = {}
            if isinstance(access_points_data, list):
                for a in access_points_data:
                    if not isinstance(a, dict):
                        continue
                    a_sid = a.get("stable_id") or a.get("id") or slugify(a.get("name") or "access-point")
                    resort_ref = a.get("resort_stable_id") or a.get("resort_id") or a.get("resort")
                    resort_id = resort_id_by_stable.get(str(resort_ref)) if resort_ref else None
                    if resort_id is None:
                        continue
                    geom = guess_point(a)
                    if geom is None:
                        continue

                    meta = {k: v for k, v in a.items() if k not in {
                        "id", "stable_id", "name",
                        "kind", "type",
                        "lat", "lon", "lng", "longitude", "latitude",
                        "resort_id", "resort", "resort_stable_id",
                        "priority"
                    }}

                    ap_id = upsert_access_point(
                        cur,
                        stable_id=str(a_sid),
                        resort_id=resort_id,
                        name=str(a.get("name") or a_sid),
                        kind=str(a.get("kind") or a.get("type") or "lift"),
                        geom=geom,
                        priority=int(a.get("priority") or 0),
                        meta=meta
                    )
                    access_point_id_by_stable[str(a_sid)] = ap_id

            # --- parkings ---
            if isinstance(parkings_data, list):
                for p in parkings_data:
                    if not isinstance(p, dict):
                        continue
                    p_sid = p.get("stable_id") or p.get("id") or slugify(p.get("name") or "parking")
                    ap_ref = p.get("access_point_stable_id") or p.get("access_point_id") or p.get("access_point")
                    ap_id = access_point_id_by_stable.get(str(ap_ref)) if ap_ref else None
                    if ap_id is None:
                        continue
                    geom = guess_point(p)
                    if geom is None:
                        continue

                    meta = {k: v for k, v in p.items() if k not in {
                        "id", "stable_id", "name",
                        "lat", "lon", "lng", "longitude", "latitude",
                        "access_point_id", "access_point", "access_point_stable_id",
                        "capacity_hint", "paid"
                    }}

                    upsert_parking(
                        cur,
                        stable_id=str(p_sid),
                        access_point_id=ap_id,
                        name=str(p.get("name") or p_sid),
                        geom=geom,
                        capacity_hint=p.get("capacity_hint"),
                        paid=p.get("paid"),
                        meta=meta
                    )

    conn.close()
    print("✅ Import finished.")


if __name__ == "__main__":
    main()
