#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import os
import sys
from typing import Dict, List, Tuple, Any, Set

import psycopg2


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


def get_columns(cur, table: str, schema: str = "public") -> Set[str]:
    cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        """,
        (schema, table),
    )
    return {r[0] for r in cur.fetchall()}


def fetch_resort_passes(cur) -> List[Tuple[str, List[Dict[str, Any]]]]:
    """
    Liefert Liste: (resort_id_uuid, passes_json_array)
    """
    cur.execute(
        """
        SELECT id, meta->'passes' AS passes
        FROM public.resort
        WHERE meta ? 'passes';
        """
    )
    rows = []
    for rid, passes in cur.fetchall():
        # psycopg2 liefert jsonb i.d.R. als Python-Objekt (list/dict) wenn json adapter aktiv;
        # falls als string, wäre hier zusätzliche json.loads nötig. In der Praxis passt es.
        if passes is None:
            continue
        rows.append((str(rid), passes))
    return rows


def normalize_pass_obj(obj: Dict[str, Any]) -> Tuple[str, str]:
    """
    Erwartet {"name": "...", "stable_id": "..."} (wie in deinem Screenshot).
    """
    sid = (obj.get("stable_id") or "").strip()
    name = (obj.get("name") or sid).strip()
    return sid, name


def ensure_pass(cur, pass_cols: Set[str], stable_id: str, name: str) -> str:
    """
    Upsert über stable_id ohne ON CONFLICT (damit kein Unique-Constraint nötig ist).
    Gibt public.pass.id (uuid) als String zurück.
    """
    if "stable_id" not in pass_cols or "id" not in pass_cols:
        raise RuntimeError("public.pass braucht mindestens Spalten: id (uuid) und stable_id (text)")

    cur.execute("SELECT id FROM public.pass WHERE stable_id = %s LIMIT 1;", (stable_id,))
    row = cur.fetchone()
    if row:
        pid = row[0]
        # Update, aber nur Spalten, die existieren
        set_parts = []
        params = []
        if "name" in pass_cols:
            set_parts.append("name = %s")
            params.append(name)
        if "kind" in pass_cols:
            set_parts.append("kind = %s")
            params.append("season_pass")
        if "website" in pass_cols:
            set_parts.append("website = NULL")
        if "meta" in pass_cols:
            set_parts.append("meta = '{}'::jsonb")
        if set_parts:
            params.append(pid)
            cur.execute(f"UPDATE public.pass SET {', '.join(set_parts)} WHERE id = %s;", params)
        return str(pid)

    # Insert
    cols = ["stable_id"]
    vals = ["%s"]
    params = [stable_id]

    if "name" in pass_cols:
        cols.append("name")
        vals.append("%s")
        params.append(name)
    if "kind" in pass_cols:
        cols.append("kind")
        vals.append("%s")
        params.append("season_pass")
    if "website" in pass_cols:
        cols.append("website")
        vals.append("NULL")
    if "meta" in pass_cols:
        cols.append("meta")
        vals.append("'{}'::jsonb")

    sql = f"INSERT INTO public.pass ({', '.join(cols)}) VALUES ({', '.join(vals)}) RETURNING id;"
    cur.execute(sql, params)
    return str(cur.fetchone()[0])


def ensure_resort_pass_link(cur, resort_pass_cols: Set[str], resort_id: str, pass_id: str) -> None:
    if not {"resort_id", "pass_id"}.issubset(resort_pass_cols):
        raise RuntimeError("public.resort_pass braucht Spalten: resort_id, pass_id")

    # Duplikate verhindern ohne Constraint:
    cur.execute(
        """
        INSERT INTO public.resort_pass (resort_id, pass_id)
        SELECT %s::uuid, %s::uuid
        WHERE NOT EXISTS (
            SELECT 1 FROM public.resort_pass WHERE resort_id = %s::uuid AND pass_id = %s::uuid
        );
        """,
        (resort_id, pass_id, resort_id, pass_id),
    )


def cleanup_meta_passes(cur):
    cur.execute(
        """
        UPDATE public.resort
        SET meta = meta - 'passes'
        WHERE meta ? 'passes';
        """
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts schreiben")
    ap.add_argument("--cleanup-meta", action="store_true", help="Nach Import meta.passes löschen")
    args = ap.parse_args()

    conn = connect()
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            pass_cols = get_columns(cur, "pass")
            resort_pass_cols = get_columns(cur, "resort_pass")

            rows = fetch_resort_passes(cur)

            # Sammeln & Dedupe
            unique_passes: Dict[str, str] = {}  # stable_id -> name
            mappings: Set[Tuple[str, str]] = set()  # (resort_id_uuid, pass_stable_id)

            for resort_id, passes in rows:
                if not isinstance(passes, list):
                    # falls doch string/objekt, ignoriere hier bewusst – dann müssen wir anpassen
                    continue
                for obj in passes:
                    if not isinstance(obj, dict):
                        continue
                    sid, name = normalize_pass_obj(obj)
                    if not sid:
                        continue
                    unique_passes.setdefault(sid, name)
                    mappings.add((resort_id, sid))

            print(f"Resorts mit meta.passes: {len(rows)}")
            print(f"Eindeutige Pässe gefunden: {len(unique_passes)}")
            print(f"Resort↔Pass Links gefunden: {len(mappings)}")

            if args.dry_run:
                for sid, name in sorted(unique_passes.items(), key=lambda x: x[0])[:50]:
                    print(f"- {sid} -> {name}")
                if len(unique_passes) > 50:
                    print(f"... ({len(unique_passes)-50} weitere)")
                conn.rollback()
                return

            # Upsert passes
            pass_id_by_stable: Dict[str, str] = {}
            for sid, name in unique_passes.items():
                pass_id_by_stable[sid] = ensure_pass(cur, pass_cols, sid, name)

            # Insert mappings
            inserted_links = 0
            for resort_id, pass_stable_id in mappings:
                pid = pass_id_by_stable.get(pass_stable_id)
                if not pid:
                    continue
                before = cur.rowcount
                ensure_resort_pass_link(cur, resort_pass_cols, resort_id, pid)
                inserted_links += cur.rowcount  # 1 wenn inserted, 0 wenn existiert

            if args.cleanup_meta:
                cleanup_meta_passes(cur)

        conn.commit()
        print("OK: Import abgeschlossen.")
        print(f"Upserted Pässe: {len(unique_passes)}")
        print(f"Inserted Links (neu): {inserted_links}")
        if args.cleanup_meta:
            print("meta.passes wurde entfernt.")

    except Exception as e:
        conn.rollback()
        print(f"FEHLER: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
