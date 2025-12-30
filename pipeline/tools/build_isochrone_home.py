import json
import os
import sys
from pathlib import Path

import requests


def load_dotenv_if_present(start_dir: Path) -> dict:
    cur = start_dir.resolve()
    while True:
        env_path = cur / ".env"
        if env_path.exists() and env_path.is_file():
            data = {}
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                data[k] = v
            return {"__dotenv_path__": str(env_path), **data}

        parent = cur.parent
        if parent == cur:
            break
        cur = parent

    return {"__dotenv_path__": None}


def get_ors_key() -> str:
    for key_name in ("ORS_API_KEY", "OPENROUTESERVICE_API_KEY"):
        v = os.getenv(key_name)
        if v:
            return v

    env_data = load_dotenv_if_present(Path.cwd())
    dotenv_path = env_data.get("__dotenv_path__")

    if dotenv_path:
        for key_name in ("ORS_API_KEY", "OPENROUTESERVICE_API_KEY"):
            v = env_data.get(key_name)
            if v:
                os.environ["ORS_API_KEY"] = v
                return v

        raise SystemExit(
            f"Found .env at: {dotenv_path}\n"
            f"…but no ORS_API_KEY inside.\n"
            f"Add: ORS_API_KEY=dein_key\n"
        )

    raise SystemExit(
        "No ORS_API_KEY found (env var or .env)."
    )


def main():
    ORS_KEY = get_ors_key()

    # Home (passe an)
    HOME_LAT = 48.137
    HOME_LON = 11.575

    # Einfach & robust: bis 60min, in 10min Schritten
    # => 10/20/30/40/50/60 Minuten
    MAX_RANGE_SEC = 3600
    INTERVAL_SEC = 600

    url = "https://api.openrouteservice.org/v2/isochrones/driving-car"
    payload = {
        "locations": [[HOME_LON, HOME_LAT]],  # lon,lat
        "range": [MAX_RANGE_SEC],
        "interval": INTERVAL_SEC,
        "range_type": "time",
        "attributes": ["area"],
    }
    headers = {"Authorization": ORS_KEY, "Content-Type": "application/json"}

    r = requests.post(url, headers=headers, json=payload, timeout=60)

    # bessere Diagnose bei 400/401/403
    if r.status_code in (400, 401, 403):
        try:
            detail = r.json()
        except Exception:
            detail = r.text
        raise SystemExit(
            f"ORS error {r.status_code}\n"
            f"Request payload: {payload}\n"
            f"Response: {detail}\n"
        )

    r.raise_for_status()

    out_dir = Path("data") / "isochrones"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "home_10-60min.geojson"
    out_path.write_text(json.dumps(r.json(), ensure_ascii=False), encoding="utf-8")
    print("Wrote:", out_path)


if __name__ == "__main__":
    try:
        main()
    except requests.RequestException as e:
        print("Request failed:", e, file=sys.stderr)
        sys.exit(1)
