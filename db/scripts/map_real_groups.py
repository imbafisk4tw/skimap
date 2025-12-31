#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
from typing import Any, Dict, List, Tuple

import psycopg2

ALLOW = {
    "skiwelt",
    "zillertal-arena",
    "snow-space-salzburg",
    "ok-bergbahnen",
    "skigastein",
    "stubai",
    "bergbahnen-langes",
    "steinplatte",
}

def connect():
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        return psycopg2.connect(dsn)

    host = os.environ.get("PGHOST", "localhost")
    port = os.environ.get("PGPORT", "5432")
    db = os.environ.get("PGDATABASE", "skigebiete")
    user = os.environ.get("PGUSER", "skigebiete")
    pw = os.environ.get("PGPASSWORD", "")
    return psycopg2.connect(f"host={host} port={port} dbname={db} user={user} password={pw}")

def load_resorts(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "resorts" in data:
        data = data["resorts"]
    if not isinstance(data, list):
        raise ValueError("resorts.json muss eine Liste sein (oder ein Objekt mit key 'resorts').")
    return data

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resorts", required=True, help="Pfad zu resorts.json")
    ap.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts schreiben")
    args = ap.parse_args()

    resorts = load_resorts(args.resorts)

    # Kandidaten aus JSON
    pairs: List[Tuple[str, str]] = []  # (resort_stable_id, group_stable_id)
    for r in resorts:
        rsid = r.get("stable_id")
        gid = r.get("groupId")
        if not rsid or not gid:
            continue
        rsid = str(rsid)
        gid = str(gid)
        if gid in ALLOW:
            pairs.append((rsid, gid))

    if not pairs:
        print("Keine passenden Resort↔Group Paare gefunden.")
        return

    # Duplikate killen
    pairs = sorted(set(pairs))
    print(f"Gefundene Mappings (nach Allowlist): {len(pairs)}")

    if args.dry_run:
        for rsid, gid in pairs[:30]:
            print(f"- resort.stable_id={rsid} -> grp.stable_id={gid}")
        if len(pairs) > 30:
            print(f"... ({len(pairs)-30} weitere)")
        return

    conn = connect()
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            inserted = 0
            missing_resorts = 0
            missing_groups = 0

            for resort_stable_id, group_stable_id in pairs:
                cur.execute("SELECT id FROM public.resort WHERE stable_id=%s LIMIT 1;", (resort_stable_id,))
                rr = cur.fetchone()
                if not rr:
                    missing_resorts += 1
                    continue
                resort_id = rr[0]

                cur.execute("SELECT id FROM public.grp WHERE stable_id=%s LIMIT 1;", (group_stable_id,))
                gg = cur.fetchone()
                if not gg:
                    missing_groups += 1
                    continue
                group_id = gg[0]

                cur.execute(
                    """
                    INSERT INTO public.resort_group (resort_id, group_id)
                    VALUES (%s, %s)
                    ON CONFLICT (resort_id, group_id) DO NOTHING;
                    """,
                    (resort_id, group_id),
                )
                inserted += cur.rowcount

        conn.commit()
        print(f"OK: {inserted} Links geschrieben.")
        if missing_resorts:
            print(f"Hinweis: {missing_resorts} Resorts aus JSON nicht in DB gefunden (stable_id mismatch).")
        if missing_groups:
            print(f"Hinweis: {missing_groups} Gruppen nicht in grp gefunden (sollte bei dir 0 sein).")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()
