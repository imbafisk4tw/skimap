#!/usr/bin/env python3
"""
Scrape detailed resort data from Bergfex:
- Season start/end dates
- Operating hours
- Lift types (gondola, chairlift, draglift)
- Official website URL
- Bergfex URL

Usage:
  python scrape_bergfex_details.py --dry-run
  python scrape_bergfex_details.py --update-db
  python scrape_bergfex_details.py --resort zermatt --update-db
  python scrape_bergfex_details.py --limit 10 --dry-run
"""

import json
import sys
import argparse
import time
import re
from pathlib import Path
from datetime import datetime

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

# Cache directory
CACHE_DIR = Path(__file__).parent.parent / ".cache" / "bergfex_details"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Rate limiting (0.3s = ~200 requests/min, safe for most servers)
REQUEST_DELAY = 0.3

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
}


def get_cached_html(cache_key: str) -> str | None:
    """Get HTML from cache if exists."""
    cache_file = CACHE_DIR / f"{cache_key}.html"
    if cache_file.exists():
        return cache_file.read_text(encoding='utf-8')
    return None


def save_to_cache(html: str, cache_key: str):
    """Save HTML to cache."""
    cache_file = CACHE_DIR / f"{cache_key}.html"
    cache_file.write_text(html, encoding='utf-8')


def fetch_page(url: str, cache_key: str = None) -> str | None:
    """Fetch a page with caching and rate limiting."""
    if cache_key:
        cached = get_cached_html(cache_key)
        if cached:
            return cached

    try:
        time.sleep(REQUEST_DELAY)
        response = requests.get(url, headers=HEADERS, timeout=30, allow_redirects=True)

        if response.status_code == 200:
            html = response.text
            if cache_key:
                save_to_cache(html, cache_key)
            return html
        else:
            print(f"  HTTP {response.status_code}")
            return None
    except Exception as e:
        print(f"  Error: {e}")
        return None


def parse_season_dates(html: str) -> dict:
    """Extract season start and end dates."""
    result = {"season_start": None, "season_end": None}

    # Pattern: 06.12.2025 - 19.04.2026
    pattern = r'(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})'
    match = re.search(pattern, html)

    if match:
        try:
            start_day, start_month, start_year = match.group(1), match.group(2), match.group(3)
            end_day, end_month, end_year = match.group(4), match.group(5), match.group(6)

            result["season_start"] = f"{start_year}-{start_month}-{start_day}"
            result["season_end"] = f"{end_year}-{end_month}-{end_day}"
        except:
            pass

    return result


def parse_operating_hours(html: str) -> str | None:
    """Extract operating hours."""
    # Pattern: 09:00 - 17:15
    pattern = r'(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})'
    match = re.search(pattern, html)

    if match:
        return f"{match.group(1)}-{match.group(2)}"
    return None


def parse_lift_types(html: str) -> dict:
    """Extract lift counts by type."""
    result = {
        "lifts_gondola": 0,
        "lifts_chairlift": 0,
        "lifts_draglift": 0
    }

    # Bergfex uses tooltip pattern: tooltip('Gondelbahnen') followed by count
    # <div x-data x-bind="tooltip('Gondelbahnen')">...<p class="...">10</p>

    patterns = {
        # Gondolas: Gondelbahnen, Pendelbahnen, Standseilbahnen, Kabinenbahn
        "lifts_gondola": [
            r"tooltip\('Gondelbahnen'\).*?<p[^>]*>(\d+)</p>",
            r"tooltip\('Pendelbahnen'\).*?<p[^>]*>(\d+)</p>",
            r"tooltip\('Standseilbahnen[^']*'\).*?<p[^>]*>(\d+)</p>",
            r"tooltip\('Kabinenbahn[^']*'\).*?<p[^>]*>(\d+)</p>",
        ],
        # Chairlifts: Sessellifte
        "lifts_chairlift": [
            r"tooltip\('Sessellifte'\).*?<p[^>]*>(\d+)</p>",
        ],
        # Draglifts: Schlepplifte, Zauberteppiche
        "lifts_draglift": [
            r"tooltip\('Schlepplifte'\).*?<p[^>]*>(\d+)</p>",
            r"tooltip\('Zauberteppiche'\).*?<p[^>]*>(\d+)</p>",
        ],
    }

    for lift_type, regex_list in patterns.items():
        total = 0
        for regex in regex_list:
            matches = re.findall(regex, html, re.S | re.I)
            for m in matches:
                try:
                    total += int(m)
                except:
                    pass
        # Avoid double counting (page might have duplicates)
        result[lift_type] = total // 2 if total > 0 else 0

    return result


def parse_website(html: str) -> str | None:
    """Extract official resort website from contact section."""
    # Pattern: <span class="tw-line-clamp-1 tw-break-all">https://www.example.com</span>
    # in the Kontakt section

    # First find the Kontakt section
    kontakt_match = re.search(r'Kontakt.*?</section>', html, re.S | re.I)
    if not kontakt_match:
        # Try alternative - look for contact_website tracking
        kontakt_match = re.search(r'contact_website.*?</a>', html, re.S | re.I)

    if kontakt_match:
        section = kontakt_match.group(0)
        # Find URL in this section
        url_match = re.search(r'<span[^>]*class="[^"]*tw-line-clamp[^"]*"[^>]*>(https?://[^<]+)</span>', section)
        if url_match:
            return url_match.group(1).strip()

        # Alternative: look for href with tracking
        url_match = re.search(r'href="[^"]*/(https?[^"]+)"[^>]*data-tracking-data="contact_website"', section)
        if url_match:
            from urllib.parse import unquote
            return unquote(url_match.group(1))

    # Fallback: look for website in meta or structured data
    url_match = re.search(r'"url"\s*:\s*"(https?://[^"]+)"', html)
    if url_match:
        url = url_match.group(1)
        if 'bergfex' not in url.lower():
            return url

    return None


def parse_piste_breakdown(html: str) -> dict:
    """Extract piste km breakdown from donut chart.

    Bergfex shows pistes as a CSS donut chart with rotation angles.
    Colors: tw-bg-brand (blue), tw-bg-red (red), tw-bg-brand-black (black)
    Dividers mark the boundaries between colors.
    """
    result = {
        "pistes_blue_km": None,
        "pistes_red_km": None,
        "pistes_black_km": None
    }

    # First get total pistes km
    total_match = re.search(r'Pisten.*?<span[^>]*>(\d+)\s*km</span>', html, re.S | re.I)
    if not total_match:
        # Alternative pattern
        total_match = re.search(r'tw-chart-donut.*?</div><span[^>]*>(\d+)\s*km</span>', html, re.S)

    if not total_match:
        return result

    total_km = float(total_match.group(1))

    # Find the donut chart section (first occurrence only)
    chart_match = re.search(r'<div class="tw-chart-donut[^"]*">(.*?)</div>\s*</div>\s*<div class="circle', html, re.S)
    if not chart_match:
        return result

    chart_html = chart_match.group(1)

    # Extract divider positions (these mark color boundaries)
    dividers = re.findall(r'divider.*?--rotation:\s*([\d.]+)deg', chart_html)
    dividers = [float(d) for d in dividers]

    if len(dividers) < 2:
        return result

    # Sort dividers and add 360 for calculation
    dividers = sorted(set(dividers))

    # Calculate segments based on divider positions
    # Typical order: 0 (blue start) -> X (red start) -> Y (black start) -> 360
    if len(dividers) >= 2:
        # Blue: from 0 to first non-zero divider
        blue_end = dividers[1] if dividers[0] == 0 else dividers[0]
        blue_pct = blue_end / 360.0

        # Black: from last divider to 360
        black_start = dividers[-1]
        black_pct = (360.0 - black_start) / 360.0

        # Red: everything in between
        red_pct = 1.0 - blue_pct - black_pct

        # Calculate km values
        if blue_pct > 0.01:  # At least 1%
            result["pistes_blue_km"] = round(total_km * blue_pct, 1)
        if red_pct > 0.01:
            result["pistes_red_km"] = round(total_km * red_pct, 1)
        if black_pct > 0.01:
            result["pistes_black_km"] = round(total_km * black_pct, 1)

    return result


def parse_price(html: str) -> dict:
    """Extract day ticket price."""
    result = {"price_value": None, "price_currency": None}

    # Pattern: €66.00 or EUR 66,00 or 66 €
    patterns = [
        r'€\s*(\d+(?:[.,]\d{2})?)',
        r'(\d+(?:[.,]\d{2})?)\s*€',
        r'EUR\s*(\d+(?:[.,]\d{2})?)',
        r'CHF\s*(\d+(?:[.,]\d{2})?)',
    ]

    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            price_str = match.group(1).replace(',', '.')
            try:
                result["price_value"] = float(price_str)
                result["price_currency"] = "CHF" if "CHF" in pattern else "EUR"
                break
            except:
                pass

    return result


def scrape_bergfex_resort(url: str, cache_key: str) -> dict:
    """Scrape all data for a resort from Bergfex."""
    result = {
        "found": False,
        "season": {},
        "operating_hours": None,
        "lifts": {},
        "pistes": {},
        "website": None,
        "price": {}
    }

    html = fetch_page(url, cache_key)
    if not html:
        return result

    # Verify it's a resort page
    if 'skigebiet' not in html.lower() and 'skiresort' not in html.lower():
        print(f"  ⚠ Not a ski resort page")
        return result

    result["found"] = True
    result["season"] = parse_season_dates(html)
    result["operating_hours"] = parse_operating_hours(html)
    result["lifts"] = parse_lift_types(html)
    result["pistes"] = parse_piste_breakdown(html)
    result["website"] = parse_website(html)
    result["price"] = parse_price(html)

    return result


def get_resorts_with_bergfex(conn, limit: int = None, stable_id: str = None):
    """Get resorts that have a Bergfex URL."""
    cur = conn.cursor()

    query = """
        SELECT r.stable_id, r.name, r.country, el.external_url
        FROM resort r
        JOIN resort_external_link el ON r.id = el.resort_id
        WHERE el.provider = 'bergfex'
    """

    if stable_id:
        query += f" AND r.stable_id = '{stable_id}'"

    query += " ORDER BY r.pistes_km DESC NULLS LAST"

    if limit:
        query += f" LIMIT {limit}"

    cur.execute(query)

    resorts = []
    for row in cur.fetchall():
        resorts.append({
            "stable_id": row[0],
            "name": row[1],
            "country": row[2],
            "bergfex_url": row[3]
        })

    return resorts


def update_resort_in_db(conn, stable_id: str, bergfex_url: str, data: dict):
    """Update resort with scraped Bergfex data."""
    cur = conn.cursor()

    updates = []
    params = []

    # Bergfex URL
    updates.append("bergfex_url = %s")
    params.append(bergfex_url)

    # Season dates
    if data.get("season", {}).get("season_start"):
        updates.append("season_start = %s")
        params.append(data["season"]["season_start"])

    if data.get("season", {}).get("season_end"):
        updates.append("season_end = %s")
        params.append(data["season"]["season_end"])

    # Operating hours
    if data.get("operating_hours"):
        updates.append("operating_hours = %s")
        params.append(data["operating_hours"])

    # Lift types
    lifts = data.get("lifts", {})
    if lifts.get("lifts_gondola"):
        updates.append("lifts_gondola = %s")
        params.append(lifts["lifts_gondola"])

    if lifts.get("lifts_chairlift"):
        updates.append("lifts_chairlift = %s")
        params.append(lifts["lifts_chairlift"])

    if lifts.get("lifts_draglift"):
        updates.append("lifts_draglift = %s")
        params.append(lifts["lifts_draglift"])

    # Piste breakdown (Bergfex system: blue, red, black)
    pistes = data.get("pistes", {})
    if pistes.get("pistes_blue_km"):
        updates.append("pistes_blue_km = %s")
        params.append(pistes["pistes_blue_km"])

    if pistes.get("pistes_red_km"):
        updates.append("pistes_red_km = %s")
        params.append(pistes["pistes_red_km"])

    if pistes.get("pistes_black_km"):
        updates.append("pistes_black_km = %s")
        params.append(pistes["pistes_black_km"])

    # Website (only if not already set and we found one)
    if data.get("website"):
        updates.append("website = COALESCE(website, %s)")
        params.append(data["website"])

    if not updates:
        return False

    params.append(stable_id)
    query = f"UPDATE resort SET {', '.join(updates)} WHERE stable_id = %s"

    cur.execute(query, params)
    conn.commit()
    return cur.rowcount > 0


def main():
    parser = argparse.ArgumentParser(description="Scrape Bergfex resort details")
    parser.add_argument("--dry-run", action="store_true", help="Don't update database")
    parser.add_argument("--update-db", action="store_true", help="Update database")
    parser.add_argument("--resort", type=str, help="Scrape specific resort by stable_id")
    parser.add_argument("--limit", type=int, help="Limit number of resorts")
    parser.add_argument("--clear-cache", action="store_true", help="Clear cache")
    args = parser.parse_args()

    if args.clear_cache:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            print("Cache cleared.")

    print("=" * 60)
    print("BERGFEX DETAILS SCRAPER")
    print("=" * 60)

    conn = psycopg2.connect(**DB_CONFIG)

    resorts = get_resorts_with_bergfex(conn, limit=args.limit, stable_id=args.resort)
    print(f"\nProcessing {len(resorts)} resorts with Bergfex links...")

    stats = {
        "found": 0,
        "not_found": 0,
        "updated": 0,
        "with_website": 0,
        "with_season": 0,
        "with_lifts": 0,
        "with_pistes": 0,
    }

    for i, resort in enumerate(resorts, 1):
        stable_id = resort["stable_id"]
        name = resort["name"]
        bergfex_url = resort["bergfex_url"]

        # Create cache key from URL
        cache_key = bergfex_url.replace("https://", "").replace("http://", "").replace("/", "_").rstrip("_")

        print(f"\n[{i}/{len(resorts)}] {name} ({stable_id})")
        print(f"  URL: {bergfex_url}")

        data = scrape_bergfex_resort(bergfex_url, cache_key)

        if not data["found"]:
            print(f"  ❌ Not found or error")
            stats["not_found"] += 1
            continue

        stats["found"] += 1

        # Print results
        season = data.get("season", {})
        if season.get("season_start"):
            print(f"  📅 Season: {season['season_start']} - {season.get('season_end', '?')}")
            stats["with_season"] += 1

        if data.get("operating_hours"):
            print(f"  ⏰ Hours: {data['operating_hours']}")

        lifts = data.get("lifts", {})
        if any(lifts.values()):
            lift_str = []
            if lifts.get("lifts_gondola"):
                lift_str.append(f"Gondola: {lifts['lifts_gondola']}")
            if lifts.get("lifts_chairlift"):
                lift_str.append(f"Chair: {lifts['lifts_chairlift']}")
            if lifts.get("lifts_draglift"):
                lift_str.append(f"Drag: {lifts['lifts_draglift']}")
            print(f"  🚡 Lifts: {', '.join(lift_str)}")
            stats["with_lifts"] += 1

        pistes = data.get("pistes", {})
        if any(pistes.values()):
            piste_str = []
            if pistes.get("pistes_blue_km"):
                piste_str.append(f"🔵 {pistes['pistes_blue_km']}")
            if pistes.get("pistes_red_km"):
                piste_str.append(f"🔴 {pistes['pistes_red_km']}")
            if pistes.get("pistes_black_km"):
                piste_str.append(f"⚫ {pistes['pistes_black_km']}")
            print(f"  ⛷️ Pisten: {' / '.join(piste_str)} km")
            stats["with_pistes"] += 1

        if data.get("website"):
            print(f"  🌐 Website: {data['website']}")
            stats["with_website"] += 1

        price = data.get("price", {})
        if price.get("price_value"):
            print(f"  💰 Price: {price['price_currency']} {price['price_value']}")

        # Update database
        if args.update_db:
            if update_resort_in_db(conn, stable_id, bergfex_url, data):
                print(f"  ✓ Database updated")
                stats["updated"] += 1
        elif args.dry_run:
            print(f"  (dry-run, no DB update)")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total processed: {len(resorts)}")
    print(f"Found: {stats['found']}")
    print(f"Not found: {stats['not_found']}")
    print(f"With season dates: {stats['with_season']}")
    print(f"With lift breakdown: {stats['with_lifts']}")
    print(f"With piste breakdown: {stats['with_pistes']}")
    print(f"With website: {stats['with_website']}")
    if args.update_db:
        print(f"Updated in DB: {stats['updated']}")

    conn.close()


if __name__ == "__main__":
    main()
