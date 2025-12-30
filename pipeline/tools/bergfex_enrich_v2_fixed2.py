#!/usr/bin/env python3
"""
bergfex_enrich.py
-----------------
Fetches the Bergfex Austria resort list pages, parses basic metrics (height, piste km, lifts open/total),
writes a cache JSON keyed by Bergfex URL, and optionally merges those metrics into your resorts.json.

Design goals:
- Be polite: low request rate, caching of raw HTML, resumable.
- Be robust-ish: multiple parsing strategies, clear logs, easy to tweak selectors.
- Keep your resorts.json as master; store scraped data separately.

Usage examples
--------------
# 1) Download list pages + build cache
python bergfex_enrich.py fetch-and-parse \
  --start-url "https://www.bergfex.at/oesterreich/" \
  --out-cache "bergfex_cache.json" \
  --cache-dir ".cache/bergfex" \
  --sleep 1.2 \
  --max-pages 40

# 2) Merge cache into resorts.json (prefers explicit bergfexUrl field, else name-match fallback)
python bergfex_enrich.py merge \
  --resorts "/mnt/data/resorts.json" \
  --cache "bergfex_cache.json" \
  --out-merged "resorts_merged.json" \
  --prefer "maxElevationM,pisteKm,liftsOpen,liftsTotal"

# 3) One-shot: fetch+parse then merge
python bergfex_enrich.py all \
  --start-url "https://www.bergfex.at/oesterreich/" \
  --resorts "/mnt/data/resorts.json" \
  --out-cache "bergfex_cache.json" \
  --out-merged "resorts_merged.json" \
  --cache-dir ".cache/bergfex" \
  --sleep 1.2 \
  --max-pages 40

Notes
-----
- This script *tries* to parse the list page layout. If Bergfex changes markup,
  open one of the saved HTML files in cache-dir/html/ and tweak `parse_list_page()`.
- Always respect the website's terms and robots rules. Keep the request rate low.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from difflib import SequenceMatcher
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


USER_AGENT = "Mozilla/5.0 (compatible; SkigebieteKarte/1.0; +https://example.invalid/bot)"


# -----------------------------
# Parsing helpers
# -----------------------------
_RE_INT = re.compile(r"(\d{1,3}(?:[.\s]\d{3})*|\d+)")
_RE_FLOAT = re.compile(r"(\d+(?:[.,]\d+)?)")

def norm_name(s: str) -> str:
    s = s.strip().lower()
    # german umlauts (very small normalization to improve matching)
    s = (s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss"))
    # remove brackets and punctuation
    s = re.sub(r"[^\w\s]", " ", s)
    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    # optionally drop common glue words
    drop = {"skigebiet", "ski", "bahn", "bahnen", "gletscherwelt", "gletscher"}
    tokens = [t for t in s.split() if t not in drop]
    return " ".join(tokens)

def parse_elevation_m(text: str) -> Optional[int]:
    """Extract elevation in meters from any text.

    Robust against strings that also contain other metrics (km/cm/etc).
    Examples:
      - "3.440 m"
      - "Pitztal ... (3.440 m) ... Pisten: 68 km ..."
    """
    if not text:
        return None
    m = re.search(r"(\d{1,3}(?:[.\s]\d{3})*|\d+)\s*m\b", text, flags=re.IGNORECASE)
    if not m:
        return None
    val = m.group(1).replace(".", "").replace(" ", "")
    try:
        return int(val)
    except ValueError:
        return None


def parse_km(text: str) -> Optional[float]:
    """Extract piste kilometers from any text.

    Important: some Bergfex cells contain multiple numbers (e.g. elevation + piste km).
    We therefore look specifically for a number directly followed by 'km'.
    """
    if not text:
        return None

    matches = list(re.finditer(r"(\d+(?:[.,]\d+)?)\s*km\b", text, flags=re.IGNORECASE))
    if not matches:
        return None

    # Prefer a match that is likely the 'Pisten' value.
    chosen = matches[0]
    for mm in matches:
        pre = text[max(0, mm.start() - 40): mm.start()].lower()
        if "pisten" in pre:
            chosen = mm
            break

    val = chosen.group(1).replace(",", ".")
    try:
        return float(val)
    except ValueError:
        return None


def parse_lifts(text: str) -> Tuple[Optional[int], Optional[int]]:
    # e.g. "13/13" or "19/26"
    if not text:
        return (None, None)
    m = re.search(r"(\d+)\s*/\s*(\d+)", text)
    if not m:
        return (None, None)
    return (int(m.group(1)), int(m.group(2)))

def parse_snow_cm(text: str) -> Optional[int]:
    """Extract snow height in cm from any text.

    Like parse_km, we search explicitly for a number followed by 'cm'.
    """
    if not text:
        return None

    matches = list(re.finditer(r"(\d{1,3}(?:[.\s]\d{3})*|\d+)\s*cm\b", text, flags=re.IGNORECASE))
    if not matches:
        return None

    chosen = matches[0]
    for mm in matches:
        pre = text[max(0, mm.start() - 40): mm.start()].lower()
        if "schnee" in pre:
            chosen = mm
            break

    val = chosen.group(1).replace(".", "").replace(" ", "")
    try:
        return int(val)
    except ValueError:
        return None


@dataclass
class ResortRow:
    name: str
    url: str
    max_elev_m: Optional[int]
    piste_km: Optional[float]
    lifts_open: Optional[int]
    lifts_total: Optional[int]
    snow_cm: Optional[int] = None
    source_page: Optional[str] = None


def best_table_candidate(soup: BeautifulSoup) -> Optional[Any]:
    """
    Finds the table that most likely contains the resort list by scoring header cells.
    Works if the list is actually in a <table>. If Bergfex changes layout to pure divs,
    this returns None and we fall back to heuristic parsing.
    """
    tables = soup.find_all("table")
    best = None
    best_score = 0
    for t in tables:
        headers = []
        thead = t.find("thead")
        if thead:
            headers = [th.get_text(" ", strip=True).lower() for th in thead.find_all(["th", "td"])]
        else:
            # sometimes header is first row
            first_tr = t.find("tr")
            if first_tr:
                headers = [c.get_text(" ", strip=True).lower() for c in first_tr.find_all(["th", "td"])]
        score = 0
        for h in headers:
            if "name" in h:
                score += 3
            if "höhe" in h or "hoehe" in h:
                score += 2
            if "pisten" in h:
                score += 2
            if "lifte" in h:
                score += 2
            if "schnee" in h:
                score += 1
            if "preis" in h:
                score += 1
        if score > best_score:
            best_score = score
            best = t
    return best if best_score >= 4 else None


def parse_list_page(html: str, page_url: str) -> Tuple[List[ResortRow], Optional[str]]:
    """
    Parse one Bergfex list page.

    Returns:
      - rows: list of ResortRow
      - next_url: URL of the next page (or None)
    """
    soup = BeautifulSoup(html, "html.parser")

    # --- Next-page detection (heuristic) ---
    next_url = None
    # 1) rel="next"
    link_next = soup.find("a", attrs={"rel": "next"})
    if link_next and link_next.get("href"):
        next_url = urljoin(page_url, link_next["href"])
    else:
        # 2) look for pagination anchors by text
        for a in soup.find_all("a"):
            txt = a.get_text(" ", strip=True).lower()
            if txt in {"weiter", "next", ">", "»"} and a.get("href"):
                next_url = urljoin(page_url, a["href"])
                break

    rows: List[ResortRow] = []

    # --- Strategy A: Table layout ---
    table = best_table_candidate(soup)
    if table:
        body = table.find("tbody") or table
        for tr in body.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if not cells:
                continue

            # find a resort link + name
            a = tr.find("a", href=True)
            if not a:
                continue
            name = a.get_text(" ", strip=True)
            href = a["href"]
            url = urljoin(page_url, href)

            row_texts = [c.get_text(" ", strip=True) for c in cells]

            # Heuristic: scan each cell for known units.
            elev = None
            piste = None
            lifts_open = lifts_total = None
            snow = None

            for t in row_texts:
                if elev is None:
                    elev = parse_elevation_m(t)
                if piste is None:
                    piste = parse_km(t)
                if lifts_open is None or lifts_total is None:
                    lo, lt = parse_lifts(t)
                    if lo is not None and lt is not None:
                        lifts_open, lifts_total = lo, lt
                if snow is None:
                    snow = parse_snow_cm(t)

            # sanity: require at least a name + url; metrics may be missing
            rows.append(
                ResortRow(
                    name=name,
                    url=url,
                    max_elev_m=elev,
                    piste_km=piste,
                    lifts_open=lifts_open,
                    lifts_total=lifts_total,
                    snow_cm=snow,
                    source_page=page_url,
                )
            )

        return rows, next_url

    # --- Strategy B: Non-table layout (fallback) ---
    # We try to find "row-like" containers: any element that contains a link + at least two of {m, km, /}
    candidates = []
    for a in soup.find_all("a", href=True):
        name = a.get_text(" ", strip=True)
        if not name or len(name) < 3:
            continue
        parent = a.find_parent(["li", "div", "tr", "article", "section"])
        if not parent:
            continue
        blob = parent.get_text(" ", strip=True)
        score = 0
        score += 1 if " km" in blob.lower() else 0
        score += 1 if " m" in blob.lower() else 0
        score += 1 if re.search(r"\d+\s*/\s*\d+", blob) else 0
        if score >= 2:
            candidates.append((score, a, parent, blob))

    # sort by best score; de-dup by URL
    seen = set()
    for score, a, parent, blob in sorted(candidates, key=lambda x: -x[0]):
        url = urljoin(page_url, a["href"])
        if url in seen:
            continue
        seen.add(url)

        elev = parse_elevation_m(blob)
        piste = parse_km(blob)
        lo, lt = parse_lifts(blob)
        snow = parse_snow_cm(blob)

        rows.append(
            ResortRow(
                name=a.get_text(" ", strip=True),
                url=url,
                max_elev_m=elev,
                piste_km=piste,
                lifts_open=lo,
                lifts_total=lt,
                snow_cm=snow,
                source_page=page_url,
            )
        )

    return rows, next_url


# -----------------------------
# Fetching / caching
# -----------------------------
def polite_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        }
    )
    return s


def fetch_with_cache(session: requests.Session, url: str, cache_path: Path, sleep_s: float) -> str:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8", errors="ignore")

    r = session.get(url, timeout=30)
    r.raise_for_status()
    html = r.text
    cache_path.write_text(html, encoding="utf-8")
    time.sleep(max(0.0, sleep_s))
    return html


def fetch_list_pages(
    start_url: str,
    cache_dir: Path,
    sleep_s: float,
    max_pages: int,
) -> List[Tuple[Path, str]]:
    """
    Downloads paginated list pages and stores raw HTML files.

    Returns a list of (html_file_path, page_url) tuples.
    """
    html_dir = cache_dir / "html"
    html_dir.mkdir(parents=True, exist_ok=True)

    sess = polite_session()

    seen_urls: List[str] = []
    current = start_url
    out: List[Tuple[Path, str]] = []

    for i in range(1, max_pages + 1):
        seen_urls.append(current)
        page_file = html_dir / f"page_{i:03d}.html"
        html = fetch_with_cache(sess, current, page_file, sleep_s=sleep_s)

        out.append((page_file, current))

        _, next_url = parse_list_page(html, current)
        if not next_url:
            break

        current = next_url

        # protect against loops
        if current in seen_urls:
            break

    return out


# -----------------------------
# Cache building
# -----------------------------
def build_cache_from_html_files(html_files: List[Path]) -> Dict[str, Dict[str, Any]]:
    cache: Dict[str, Dict[str, Any]] = {}
    scraped_at = datetime.now(timezone.utc).isoformat()

    for f, page_url in html_files:
        html = f.read_text(encoding="utf-8", errors="ignore")
        rows, _ = parse_list_page(html, page_url)

        for r in rows:
            # If the file-based pseudo_url was used, r.url might be wrong; we only keep rows that look like http(s)
            if not (r.url.startswith("http://") or r.url.startswith("https://")):
                continue

            cache[r.url] = {
                "name": r.name,
                "maxElevationM": r.max_elev_m,
                "pisteKm": r.piste_km,
                "liftsOpen": r.lifts_open,
                "liftsTotal": r.lifts_total,
                "snowCm": r.snow_cm,
                "scrapedAt": scraped_at,
                "source": "bergfex_list",
            }

    return cache


def fetch_and_parse(
    start_url: str,
    out_cache: Path,
    cache_dir: Path,
    sleep_s: float,
    max_pages: int,
) -> Dict[str, Dict[str, Any]]:
    html_files = fetch_list_pages(start_url=start_url, cache_dir=cache_dir, sleep_s=sleep_s, max_pages=max_pages)
    if not html_files:
        raise RuntimeError("No HTML files downloaded; check start_url.")
    cache = build_cache_from_html_files(html_files)
    out_cache.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    return cache


# -----------------------------
# Merging into resorts.json
# -----------------------------
def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def merge_into_resorts(
    resorts_path: Path,
    cache_path: Path,
    out_merged: Path,
    prefer_fields: List[str],
    min_score: float = 0.6,
) -> Dict[str, Any]:
    """Merge bergfex_cache.json metrics into your resorts.json.

    Matching order:
      1) If resorts.json already has 'bergfexUrl' and it exists in cache -> use it.
      2) Exact name match via norm_name().
      3) Fuzzy name match against cache names (best score wins), if score >= min_score.
    """
    resorts = load_json(resorts_path)
    if not isinstance(resorts, list):
        raise ValueError("Expected resorts.json to be a JSON array (list).")

    cache = load_json(cache_path)
    if not isinstance(cache, dict):
        raise ValueError("Expected bergfex_cache.json to be an object/dict keyed by URL.")

    # Build cache indices
    name_exact_to_url: Dict[str, str] = {}
    url_to_normname: Dict[str, str] = {}
    for url, rec in cache.items():
        nm = str(rec.get("name") or "")
        k = norm_name(nm)
        if not k:
            continue
        url_to_normname[url] = k
        if k not in name_exact_to_url:
            name_exact_to_url[k] = url

    cache_name_items = list(name_exact_to_url.items())  # (normname -> url)

    def fuzzy_best_url(target_norm: str) -> Tuple[Optional[str], float]:
        best_url = None
        best_score = 0.0
        if not target_norm:
            return None, 0.0

        target_tokens = set(target_norm.split())
        for cand_norm, url in cache_name_items:
            # quick token overlap prefilter
            cand_tokens = set(cand_norm.split())
            union = target_tokens | cand_tokens
            jacc = (len(target_tokens & cand_tokens) / len(union)) if union else 0.0
            # string similarity
            sm = SequenceMatcher(None, target_norm, cand_norm).ratio()
            score = max(jacc, sm)
            if score > best_score:
                best_score = score
                best_url = url

        if best_score >= min_score:
            return best_url, best_score
        return None, best_score

    merged = 0
    by_url = 0
    by_name_exact = 0
    by_fuzzy = 0
    missing = 0
    min_used_score = None

    for r in resorts:
        if not isinstance(r, dict):
            continue

        bergfex_url = r.get("bergfexUrl")
        matched_url = None
        matched_score = None

        # 1) explicit URL match
        if isinstance(bergfex_url, str) and bergfex_url.startswith("http") and bergfex_url in cache:
            matched_url = bergfex_url
            matched_score = 1.0
            by_url += 1

        # 2) exact name match
        if not matched_url:
            k = norm_name(str(r.get("name", "")))
            if k and k in name_exact_to_url:
                matched_url = name_exact_to_url[k]
                matched_score = 1.0
                by_name_exact += 1

        # 3) fuzzy match
        if not matched_url:
            k = norm_name(str(r.get("name", "")))
            matched_url, s = fuzzy_best_url(k)
            if matched_url:
                matched_score = s
                by_fuzzy += 1
                if min_used_score is None or s < min_used_score:
                    min_used_score = s

        if not matched_url:
            missing += 1
            continue

        rec = cache.get(matched_url, {})
        wrote = False
        for f in prefer_fields:
            if f in rec and rec[f] is not None:
                r[f] = rec[f]
                wrote = True

        # keep URL if we found it
        if wrote and not r.get("bergfexUrl"):
            r["bergfexUrl"] = matched_url

        # optional: keep debug score
        if wrote and matched_score is not None:
            r["bergfexMatchScore"] = round(float(matched_score), 3)

        merged += 1

    save_json(out_merged, resorts)

    out = {
        "total_resorts": len(resorts),
        "merged_resorts": merged,
        "matched_by_url": by_url,
        "matched_by_name_exact": by_name_exact,
        "matched_by_fuzzy": by_fuzzy,
        "unmatched": missing,
        "min_score": min_score,
        "cache_entries": len(cache),
    }
    if min_used_score is not None:
        out["min_used_match_score"] = round(float(min_used_score), 3)
    return out


# -----------------------------
# CLI
# -----------------------------
def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Fetch Bergfex Austria list data and merge into resorts.json")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_fetch = sub.add_parser("fetch-and-parse", help="Fetch paginated list pages and write bergfex_cache.json")
    p_fetch.add_argument("--start-url", required=True)
    p_fetch.add_argument("--out-cache", required=True)
    p_fetch.add_argument("--cache-dir", default=".cache/bergfex")
    p_fetch.add_argument("--sleep", type=float, default=1.2)
    p_fetch.add_argument("--max-pages", type=int, default=40)

    p_merge = sub.add_parser("merge", help="Merge bergfex_cache.json into resorts.json")
    p_merge.add_argument("--resorts", required=True)
    p_merge.add_argument("--cache", required=True)
    p_merge.add_argument("--out-merged", required=True)
    p_merge.add_argument("--prefer", default="maxElevationM,pisteKm,liftsOpen,liftsTotal")
    p_merge.add_argument("--min-score", type=float, default=0.6)

    p_all = sub.add_parser("all", help="Fetch+parse then merge")
    p_all.add_argument("--start-url", required=True)
    p_all.add_argument("--resorts", required=True)
    p_all.add_argument("--out-cache", required=True)
    p_all.add_argument("--out-merged", required=True)
    p_all.add_argument("--cache-dir", default=".cache/bergfex")
    p_all.add_argument("--sleep", type=float, default=1.2)
    p_all.add_argument("--max-pages", type=int, default=40)
    p_all.add_argument("--prefer", default="maxElevationM,pisteKm,liftsOpen,liftsTotal")

    args = p.parse_args(argv)

    if args.cmd == "fetch-and-parse":
        cache = fetch_and_parse(
            start_url=args.start_url,
            out_cache=Path(args.out_cache),
            cache_dir=Path(args.cache_dir),
            sleep_s=args.sleep,
            max_pages=args.max_pages,
        )
        print(f"Wrote cache with {len(cache)} entries -> {args.out_cache}")
        return 0

    if args.cmd == "merge":
        prefer_fields = [x.strip() for x in args.prefer.split(",") if x.strip()]
        stats = merge_into_resorts(
            resorts_path=Path(args.resorts),
            cache_path=Path(args.cache),
            out_merged=Path(args.out_merged),
            prefer_fields=prefer_fields,
            min_score=args.min_score,
        )
        print(json.dumps(stats, indent=2))
        return 0

    if args.cmd == "all":
        cache = fetch_and_parse(
            start_url=args.start_url,
            out_cache=Path(args.out_cache),
            cache_dir=Path(args.cache_dir),
            sleep_s=args.sleep,
            max_pages=args.max_pages,
        )
        prefer_fields = [x.strip() for x in args.prefer.split(",") if x.strip()]
        stats = merge_into_resorts(
            resorts_path=Path(args.resorts),
            cache_path=Path(args.out_cache),
            out_merged=Path(args.out_merged),
            prefer_fields=prefer_fields,
        )
        print(f"Wrote cache with {len(cache)} entries -> {args.out_cache}")
        print(json.dumps(stats, indent=2))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
