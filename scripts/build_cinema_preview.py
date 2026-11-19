#!/usr/bin/env python3
"""Refresh the standalone local cinema preview using public, read-only sources."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from zoneinfo import ZoneInfo

from cinesa_showtimes import CinesaClient, ChromeTransport, atomic_write, collect as collect_cinesa
from collect_posters import collect as collect_posters
from explore_premium_showtimes import mooby_sessions, yelmo_sessions
from kinepolis_showtimes import build_report as splau_report, fetch_html
from poster_fallbacks import enrich as enrich_posters, json_fetch
from poster_policy import prefer_poster, copy_poster
from film_ratings import enrich as enrich_ratings
from film_grouping import deduplicate_programme
from original_audio import original_audio, original_language_registry
from catalogue_sources import CatalogueHTTP, A1
from screening_prices import observation
from cinema_expansion import NEW_CINEMAS, expanded_catalogues

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "static" / "preview-data"
MADRID = ZoneInfo("Europe/Madrid")
PHENOMENA_API = "https://phenomena.luke-391.workers.dev"
CINEMAS = [
    {"id": "phenomena", "name": "Phenomena Experience", "short": "Phenomena", "area": "Barcelona · Eixample", "criteria": "Phenomena auditorium", "url": "https://phenomena-experience.com"},
    {"id": "mooby-balmes", "name": "Mooby Balmes", "short": "Balmes", "area": "Barcelona · Sant Gervasi", "criteria": "VOSE · Dolby Atmos · Salas 8 & 9", "url": "https://www.moobycinemas.com/balmes"},
    {"id": "mooby-bosque", "name": "Mooby Bosque", "short": "Bosque", "area": "Barcelona · Gràcia", "criteria": "VOSE · Dolby Atmos · Sala 1", "url": "https://www.moobycinemas.com/bosque"},
    {"id": "mooby-aribau", "name": "Mooby Aribau", "short": "Aribau", "area": "Barcelona · Eixample", "criteria": "VOSE · Sala 5", "url": "https://www.moobycinemas.com/aribau"},
    {"id": "cinesa-diagonal-mar", "name": "Cinesa Diagonal Mar", "short": "Diagonal Mar", "area": "Barcelona · Diagonal Mar", "criteria": "VOSE · IMAX or iSense", "url": "https://www.cinesa.es/Cines/diagonal-mar/"},
    {"id": "cinesa-la-farga", "name": "Cinesa LUXE La Farga", "short": "La Farga", "area": "L’Hospitalet de Llobregat", "criteria": "VOSE · LUXE", "url": "https://www.cinesa.es/cines/la-farga/"},
    {"id": "yelmo-maquinista", "name": "Yelmo Premium La Maquinista", "short": "La Maquinista", "area": "Barcelona · Sant Andreu", "criteria": "VOSE · PREMIUM, XE or ATMOS", "url": "https://yelmocines.es/cartelera/barcelona/westfield-la-maquinista"},
    {"id": "kinepolis-splau", "name": "Kinépolis Barcelona Splau", "short": "Splau", "area": "Cornellà de Llobregat", "criteria": "VOSE · Laser ULTRA or Dolby Atmos", "url": "https://kinepolis.es/movie-formats/laser-ultra"},
]

CINEMAS = [{**cinema, "big_screen_criteria": cinema["criteria"], "criteria": "Original audio · All rooms"}
           for cinema in CINEMAS] + NEW_CINEMAS

# Explicit source-ID links reviewed against the observed film variants. Never
# fuzzy-join arbitrary titles, reissues or opera seasons. Unmapped films remain
# namespaced by provider. Original Dune and Dune: Part Three are distinct.
FILM_LINKS = {
    "cinesa:HO00003782": "imdb:tt34890576", "cinesa:HO00003802": "imdb:tt32558705",
    "cinesa:HO00003679": "imdb:tt31378509", "cinesa:HO00003791": "imdb:tt21357150",
    "cinesa:HO00003571": "imdb:tt21357150", "yelmo:7304": "imdb:tt32558705",
    "yelmo:7137": "imdb:tt31378509", "yelmo:7337": "imdb:tt21357150",
    "yelmo:7415": "imdb:tt0087182", "cinesa:HO00003893": "edition:rocky-50",
    "yelmo:7402": "edition:rocky-50", "cinesa:HO00003848": "imdb:tt2056785",
    "yelmo:7352": "imdb:tt2056785", "cinesa:HO00003792": "imdb:tt34384661",
    "yelmo:7322": "imdb:tt34384661", "cinesa:HO00003800": "imdb:tt35866986",
    "yelmo:7367": "imdb:tt34966140", "yelmo:7209": "imdb:tt38077943",
    "yelmo:7408": "imdb:tt45368240", "phenomena:2964": "imdb:tt33764258",
    "phenomena:3020": "imdb:tt34890576", "phenomena:3045": "imdb:tt0087182",
    "phenomena:2988": "imdb:tt31378509", "phenomena:3016": "imdb:tt31378509",
    "phenomena:3021": "imdb:tt15799564", "yelmo:7211": "imdb:tt15799564",
    "cinesa:HO00003865": "imdb:tt15799564", "phenomena:3003": "imdb:tt38058097",
    "cinesa:HO00003892": "imdb:tt38773219", "phenomena:3050": "imdb:tt38773219",
    "cinesa:HO00003932": "imdb:tt34966140", "cinesa:HO00003689": "imdb:tt7526136",
    "phenomena:106": "imdb:tt1160419", "phenomena:850": "imdb:tt15239678",
}

DISPLAY_TITLES = {"imdb:tt0087182": "Dune (1984)", "imdb:tt1160419": "Dune (2021)"}


def film_key(row):
    provider = row.get("provider") or row["id"].split(":")[0]
    imdb = row.get("imdb_id") or (row.get("film_id") if provider == "mooby" else None)
    if imdb and re.fullmatch(r"tt\d+", imdb):
        return "imdb:" + imdb
    key = provider + ":" + str(row["film_id"])
    return FILM_LINKS.get(key, key)


def formats(row):
    raw = row.get("format") or ""
    result = []
    for token, label in [("IMAX", "IMAX"), ("iSense", "iSense"), ("Laser ULTRA", "Laser ULTRA"),
                         ("ATMOS", "Dolby Atmos"), ("PREMIUM", "PREMIUM"), ("XE", "XE"),
                         ("4K", "4K"), ("35mm", "35mm"), ("70mm", "70mm")]:
        if re.search(r"(?<!\w)" + re.escape(token) + r"(?!\w)", raw, re.I):
            result.append(label)
    if row.get("venue_experience"):
        result.append(row["venue_experience"])
    return list(dict.fromkeys(result))


def phenomena_sessions(payload, *, vose_only=False, original_only=False):
    rows = []
    checked = payload.get("_meta", {}).get("scraped_at")
    for film in payload["events"]:
        name = film["name"]
        if vose_only and not re.search(r"\bVOSE\b", name, re.I):
            continue
        qualification = original_audio(' '.join(re.findall(r'\(([^)]+)\)', name)))
        if original_only and not qualification:
            continue
        title = re.sub(r"\s*\(Proyecci[oó]n.*?\)\s*", "", name, flags=re.I).strip()
        for session in film["sessions"]:
            local = datetime.strptime(session["date"] + " " + session["time"], "%d/%m/%Y %H:%M").replace(tzinfo=MADRID)
            fid, sid = str(film["evento_id"]), str(session["session_id"])
            rows.append({
                "id": "phenomena:" + sid, "provider": "phenomena", "provider_session_id": sid,
                "cinema_id": "phenomena", "film_id": fid, "title": title, "source_title": name,
                "synopsis": film.get("synopsis"), "runtime_minutes": film.get("duration_min"), "year": film.get("year"),
                "poster_url": "https://phenomena-experience.com" + film["poster_v"] if film.get("poster_v") else None,
                "starts_at": local.isoformat(), "date": local.date().isoformat(), "time": local.strftime("%H:%M"),
                "room": str(session.get("sala") or "1"), "version": "VOSE" if "VOSE" in name.upper() else None,
                "big_screen": True,
                "format": name.replace("35 mm", "35mm").replace("70 mm", "70mm"),
                "price_eur": film.get("price_eur"),
                **observation('https://phenomena-experience.com/index?pag=ficha&evento='+fid,
                              amount=film.get('price_eur')),
                "booking_url": "https://phenomena-experience.com/index?pag=ficha&evento=" + fid,
                "source_url": "https://phenomena-experience.com",
                **(qualification or {}),
                "seat_data": {"kind": "reported_total", "available": session.get("available"),
                              "capacity": session.get("capacity"), "purchase_open": session.get("purchase_open"),
                              "closed_reason": session.get("closed_reason"), "checked_at": checked},
            })
    return rows


def assemble(reports, posters, now):
    assets = {asset["url"]: asset for asset in posters["assets"] if asset["status"] in ("ok", "stale")}
    films, seen, coverage = {}, set(), []
    for report in reports:
        captured = report.get("fetched_at")
        for raw in report["sessions"]:
            row = dict(raw)
            starts = datetime.fromisoformat(row["starts_at"]) if row.get("starts_at") else datetime.fromisoformat(row["date"] + "T" + row["time"]).replace(tzinfo=MADRID)
            if starts < now:
                continue
            if row["id"] in seen:
                raise ValueError("Duplicate session identity")
            seen.add(row["id"])
            provider = row.get("provider") or row["id"].split(":")[0]
            row.update(provider=provider, starts_at=starts.astimezone(MADRID).isoformat(), formats=formats(row), schedule_fetched_at=captured)
            if row.get('price_data'):
                row['price_data'] = {**row['price_data'], 'checked_at': captured}
            if "VOSE" in str(row.get("version") or "").upper():
                row["version"] = "VOSE"
            row["room"] = str(int(row["room"])) if str(row.get("room", "")).isdigit() else row.get("room")
            key = film_key(row)
            film = films.setdefault(key, {"id": key, "title": re.sub(r"^VOSE\s+", "", row["title"]),
                                         "titles": [], "poster_url": None, "poster_width": 0, "poster_height": 0,
                                         "synopsis": None, "runtime_minutes": None, "sessions": []})
            for title in [row["title"], row.get("localized_title")]:
                if title and title not in film["titles"]:
                    film["titles"].append(title)
            if row.get("synopsis"):
                film["synopsis"] = row["synopsis"]
            if row.get("runtime_minutes"):
                film["runtime_minutes"] = row["runtime_minutes"]
            asset = assets.get(row.get("poster_url"))
            if asset:
                candidate={'poster_url':'/preview-data/posters/'+asset['filename'],
                           'poster_width':asset['width'],'poster_height':asset['height']}
                if prefer_poster(candidate,film):copy_poster(candidate,film)
            film["sessions"].append(row)
        coverage.append({"source": report.get("provider"), "cinema_id": report.get("cinema_id"),
                         "fetched_at": captured, "count": len(report["sessions"]), "coverage": report.get("coverage")})
    for film in films.values():
        if film["id"] in DISPLAY_TITLES:
            film["title"] = DISPLAY_TITLES[film["id"]]
        film["sessions"].sort(key=lambda row: (datetime.fromisoformat(row["starts_at"]), row["id"]))
    data = {"generated_at": now.isoformat(), "timezone": "Europe/Madrid", "cinemas": CINEMAS,
            "films": sorted(films.values(), key=lambda film: datetime.fromisoformat(film["sessions"][0]["starts_at"])),
            "session_count": len(seen), "coverage": coverage}
    deduplicate_programme(data)
    return data


def refresh_catalogues(output=OUTPUT, *, skip_enrichment=False, nearby_only=False, accept_drops=False):
    from curl_cffi import requests
    from crawler_run import CrawlRun, merge_catalogues
    from crawler_sources import collect_sources
    from crawler_health import refresh_health
    from programme_store import file_lock, update_programme
    output=Path(output);path=output/'screenings.json'
    with file_lock(output/'catalogue-run.lock',blocking=False):
        now=datetime.now(timezone.utc)
        previous=json.loads(path.read_text()) if path.exists() else None
        run=CrawlRun(output,previous,now,accept_drops=accept_drops)
        published=False
        try:
            with requests.Session(impersonate='chrome') as session, CatalogueHTTP(session,output/'catalogue-cache',now) as http:
                collect_sources(http,run,nearby_only=nearby_only)
                if not run.reports:
                    raise ValueError('No cinema catalogue passed validation')
                manifest=output/'posters/posters.json'
                cached=json.loads(manifest.read_text()) if manifest.exists() else {'assets':[]}
                addition=assemble(run.reports,cached,now)
                # Commit validated schedules before any artwork/ratings work.
                # The short lock also protects metadata writers' read/merge/write.
                data=update_programme(path,lambda latest:merge_catalogues(latest,addition,CINEMAS))
                published=True
                run.finish(True)
                refresh_health(output)
                try:
                    def image_fetch(url):
                        response=session.get(url,timeout=20,allow_redirects=False)
                        if response.status_code!=200 or not response.headers.get('content-type','').lower().startswith('image/'):
                            raise ValueError('Poster unavailable')
                        return response.content
                    reports=[{'sessions':[r for f in data['films'] for r in f['sessions']]}]
                    posters=collect_posters(reports,output/'posters',image_fetch,now)
                    assets={a['url']:a for a in posters['assets'] if a['status'] in ('ok','stale')}
                    def artwork(latest):
                        for film in latest['films']:
                            for row in film['sessions']:
                                asset=assets.get(row.get('poster_url'))
                                if asset:
                                    candidate={'poster_url':'/preview-data/posters/'+asset['filename'],
                                               'poster_width':asset['width'],'poster_height':asset['height']}
                                    if prefer_poster(candidate,film):copy_poster(candidate,film)
                        return latest
                    data=update_programme(path,artwork)
                    from optimize_images import refresh_programme_images
                    refresh_programme_images(path)
                    if not skip_enrichment:
                        from film_ratings import refresh_programme
                        refresh_programme(path,now=datetime.now(timezone.utc))
                except Exception as error:
                    print(json.dumps({'event':'optional_enrichment_failed','error':type(error).__name__}),flush=True)
        finally:
            if not published:run.finish(False)
            refresh_health(output)
        print(json.dumps({'cinemas':len(data['cinemas']),'sessions':data['session_count'],
                          'refreshed_cinemas':len(run.reports),'failed_cinemas':run.failures,'output':str(path)}))
        return 2 if run.failures else 0


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,default=OUTPUT)
    parser.add_argument('--skip-enrichment',action='store_true')
    parser.add_argument('--nearby-only',action='store_true')
    parser.add_argument('--accept-count-drops',action='store_true',help='Accept verified cancellations or programme resets after source review')
    args=parser.parse_args()
    return refresh_catalogues(args.output_dir,skip_enrichment=args.skip_enrichment,
                              nearby_only=args.nearby_only,accept_drops=args.accept_count_drops)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("Preview refresh failed; previous programme preserved (" + type(error).__name__ + ")", file=sys.stderr)
        sys.exit(1)
