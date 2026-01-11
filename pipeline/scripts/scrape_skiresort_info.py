#!/usr/bin/env python3
"""
Scrape resort data from skiresort.info:
- GPS coordinates (from /arrival-car/ page)
- Elevation info (min, max, difference)
- Piste breakdown by difficulty (easy/green, blue, red, black)

Usage:
  # Scrape all resorts (dry run - no DB updates)
  python scrape_skiresort_info.py --dry-run

  # Scrape and update DB
  python scrape_skiresort_info.py --update-db

  # Scrape specific resort
  python scrape_skiresort_info.py --resort zermatt --update-db

  # Compare GPS coordinates only
  python scrape_skiresort_info.py --compare-gps

  # Limit to N resorts (for testing)
  python scrape_skiresort_info.py --limit 10 --dry-run
"""

import json
import sys
import argparse
import time
import re
import os
from pathlib import Path
from urllib.parse import quote

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

# Cache directory for HTML pages
CACHE_DIR = Path(__file__).parent.parent / ".cache" / "skiresort_info"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Rate limiting
REQUEST_DELAY = 1.0  # seconds between requests

# Headers to mimic browser
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# Manual slug mappings: DB stable_id -> skiresort.info slug
SLUG_MAPPINGS = {
    # Austria
    "stanton-stchristoph": "st-anton-st-christoph-stuben-lech-zuers-warth-schroecken-ski-arlberg",
    "lech-zuers-arlberg": "st-anton-st-christoph-stuben-lech-zuers-warth-schroecken-ski-arlberg",
    "warth-schroecken": "st-anton-st-christoph-stuben-lech-zuers-warth-schroecken-ski-arlberg",
    "stuben": "st-anton-st-christoph-stuben-lech-zuers-warth-schroecken-ski-arlberg",
    "skiwelt-wilder-kaiser-brixental": "skiwelt-wilder-kaiser-brixental",
    "kitzbuehel-kirchberg": "kitzski-kitzbuehel-kirchberg",
    "saalbach-hinterglemm-leogang-fieberbrunn": "saalbach-hinterglemm-leogang-fieberbrunn-skicircus",
    "zellamsee-kaprun": "zell-am-see-kaprun",
    "obertauern": "obertauern",
    "soelden": "soelden",
    "ischgl": "ischgl-samnaun-silvretta-arena",
    "stubaier-gletscher": "stubai-glacier-stubaier-gletscher",
    "hintertuxer-gletscher": "hintertux-glacier-hintertuxer-gletscher",
    "pitztaler-gletscher": "pitztal-glacier-rifflsee-pitztal",
    "kaunertaler-gletscher": "kaunertal-glacier-kaunertaler-gletscher",
    "silvretta-montafon": "silvretta-montafon",
    "zillertal-arena": "zillertal-arena-zell-am-ziller-gerlos-koenigsleiten-hochkrimml",

    # Switzerland
    "zermatt": "zermatt-matterhorn-ski-paradise",
    "verbier-4-vallees": "4-vallees-verbier-la-tzoumaz-nendaz-veysonnaz-thyon",
    "nendaz-4-vallees": "4-vallees-verbier-la-tzoumaz-nendaz-veysonnaz-thyon",
    "veysonnaz-4-vallees": "4-vallees-verbier-la-tzoumaz-nendaz-veysonnaz-thyon",
    "thyon-4-vallees": "4-vallees-verbier-la-tzoumaz-nendaz-veysonnaz-thyon",
    "latzoumaz": "4-vallees-verbier-la-tzoumaz-nendaz-veysonnaz-thyon",
    "laax": "flims-laax-falera",
    "davos-klosters": "davos-klosters",
    "st-moritz": "st-moritz-corviglia",
    "engelberg-titlis": "engelberg-titlis",
    "saas-fee": "saas-fee",
    "arosa-lenzerheide": "arosa-lenzerheide",
    "crans-montana": "crans-montana",
    "grindelwald-wengen": "grindelwald-wengen-jungfrau-ski-region",
    "adelboden-lenk": "adelboden-lenk",

    # France
    "les-3-vallees": "les-3-vallees-les-menuires-meribel-courchevel",
    "paradiski": "paradiski-la-plagne-les-arcs-peisey-vallandry",
    "tignes": "tignes-val-d-isere",
    "val-disere": "tignes-val-d-isere",
    "chamonix": "chamonix-mont-blanc",
    "les-2-alpes": "les-2-alpes",
    "alpe-dhuez": "alpe-d-huez",
    "la-plagne": "la-plagne",
    "les-arcs": "les-arcs-peisey-vallandry",
    "meribel": "les-3-vallees-les-menuires-meribel-courchevel",
    "courchevel": "les-3-vallees-les-menuires-meribel-courchevel",
    "val-thorens": "val-thorens-les-menuires",
    "serre-chevalier": "serre-chevalier-briancon-chantemerle-villeneuve-la-salle-monetier",
    "megeve": "megeve",

    # Italy - Sellaronda consists of multiple resorts, Val Gardena is the main one
    "sellaronda-dolomiten": "val-gardena-groeden",
    "livigno": "livigno",
    "bormio": "bormio",
    "cervinia": "breuil-cervinia-valtournenche-zermatt",
    "kronplatz": "kronplatz-plan-de-corones",
    "alta-badia": "alta-badia",
    "sauze-oulx": "via-lattea-sestriere-sauze-doulx-san-sicario-claviere-montgenevre",
    "sestriere": "via-lattea-sestriere-sauze-doulx-san-sicario-claviere-montgenevre",
    "claviere": "via-lattea-sestriere-sauze-doulx-san-sicario-claviere-montgenevre",
    "cesana-sansicario": "via-lattea-sestriere-sauze-doulx-san-sicario-claviere-montgenevre",

    # Germany
    "garmisch-classic": "garmisch-partenkirchen-garmisch-classic",
    "zugspitze": "zugspitze",
    "oberstdorf-nebelhorn": "nebelhorn-oberstdorf",
    "fellhorn-kanzelwand": "fellhorn-kanzelwand-oberstdorf-riezlern",
}


def get_cached_html(url: str, cache_key: str) -> str | None:
    """Get HTML from cache if exists."""
    cache_file = CACHE_DIR / f"{cache_key}.html"
    if cache_file.exists():
        return cache_file.read_text(encoding='utf-8')
    return None


def save_to_cache(html: str, cache_key: str):
    """Save HTML to cache."""
    cache_file = CACHE_DIR / f"{cache_key}.html"
    cache_file.write_text(html, encoding='utf-8')


def fetch_page(url: str, cache_key: str = None, expected_url_part: str = None) -> str | None:
    """Fetch a page with caching and rate limiting."""
    if cache_key:
        cached = get_cached_html(url, cache_key)
        if cached:
            # Verify cached page is actually a resort page, not homepage
            if expected_url_part and f'ski-resort/{expected_url_part}' not in cached and 'class="resort-' not in cached:
                # Cache might be invalid, skip it
                pass
            else:
                return cached

    try:
        time.sleep(REQUEST_DELAY)
        response = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)

        # Check if we were redirected to homepage
        if response.status_code == 200:
            final_url = response.url
            if expected_url_part and f'ski-resort/{expected_url_part}' not in final_url:
                print(f"  ⚠ Redirected to {final_url}")
                return None

            html = response.text
            if cache_key:
                save_to_cache(html, cache_key)
            return html
        else:
            print(f"  HTTP {response.status_code} for {url}")
            return None
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None


def search_skiresort_info(resort_name: str, country: str) -> str | None:
    """Search for a resort on skiresort.info and return the slug."""
    # Normalize name for slug
    def normalize(name):
        return (name.lower()
            .replace(' - ', '-')
            .replace(' / ', '-')
            .replace('/', '-')
            .replace(' ', '-')
            .replace('ä', 'ae')
            .replace('ö', 'oe')
            .replace('ü', 'ue')
            .replace('ß', 'ss')
            .replace('é', 'e')
            .replace('è', 'e')
            .replace('ê', 'e')
            .replace('à', 'a')
            .replace('â', 'a')
            .replace("'", '-')
            .replace("'", '')
            .replace(".", '')
            .replace(",", '')
            .replace("(", '')
            .replace(")", ''))

    base_slug = normalize(resort_name)

    # Try various slug patterns
    slug_candidates = [
        base_slug,
        base_slug.replace('--', '-'),
    ]

    # Try each candidate
    for slug in slug_candidates:
        url = f"https://www.skiresort.info/ski-resort/{slug}/"
        try:
            response = requests.head(url, headers=HEADERS, timeout=10, allow_redirects=True)
            if response.status_code == 200 and f'/ski-resort/{slug}' in response.url:
                return slug
        except:
            pass

    return None


def parse_elevation(html: str) -> dict:
    """Extract elevation data from resort page."""
    result = {
        "min_elevation": None,
        "max_elevation": None,
        "elevation_diff": None
    }

    # Pattern: "896 m - 1965 m (Difference 1069 m)" or similar
    # Also matches: "1350 m - 3250 m" without difference
    elevation_pattern = r'(\d{3,4})\s*m\s*[-–]\s*(\d{3,4})\s*m'
    match = re.search(elevation_pattern, html)
    if match:
        result["min_elevation"] = int(match.group(1))
        result["max_elevation"] = int(match.group(2))
        result["elevation_diff"] = result["max_elevation"] - result["min_elevation"]

    # Try to find explicit difference
    diff_pattern = r'Difference\s+(\d{3,4})\s*m'
    diff_match = re.search(diff_pattern, html, re.IGNORECASE)
    if diff_match:
        result["elevation_diff"] = int(diff_match.group(1))

    return result


def parse_piste_breakdown(html: str) -> dict:
    """Extract piste breakdown by difficulty."""
    result = {
        "pistes_easy_km": None,
        "pistes_blue_km": None,
        "pistes_red_km": None,
        "pistes_black_km": None,
        "pistes_total_km": None
    }

    # skiresort.info uses table format:
    # Easy</td> <td id="selBeginner" class="distance">61 km</td>
    # Intermediate</td> <td id="selInter" class="distance">35 km</td>
    # Difficult</td> <td id="selAdv" class="distance">4 km</td>

    # Easy (green)
    easy_pattern = r'[Ee]asy</td>\s*<td[^>]*class="distance"[^>]*>(\d+(?:\.\d+)?)\s*km'
    match = re.search(easy_pattern, html)
    if match:
        result["pistes_easy_km"] = float(match.group(1))

    # Intermediate (blue)
    blue_pattern = r'[Ii]ntermediate\s*</td>\s*<td[^>]*class="distance"[^>]*>(\d+(?:\.\d+)?)\s*km'
    match = re.search(blue_pattern, html)
    if match:
        result["pistes_blue_km"] = float(match.group(1))

    # Difficult (black) - skiresort.info has only 3 categories, "Difficult" = black
    black_pattern = r'[Dd]ifficult</td>\s*<td[^>]*class="distance"[^>]*>(\d+(?:\.\d+)?)\s*km'
    match = re.search(black_pattern, html)
    if match:
        result["pistes_black_km"] = float(match.group(1))

    # Note: pistes_red_km stays None - skiresort.info doesn't distinguish red from black

    # Total slopes - look for "Slopes" heading or "Total length of slopes"
    total_pattern = r'[Ss]lopes</a></div>\s*<div[^>]*class="[^"]*rank-data[^"]*"[^>]*>(\d+(?:\.\d+)?)\s*km'
    match = re.search(total_pattern, html)
    if match:
        result["pistes_total_km"] = float(match.group(1))

    # Alternative total pattern
    if not result["pistes_total_km"]:
        alt_total = r'id="selTotal"[^>]*>(\d+(?:\.\d+)?)\s*km'
        match = re.search(alt_total, html)
        if match:
            result["pistes_total_km"] = float(match.group(1))

    # Fallback: look for "100 km of slopes" pattern
    if not result["pistes_total_km"]:
        fallback_total = r'(\d+(?:\.\d+)?)\s*km\s*(?:of\s+)?[Ss]lopes'
        match = re.search(fallback_total, html)
        if match:
            result["pistes_total_km"] = float(match.group(1))

    return result


def parse_gps_from_arrival_page(html: str) -> dict:
    """Extract GPS coordinates from Google Maps link on arrival page."""
    result = {
        "lat": None,
        "lon": None
    }

    # Pattern for Google Maps links: maps.google.com/maps?q=47.0833,10.7833
    # or: google.com/maps?q=47.0833,10.7833
    # or: @47.0833,10.7833
    gps_patterns = [
        r'maps\.google\.[a-z]+/maps\?[^"]*q=(-?\d+\.?\d*),(-?\d+\.?\d*)',
        r'google\.[a-z]+/maps[^"]*[@q]=(-?\d+\.?\d*),(-?\d+\.?\d*)',
        r'maps/place/[^"]*@(-?\d+\.?\d*),(-?\d+\.?\d*)',
        r'daddr=(-?\d+\.?\d*),(-?\d+\.?\d*)',
    ]

    for pattern in gps_patterns:
        match = re.search(pattern, html)
        if match:
            lat = float(match.group(1))
            lon = float(match.group(2))
            # Sanity check for Alps region
            if 43 < lat < 49 and 5 < lon < 18:
                result["lat"] = lat
                result["lon"] = lon
                break

    return result


def scrape_resort(slug: str) -> dict:
    """Scrape all data for a resort."""
    result = {
        "slug": slug,
        "found": False,
        "elevation": {},
        "pistes": {},
        "gps": {}
    }

    # Fetch main resort page
    main_url = f"https://www.skiresort.info/ski-resort/{slug}/"
    main_html = fetch_page(main_url, f"resort_{slug}", expected_url_part=slug)

    if not main_html:
        return result

    # Verify we're on a resort page by checking for resort-specific content
    if 'class="resort-' not in main_html and f'/{slug}/' not in main_html:
        print(f"  ⚠ Page doesn't look like a resort page")
        return result

    result["found"] = True

    # Parse elevation and piste data from main page
    result["elevation"] = parse_elevation(main_html)
    result["pistes"] = parse_piste_breakdown(main_html)

    # Fetch arrival page for GPS
    arrival_url = f"https://www.skiresort.info/ski-resort/{slug}/arrival-car/"
    arrival_html = fetch_page(arrival_url, f"arrival_{slug}", expected_url_part=slug)

    if arrival_html:
        result["gps"] = parse_gps_from_arrival_page(arrival_html)

    return result


def get_resorts_from_db(conn, limit: int = None, stable_id: str = None):
    """Get resorts from database."""
    cur = conn.cursor()

    query = """
        SELECT stable_id, name, country,
               ST_Y(center_geom) as lat, ST_X(center_geom) as lon,
               min_elevation_m, max_elevation_m, pistes_km,
               pistes_easy_km, pistes_blue_km, pistes_red_km, pistes_black_km
        FROM resort
        WHERE center_geom IS NOT NULL
    """
    params = []

    if stable_id:
        query += " AND stable_id = %s"
        params.append(stable_id)
    else:
        # Focus on Alpine countries
        query += " AND country IN ('AT', 'CH', 'DE', 'IT', 'FR', 'SI')"

    query += " ORDER BY pistes_km DESC NULLS LAST"

    if limit:
        query += f" LIMIT {limit}"

    cur.execute(query, params)
    columns = [desc[0] for desc in cur.description]

    return [dict(zip(columns, row)) for row in cur.fetchall()]


def update_resort_in_db(conn, stable_id: str, data: dict):
    """Update resort data in database."""
    cur = conn.cursor()

    updates = []
    params = []

    if data.get("elevation", {}).get("min_elevation"):
        updates.append("min_elevation_m = %s")
        params.append(data["elevation"]["min_elevation"])

    if data.get("elevation", {}).get("max_elevation"):
        updates.append("max_elevation_m = %s")
        params.append(data["elevation"]["max_elevation"])

    if data.get("pistes", {}).get("pistes_easy_km"):
        updates.append("pistes_easy_km = %s")
        params.append(data["pistes"]["pistes_easy_km"])

    if data.get("pistes", {}).get("pistes_blue_km"):
        updates.append("pistes_blue_km = %s")
        params.append(data["pistes"]["pistes_blue_km"])

    if data.get("pistes", {}).get("pistes_red_km"):
        updates.append("pistes_red_km = %s")
        params.append(data["pistes"]["pistes_red_km"])

    if data.get("pistes", {}).get("pistes_black_km"):
        updates.append("pistes_black_km = %s")
        params.append(data["pistes"]["pistes_black_km"])

    if data.get("pistes", {}).get("pistes_total_km"):
        updates.append("pistes_km = %s")
        params.append(data["pistes"]["pistes_total_km"])

    if not updates:
        return False

    params.append(stable_id)
    query = f"UPDATE resort SET {', '.join(updates)} WHERE stable_id = %s"

    cur.execute(query, params)
    conn.commit()
    return cur.rowcount > 0


def compare_gps(db_lat: float, db_lon: float, scraped_lat: float, scraped_lon: float) -> dict:
    """Compare GPS coordinates and return distance."""
    if not all([db_lat, db_lon, scraped_lat, scraped_lon]):
        return {"distance_km": None, "match": None}

    # Haversine formula for distance
    from math import radians, sin, cos, sqrt, atan2

    R = 6371  # Earth's radius in km

    lat1, lon1 = radians(db_lat), radians(db_lon)
    lat2, lon2 = radians(scraped_lat), radians(scraped_lon)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))

    distance = R * c

    return {
        "distance_km": round(distance, 2),
        "match": distance < 5  # Consider match if within 5km
    }


def main():
    parser = argparse.ArgumentParser(description="Scrape skiresort.info data")
    parser.add_argument("--dry-run", action="store_true", help="Don't update database")
    parser.add_argument("--update-db", action="store_true", help="Update database with scraped data")
    parser.add_argument("--compare-gps", action="store_true", help="Only compare GPS coordinates")
    parser.add_argument("--resort", type=str, help="Scrape specific resort by stable_id")
    parser.add_argument("--limit", type=int, help="Limit number of resorts to process")
    parser.add_argument("--clear-cache", action="store_true", help="Clear HTML cache before scraping")
    args = parser.parse_args()

    if args.clear_cache:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            print("Cache cleared.")

    print("=" * 60)
    print("SKIRESORT.INFO SCRAPER")
    print("=" * 60)

    conn = psycopg2.connect(**DB_CONFIG)

    resorts = get_resorts_from_db(conn, limit=args.limit, stable_id=args.resort)
    print(f"\nProcessing {len(resorts)} resorts...")

    results = {
        "found": 0,
        "not_found": 0,
        "updated": 0,
        "gps_matches": 0,
        "gps_mismatches": [],
    }

    for i, resort in enumerate(resorts, 1):
        stable_id = resort["stable_id"]
        name = resort["name"]
        country = resort.get("country", "")

        print(f"\n[{i}/{len(resorts)}] {name} ({stable_id})")

        # Get slug from mapping or try to derive it
        slug = SLUG_MAPPINGS.get(stable_id)
        if not slug:
            # Try to search/derive slug from stable_id
            slug = stable_id.replace('_', '-')

        # Scrape data
        data = scrape_resort(slug)

        # If not found, try searching by name
        if not data["found"]:
            print(f"  Trying search by name...")
            found_slug = search_skiresort_info(name, country)
            if found_slug:
                data = scrape_resort(found_slug)
                if data["found"]:
                    slug = found_slug

        if not data["found"]:
            print(f"  ❌ Not found on skiresort.info")
            results["not_found"] += 1
            continue

        results["found"] += 1
        print(f"  ✓ Found: {slug}")

        # Print elevation data
        elev = data.get("elevation", {})
        if elev.get("min_elevation"):
            print(f"  Elevation: {elev['min_elevation']}m - {elev['max_elevation']}m (diff: {elev.get('elevation_diff', 'N/A')}m)")

        # Print piste data
        pistes = data.get("pistes", {})
        piste_str = []
        if pistes.get("pistes_easy_km"):
            piste_str.append(f"Easy: {pistes['pistes_easy_km']}km")
        if pistes.get("pistes_blue_km"):
            piste_str.append(f"Blue: {pistes['pistes_blue_km']}km")
        if pistes.get("pistes_red_km"):
            piste_str.append(f"Red: {pistes['pistes_red_km']}km")
        if pistes.get("pistes_black_km"):
            piste_str.append(f"Black: {pistes['pistes_black_km']}km")
        if piste_str:
            print(f"  Pistes: {', '.join(piste_str)}")
        if pistes.get("pistes_total_km"):
            print(f"  Total: {pistes['pistes_total_km']}km")

        # Compare GPS
        gps = data.get("gps", {})
        if gps.get("lat"):
            comparison = compare_gps(resort["lat"], resort["lon"], gps["lat"], gps["lon"])
            if comparison["match"]:
                results["gps_matches"] += 1
                print(f"  GPS: ✓ Match (distance: {comparison['distance_km']}km)")
            else:
                results["gps_mismatches"].append({
                    "stable_id": stable_id,
                    "name": name,
                    "db": (resort["lat"], resort["lon"]),
                    "scraped": (gps["lat"], gps["lon"]),
                    "distance_km": comparison["distance_km"]
                })
                print(f"  GPS: ⚠ Mismatch! Distance: {comparison['distance_km']}km")
                print(f"       DB: ({resort['lat']:.4f}, {resort['lon']:.4f})")
                print(f"       Scraped: ({gps['lat']:.4f}, {gps['lon']:.4f})")

        # Update DB if requested
        if args.update_db and not args.dry_run:
            if update_resort_in_db(conn, stable_id, data):
                results["updated"] += 1
                print(f"  ✓ Database updated")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Found: {results['found']}/{len(resorts)}")
    print(f"Not found: {results['not_found']}")
    if args.update_db:
        print(f"Updated in DB: {results['updated']}")
    print(f"GPS matches: {results['gps_matches']}")
    print(f"GPS mismatches: {len(results['gps_mismatches'])}")

    if results["gps_mismatches"]:
        print("\n--- GPS MISMATCHES (>5km) ---")
        for m in results["gps_mismatches"][:20]:  # Show first 20
            print(f"  {m['name']}: {m['distance_km']}km off")
            print(f"    DB: {m['db']}, Scraped: {m['scraped']}")

    conn.close()


if __name__ == "__main__":
    main()
