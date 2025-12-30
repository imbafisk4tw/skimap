import argparse
import json
import uuid
import psycopg2
from psycopg2.extras import Json

# Mapping: passes.json IDs -> deine canonical stable_id in der DB
ID_TO_STABLE = {
    "sct": "snowcard-tirol",
    "ssc": "superskicard",
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db-url", required=True)
    ap.add_argument("--passes", required=True)
    ap.add_argument("--default-pass-type", default="season")
    args = ap.parse_args()

    with open(args.passes, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("passes", [])
    if not isinstance(items, list):
        raise SystemExit("passes.json: expected key 'passes' to be a list")

    conn = psycopg2.connect(args.db_url)
    conn.autocommit = True
    cur = conn.cursor()

    sql = """
    INSERT INTO public.pass (id, stable_id, name, pass_type, website, meta)
    VALUES (%s, %s, %s, %s, NULL, %s)
    ON CONFLICT (stable_id) DO UPDATE
      SET name = EXCLUDED.name,
          pass_type = EXCLUDED.pass_type,
          meta = EXCLUDED.meta,
          updated_at = now();
    """

    n = 0
    for p in items:
        pid = p.get("id")
        name = p.get("name")
        aliases = p.get("aliases", [])

        if not pid or not name:
            continue

        stable_id = ID_TO_STABLE.get(pid, pid)

        meta = {
            "aliases": aliases,
            "code": pid,  # kurze ID aus passes.json bleibt erhalten
            "schema": data.get("schema"),
            "generatedAt": data.get("generatedAt"),
        }

        cur.execute(sql, (str(uuid.uuid4()), stable_id, name, args.default_pass_type, Json(meta)))
        n += 1

    cur.close()
    conn.close()
    print(f"Upserted {n} passes into public.pass")

if __name__ == "__main__":
    main()
