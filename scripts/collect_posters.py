#!/usr/bin/env python3
"""Cache source posters from showtime JSON, preserving original image bytes.

Repeat --input to combine sources. Requires scripts/requirements-posters.txt.
Artwork failures are recorded independently and never alter showtime snapshots.
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
import warnings

from cinesa_showtimes import atomic_write
from poster_policy import meets_target

ALLOWED_HOSTS = {"www.bizcochito.es", "cms.elqueque.com", "eu-static.yelmocines.es",
                 "vwc.cinesa.es", "cdn.kinepolis.es", "phenomena-experience.com",
                 "media.pillalas.com", "cache-c.koobin.com", "static.portalticket.com",
                 "euromus.cultura.gencat.cat", "www.cinemamalda.com",
                 "images.admit-one.eu", "www.cinebaix.cat", "www.casaelizalde.com",
                 "caixaforum.org", "www.ohlalafilmfestival.com", "www.institutfrancais.es",
                 "espaitexas.cat"}
FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"),
           "WEBP": ("webp", "image/webp"), "AVIF": ("avif", "image/avif")}
MAX_BYTES = 20 * 1024 * 1024


def allowed_url(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS
                and parsed.port in (None, 443) and not parsed.username and not parsed.password
                and not parsed.fragment)
    except (ValueError, TypeError):
        return False


def sources(reports):
    grouped, missing = {}, {}
    for report in reports:
        for row in report["sessions"]:
            provider = row.get("provider") or row["id"].split(":")[0]
            film = {"provider": provider, "film_id": row.get("film_id"), "title": row["title"]}
            identity = (provider, row.get("film_id"), row["title"])
            url = row.get("poster_url")
            if url:
                grouped.setdefault(url, {})[identity] = film
            else:
                missing[identity] = film
    known = {identity for films in grouped.values() for identity in films}
    return {url: list(films.values()) for url, films in grouped.items()}, [film for key, film in missing.items() if key not in known]


def image_metadata(body):
    from PIL import Image
    if not body or len(body) > MAX_BYTES:
        raise ValueError("Image is empty or exceeds 20 MiB")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(body)) as picture:
            if picture.format not in FORMATS:
                raise ValueError("Unsupported image format")
            extension, mime = FORMATS[picture.format]
            width, height = picture.size
            picture.verify()
    return {"width": width, "height": height, "content_type": mime, "extension": extension,
            "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def cached_file(output, asset):
    filename = asset.get("filename", "")
    if not filename or Path(filename).name != filename:
        return False
    path = output / filename
    return (path.is_file() and path.stat().st_size == asset.get("bytes")
            and hashlib.sha256(path.read_bytes()).hexdigest() == asset.get("sha256"))


def save_image(output, body, metadata):
    filename = metadata["sha256"] + "." + metadata["extension"]
    path = output / filename
    if (not path.is_file() or path.stat().st_size != len(body)
            or hashlib.sha256(path.read_bytes()).hexdigest() != metadata["sha256"]):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=output, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(body)
            os.replace(temporary, path)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
    return filename


def collect(reports, output, fetch, now, max_age=timedelta(days=7), min_width=600, min_height=900):
    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "posters.json"
    old = json.loads(manifest.read_text()) if manifest.exists() else {"assets": []}
    previous = {asset["url"]: asset for asset in old["assets"]}
    grouped, missing = sources(reports)
    assets = []
    for url, films in grouped.items():
        prior = previous.get(url, {})
        valid = cached_file(output, prior)
        reusable = valid and timedelta(0) <= now - datetime.fromisoformat(prior["fetched_at"]) < max_age
        asset = {"url": url, "films": films, "status": "error", "reused_from_cache": False}
        if not allowed_url(url):
            asset["error"] = "Unsupported poster URL"
        elif reusable:
            asset.update({k: v for k, v in prior.items() if k not in ("error", "films", "status", "reused_from_cache")})
            asset.update(status="ok", reused_from_cache=True)
        else:
            try:
                body = fetch(url)
                metadata = image_metadata(body)
                filename = save_image(output, body, metadata)
                asset.update(metadata, filename=filename, fetched_at=now.isoformat(), status="ok")
            except Exception as error:
                # No response bodies, headers, cookies or exception URLs in logs.
                if valid:
                    asset.update({k: v for k, v in prior.items() if k not in ("error", "films", "status", "reused_from_cache")})
                    asset["status"] = "stale"
                asset["error"] = "Poster fetch/validation failed: " + type(error).__name__
        asset['meets_target'] = meets_target(asset['width'], asset['height'], (min_width, min_height)) if 'width' in asset else None
        assets.append(asset)
    counts = dict(Counter(asset["status"] for asset in assets))
    result = {"status": "partial" if missing or any(a["status"] != "ok" for a in assets) else "ok",
              "collected_at": now.isoformat(), "target": {"min_width": min_width, "min_height": min_height},
              "counts": counts, "below_target": sum(a["meets_target"] is False for a in assets),
              "missing_posters": missing, "assets": assets}
    atomic_write(manifest, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", required=True, help="Showtime JSON; repeat to combine sources")
    parser.add_argument("--output-dir", type=Path, required=True, help="Image cache and posters.json manifest")
    parser.add_argument("--max-age-days", type=float, default=7, help="Reuse validated cached files for this many days; 0 refreshes all")
    parser.add_argument("--min-width", type=int, default=600)
    parser.add_argument("--min-height", type=int, default=900)
    args = parser.parse_args()
    if not 0 <= args.max_age_days <= 365 or min(args.min_width, args.min_height) < 1:
        parser.error("Cache age must be 0–365 days; minimum dimensions must be positive")
    try:
        from curl_cffi import requests
        import PIL  # Fail clearly before collection when the decoder is absent.
        reports = [json.loads(path.read_text()) for path in args.input]
        with requests.Session(impersonate="chrome") as client:
            def fetch(url):
                response = client.get(url, timeout=20, allow_redirects=False)
                content_type = response.headers.get("content-type", "").lower()
                # Phenomena's original JPEGs omit Content-Type. The decoder
                # below still verifies actual image contents before caching.
                if response.status_code != 200 or (content_type and not content_type.startswith("image/")):
                    raise ValueError("Poster response is not an image")
                return response.content
            report = collect(reports, args.output_dir, fetch, datetime.now(timezone.utc),
                             timedelta(days=args.max_age_days), args.min_width, args.min_height)
    except ImportError:
        print("Install scripts/requirements-posters.txt", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        print("Poster input or cache error; previous manifest preserved", file=sys.stderr)
        return 1
    print(json.dumps({key: report[key] for key in ("status", "counts", "below_target")}
                     | {"missing_posters": len(report["missing_posters"])}))
    return 0  # Individual artwork failures remain explicit in the manifest.


if __name__ == "__main__":
    sys.exit(main())
