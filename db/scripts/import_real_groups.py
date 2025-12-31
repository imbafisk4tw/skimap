#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Importiert nur "echte" Resort-Gruppen in public.grp.

DB-Schema (laut deinen Screenshots):
- grp: id uuid, stable_id text, name text, kind text, website text, meta jsonb, created_at, updated_at
- resort: id uuid, stable_id text, ...
- resort_group: resort_id uuid, group_id uuid   (wird hier NICHT befüllt)
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Tuple

import psycopg2


REAL_GROUPS: Dict[str, str] = {
    # "sichere" echte Gruppen / Verbünde
    "skiwelt": "SkiWelt",
    "zillertal-arena": "Zillertal Arena",
    "snow-space-salzburg": "Snow Space Salzburg",
    "skigastein": "Ski Gastein",
    "stubai": "Stubai",
    "ok-bergbahnen": "OK Bergbahnen",
    "steinplatte": "Steinplatte–Winklmoosalm",

    # Betreiber-/Mini-Verbund (plausibel)
    "bergbahnen-langes": "Bergbahnen Langes",
}

BORDERLINE_GROUPS: Dict[str, str] = {
    # Grenzfall – nur bei Bedarf
    "bergbahn-pillersee": "Bergbahn Pillersee",
    # Optional:
    # "zugspitze": "Bayerische Zugspitzbahn",
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


def extract_group_counts(resorts: List[Dict[str, Any]]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for r in resorts:
        gid = r.get("groupId")
        if not gid:
            continue
        gid = str(gid)
        counts[gid] = counts.get(gid, 0) + 1
    return counts


def ensure_group(cur, stable_id: str, name: str, kind: str = "resort_group") -> str:
    """
    Upsert über stable_id (ohne ON CONFLICT, falls kein Unique-Constraint existiert).
    Gibt grp.id (uuid) als String zurück.
    """
    cur.execute("SELECT id FROM grp WHERE stable_id = %s LIMIT 1;", (stable_id,))
    row = cur.fetchone()
    if row:
        grp_id = row[0]
        cur.execute(
            """
            UPDATE grp
               SET name = %s,
                   kind = %s,
                   website = NULL,
                   meta = '{}'::jsonb
             WHERE id = %s;
            """,
            (name, kind, grp_id),
        )
        return str(grp_id)

    cur.execute(
        """
        INSERT INTO grp (stable_id, name, kind, website, meta)
        VALUES (%s, %s, %s, NULL, '{}'::jsonb)
        RETURNING id;
        """,
        (stable_id, name, kind),
    )
    return str(cur.fetchone()[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resorts", required=True, help="Pfad zu resorts.json")
    ap.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts schreiben")
    ap.add_argument("--include-borderline", action="store_true", help="Grenzfälle zusätzlich importieren")
    args = ap.parse_args()

    resorts = load_resorts(args.resorts)
    counts = extract_group_counts(resorts)

    allow: Dict[str, str] = dict(REAL_GROUPS)
    if args.include_borderline:
        allow.update(BORDERLINE_GROUPS)

    present: List[Tuple[str, str, int]] = [(gid, allow[gid], counts.get(gid, 0)) for gid in allow.keys()]
    present.sort(key=lambda x: (-x[2], x[1].lower()))

    print(f"Allowlist Gruppen: {len(allow)}")
    for gid, name, cnt in present:
        status = "OK" if cnt > 0 else "NICHT GEFUNDEN in resorts.json"
        print(f"- {gid} -> {name} ({cnt}) [{status}]")

    if args.dry_run:
        print("\nDRY-RUN: keine DB-Änderungen.")
        return

    conn = connect()
    conn.autocommit = False
    imported: List[Tuple[str, str, str]] = []

    try:
        with conn.cursor() as cur:
            for gid, name, cnt in present:
                if cnt == 0:
                    continue
                grp_uuid = ensure_group(cur, gid, name, kind="resort_group")
                imported.append((gid, name, grp_uuid))

        conn.commit()

    except Exception as e:
        conn.rollback()
        print(f"\nFEHLER: {e}", file=sys.stderr)
        raise

    finally:
        conn.close()

    print(f"\nImport fertig: {len(imported)} Gruppen upserted in public.grp")
    for gid, name, grp_uuid in imported:
        print(f"- {gid} -> {name} (grp.id={grp_uuid})")


if __name__ == "__main__":
    main()
