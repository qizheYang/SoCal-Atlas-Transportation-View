#!/usr/bin/env python3
"""Build the viewer's static transit layers from official, public GTFS feeds.

Python standard library only. Run from any directory:
    python3 scripts/import_gtfs.py
    python3 -m unittest discover -s scripts -p 'test_*.py'

This is scheduled network geometry, not real-time service or trip planning.
All distinct shapes attached to trips in each feed are retained. Coordinates
are simplified within 8 metres, rounded to six decimals, and duplicate shape
geometries are removed. No route is invented from stop-to-stop straight lines.
Metrolink's feed omits optional trip.shape_id; see its explicit mapping below.
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import tempfile
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[1]
FEEDS = [
    dict(id="metro-rail", name="LA Metro Rail", url="https://www.metro.net/",
         feedUrl="https://gitlab.com/LACMTA/gtfs_rail/-/raw/master/gtfs_rail.zip",
         sourceUrl="https://developer.metro.net/gtfs-schedule-data/", color="#0072BC"),
    dict(id="metro-bus", name="LA Metro Bus", url="https://www.metro.net/",
         feedUrl="https://gitlab.com/LACMTA/gtfs_bus/-/raw/weekly-updated-service/gtfs_bus.zip",
         sourceUrl="https://developer.metro.net/gtfs-schedule-data/", color="#D66B27"),
    dict(id="octa", name="OC Bus · OCTA", url="https://www.octa.net/",
         feedUrl="https://www.octa.net/current/google_transit.zip",
         sourceUrl="https://www.octa.net/about/about-octa/open-data", color="#00AFF2"),
    dict(id="metrolink", name="Metrolink", url="https://metrolinktrains.com/",
         feedUrl="https://metrolinktrains.com/globalassets/about/gtfs/gtfs.zip",
         sourceUrl="https://metrolinktrains.com/about/gtfs/", color="#009DA5"),
    dict(id="mts", name="San Diego MTS", url="https://www.sdmts.com/",
         feedUrl="https://www.sdmts.com/google_transit_files/google_transit.zip",
         sourceUrl="https://www.sdmts.com/business-center/app-developers", color="#D71920"),
    dict(id="rta", name="Riverside Transit Agency", url="https://www.riversidetransit.com/",
         feedUrl="https://www.riversidetransit.com/google_transit.zip",
         downloadUrl="https://files.mobilitydatabase.org/mdb-98/mdb-98-202609140150/mdb-98-202609140150.zip",
         archiveDate="2026-09-14", sourceUrl="https://www.riversidetransit.com/",
         archiveSourceUrl="https://mobilitydatabase.org/feeds/gtfs/mdb-98",
         retrievalNote="Pinned unmodified official GTFS archived by MobilityData on 2026-09-14. Agency endpoint returned HTTP 403 on 2026-10-12; this is not a newly refreshed agency feed.",
         color="#005A9C"),
    dict(id="omnitrans", name="Omnitrans", url="https://omnitrans.org/",
         feedUrl="https://www.omnitrans.org/google/google_transit.zip",
         sourceUrl="https://omnitrans.org/", color="#00549E"),
    dict(id="sunline", name="SunLine Transit", url="https://www.sunline.org/",
         feedUrl="https://sunlinebus.com/gtfs",
         sourceUrl="https://www.sunline.org/rider-resources/download-apps", color="#E59126"),
    dict(id="ivt", name="Imperial Valley Transit", url="https://www.ivtransit.com/",
         feedUrl="https://schedule.ivtransit.com/gtfs/data.zip",
         sourceUrl="https://www.ivtransit.com/gtfs", color="#1976A3"),
    dict(id="kern-transit", name="Kern Transit", url="https://kerntransit.org/",
         feedUrl="https://data.trilliumtransit.com/gtfs/kerncounty-ca-us/kerncounty-ca-us.zip",
         sourceUrl="https://kerntransit.org/developers-gtfs/", color="#006A75"),
    dict(id="get", name="Golden Empire Transit", url="https://www.getbus.org/",
         feedUrl="http://eta.getbus.org/rtt/public/utility/gtfs.aspx",
         sourceUrl="https://www.getbus.org/", color="#AF7D17",
         retrievalNote="Official endpoint publishes HTTP; its HTTPS hostname certificate does not match. No TLS certificate checks were disabled."),
    dict(id="sbmtd", name="Santa Barbara MTD", url="https://sbmtd.gov/",
         feedUrl="https://www.sbmtd.gov/google_transit/feed.zip",
         sourceUrl="https://sbmtd.gov/gtfs/", color="#2A6EBB"),
    dict(id="slorta", name="SLO Regional Transit", url="https://www.slorta.org/",
         feedUrl="https://slo.connexionz.net/rtt/public/resource/gtfs.zip",
         sourceUrl="https://www.slorta.org/ride-guide/faq/", color="#337C5A"),
    dict(id="slo-transit", name="SLO Transit", url="https://www.slocity.org/",
         feedUrl="https://slocity.connexionz.net/rtt/public/resource/gtfs.zip",
         sourceUrl="https://www.slocity.org/government/department-directory/public-works/slo-transit/general-service-information/short-range-transit-plan", color="#853E8C"),
    dict(id="ventura-county", name="Ventura County Transit · 9 operators", url="https://www.goventura.org/",
         feedUrl="https://govcbus.com/gtfs",
         sourceUrl="https://gtfs-directory.syncromatics.com/", color="#DB7F26",
         retrievalNote="Official countywide combined feed: VCTC, Gold Coast, Thousand Oaks, Kanan, Moorpark, Ojai, Valley Express, Simi Valley and Camarillo. Original operator IDs/names retained."),
]

COVERAGE_GAPS = [
    dict(id="nctd", name="North County Transit District", checkedAt="2026-10-12",
         feedUrl="https://lfportal.nctd.org/staticGTFS/google_transit.zip",
         reason="Official public endpoint resets connections; no current downloadable official snapshot verified. COASTER, SPRINTER and BREEZE are not included.",
         evidenceUrl="https://mobilitydatabase.org/feeds/gtfs/mdb-3093"),
    dict(id="other-operators", name="Additional municipal, rural and intercity operators",
         reason="Not an exhaustive Southern California operator inventory. Other LA municipal buses, Amtrak, airport shuttles and some rural operators are not included."),
]

# Verified against the official Metrolink ZIP on 2026-10-12. Its trips.txt has
# no shape_id column, but shapes.txt supplies these line-named direction pairs.
# Keep this adaptation local to the provider, and fail if a future feed changes
# names instead of silently deriving a route from its stop positions.
METROLINK_SHAPES = {
    "91 Line": ("91in", "91out"),
    "Antelope Valley Line": ("AVin", "AVout"),
    "Inland Emp.-Orange Co. Line": ("IEOCin", "IEOCout"),
    "Orange County Line": ("OCin", "OCout"),
    "Riverside Line": ("RIVERin", "RIVERout"),
    "San Bernardino Line": ("SBin", "SBout"),
    "Ventura County Line": ("VTin", "VTout"),
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def coordinates(row, lat_key, lon_key):
    lat, lon = float(row[lat_key]), float(row[lon_key])
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"Invalid coordinates: {lon}, {lat}")
    return (round(lon, 6), round(lat, 6))


def simplify(points, tolerance_m=8.0):
    """Iterative Douglas-Peucker with a local metric projection; preserve ends."""
    unique = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
    if len(unique) <= 2:
        return unique
    lon_scale = 111320 * math.cos(math.radians(sum(p[1] for p in unique) / len(unique)))
    metric = [(p[0] * lon_scale, p[1] * 111320) for p in unique]
    keep, stack = {0, len(unique) - 1}, [(0, len(unique) - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = metric[start]
        dx, dy = metric[end][0] - ax, metric[end][1] - ay
        length2 = dx * dx + dy * dy
        max_distance2, farthest = tolerance_m * tolerance_m, None
        for i in range(start + 1, end):
            px, py = metric[i][0] - ax, metric[i][1] - ay
            t = max(0, min(1, (px * dx + py * dy) / length2)) if length2 else 0
            distance2 = (px - t * dx) ** 2 + (py - t * dy) ** 2
            if distance2 > max_distance2:
                max_distance2, farthest = distance2, i
        if farthest is not None:
            keep.add(farthest)
            stack.extend(((start, farthest), (farthest, end)))
    return [unique[i] for i in sorted(keep)]


def rows(archive, basename, required=True):
    name = next((name for name in archive.namelist() if name.split("/")[-1] == basename), None)
    if name is None:
        if required:
            raise ValueError(f"Missing required GTFS table {basename}")
        return
    with archive.open(name) as binary:
        yield from csv.DictReader(io.TextIOWrapper(binary, encoding="utf-8-sig", newline=""))


def bounds_for(lines):
    flat = [p for line in lines for p in line]
    return [[min(p[0] for p in flat), min(p[1] for p in flat)],
            [max(p[0] for p in flat), max(p[1] for p in flat)]]


def feature(fid, properties, geometry):
    return dict(type="Feature", id=fid, properties=dict(id=fid, **properties), geometry=geometry)


def convert_feed(feed, content, fetched_at):
    """Convert an in-memory ZIP; caller controls download/cache strategy."""
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        operator_rows = list(rows(archive, "agency.txt", required=False))
        operators = {row.get("agency_id", ""): row for row in operator_rows}
        route_rows = {row["route_id"]: row for row in rows(archive, "routes.txt")}
        stop_rows = {row["stop_id"]: row for row in rows(archive, "stops.txt")}
        trips, route_shapes = {}, defaultdict(set)
        for row in rows(archive, "trips.txt"):
            rid = row["route_id"]
            if rid not in route_rows:
                raise ValueError(f"Trip references missing route {rid}")
            trips[row["trip_id"]] = rid
            if row.get("shape_id"):
                route_shapes[rid].add(row["shape_id"])
        explicit_mapping_used = False
        if feed["id"] == "metrolink" and not any(route_shapes.values()):
            for rid in set(trips.values()):
                if rid not in METROLINK_SHAPES:
                    raise ValueError(f"Unrecognized Metrolink route needs verified shape mapping: {rid}")
                route_shapes[rid].update(METROLINK_SHAPES[rid])
            explicit_mapping_used = True

        shape_points = defaultdict(list)
        wanted_shapes = set().union(*route_shapes.values()) if route_shapes else set()
        for row in rows(archive, "shapes.txt"):
            if row["shape_id"] in wanted_shapes:
                shape_points[row["shape_id"]].append((int(row["shape_pt_sequence"]), coordinates(row, "shape_pt_lat", "shape_pt_lon")))
        shapes = {sid: simplify([p for _, p in sorted(points)]) for sid, points in shape_points.items()}

        # Stream the largest CSV and collapse platforms to their parent station.
        stop_routes = defaultdict(set)
        for row in rows(archive, "stop_times.txt"):
            sid, rid = row["stop_id"], trips.get(row["trip_id"])
            if sid not in stop_rows or rid is None:
                raise ValueError("stop_times references a missing stop or trip")
            parent = stop_rows[sid].get("parent_station", "")
            display_stop = parent if parent in stop_rows else sid
            stop_routes[display_stop].add(rid)

        prefix = feed["id"] + ":"
        route_features, manifest_routes, missing_shapes, skipped_routes = [], [], [], []
        included_routes = set()
        for rid, row in sorted(route_rows.items()):
            lines, seen = [], set()
            for sid in sorted(route_shapes[rid]):
                line = shapes.get(sid, [])
                if len(line) < 2:
                    missing_shapes.append(sid)
                    continue
                # Exact duplicates, including the reverse direction, add no visual information.
                key = min(tuple(line), tuple(reversed(line)))
                if key not in seen:
                    seen.add(key)
                    lines.append(line)
            if not lines:
                skipped_routes.append(dict(id=prefix + rid, shortName=row.get("route_short_name", ""),
                                           longName=row.get("route_long_name", ""), reason="No usable official shape geometry"))
                continue
            included_routes.add(rid)
            fid = prefix + rid
            long_name = row.get("route_long_name") or row.get("route_desc") or rid
            short_name = row.get("route_short_name", "").strip()
            if not short_name and feed["id"] == "metro-rail":
                match = re.search(r"Metro ([A-Z]) Line", long_name)
                short_name = match.group(1) if match else ""
            short_name = short_name or rid
            raw_color = row.get("route_color", "").strip().lstrip("#")
            official_color = bool(re.fullmatch("[0-9a-fA-F]{6}", raw_color))
            color = "#" + raw_color.upper() if official_color else feed["color"]
            name = long_name if short_name in long_name else f"{short_name} · {long_name}"
            operator = operators.get(row.get("agency_id", ""), operator_rows[0] if len(operator_rows) == 1 else {})
            props = dict(agencyId=feed["id"], shortName=short_name, longName=long_name,
                         name=name, color=color, type=int(row["route_type"]),
                         description=row.get("route_desc", ""), source=feed["name"],
                         feedUrl=feed["feedUrl"], routeUrl=row.get("route_url", ""),
                         shapeCount=len(lines), colorSource="agency" if official_color else "viewer fallback",
                         operatorId=row.get("agency_id", ""), operatorName=operator.get("agency_name", feed["name"]))
            route_features.append(feature(fid, props, dict(type="MultiLineString", coordinates=lines)))
            manifest_routes.append(dict(id=fid, agencyId=feed["id"], shortName=short_name,
                                        longName=long_name, color=color, type=int(row["route_type"]), bounds=bounds_for(lines),
                                        operatorName=props["operatorName"]))

        if not route_features:
            raise ValueError(f"{feed['id']}: no usable official route geometry")
        stop_features = []
        for sid, rids in sorted(stop_routes.items()):
            route_ids = [prefix + rid for rid in sorted(rids & included_routes)]
            if not route_ids:
                continue
            row = stop_rows[sid]
            stop_features.append(feature(prefix + sid, dict(name=row.get("stop_name") or sid,
                agencyId=feed["id"], routeIds=route_ids, source=feed["name"], feedUrl=feed["feedUrl"]),
                dict(type="Point", coordinates=coordinates(row, "stop_lat", "stop_lon"))))

        calendars = list(rows(archive, "calendar.txt", required=False))
        exceptions = [row["date"] for row in rows(archive, "calendar_dates.txt", required=False)]
        start_dates = [row["start_date"] for row in calendars]
        end_dates = [row["end_date"] for row in calendars]
        info = list(rows(archive, "feed_info.txt", required=False))
        metadata = dict(id=feed["id"], name=feed["name"], url=feed["url"], feedUrl=feed["feedUrl"],
            fetchedAt=fetched_at, routeCount=len(route_features), stopCount=len(stop_features), status="ready",
            sourceUrl=feed["sourceUrl"], termsUrl=feed["sourceUrl"],
            licenseNote="Public agency GTFS, subject to agency terms; not a blanket open-source license.",
            sha256=hashlib.sha256(content).hexdigest(), downloadBytes=len(content),
            feedInfo=info, calendarStart=min(start_dates, default=None), calendarEnd=max(end_dates, default=None),
            exceptionStart=min(exceptions, default=None), exceptionEnd=max(exceptions, default=None),
            sourceRouteCount=len(route_rows), sourceStopCount=len(stop_rows), shapeCount=sum(len(f["geometry"]["coordinates"]) for f in route_features),
            skippedRoutes=skipped_routes, skippedShapeIds=sorted(set(missing_shapes)))
        metadata["operators"] = operator_rows
        metadata["downloadUrl"] = feed.get("downloadUrl", feed["feedUrl"])
        for key in ("archiveDate", "archiveSourceUrl", "retrievalNote"):
            if key in feed:
                metadata[key] = feed[key]
        metadata["shapeAssociation"] = ("Explicit provider route-to-named-shape mapping; official trips omit shape_id"
                                        if explicit_mapping_used else "GTFS trips.shape_id")
        if explicit_mapping_used and missing_shapes:
            raise ValueError("Metrolink named shape mapping no longer matches official feed")
        return route_features, stop_features, manifest_routes, metadata


def download(url):
    # These public services reject the default urllib agent. No credentials used.
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SoCalMapViewer/1.0; public GTFS importer)"})
    with urllib.request.urlopen(request, timeout=90) as response:
        content = response.read(40_000_001)
    if len(content) > 40_000_000:
        raise ValueError("Feed exceeds the 40 MB download safety cap")
    return content


def validate(routes, stops):
    route_ids = {f["properties"]["id"] for f in routes}
    stop_ids = {f["properties"]["id"] for f in stops}
    if len(route_ids) != len(routes) or len(stop_ids) != len(stops):
        raise ValueError("Duplicate namespaced IDs")
    for stop in stops:
        if not stop["properties"]["routeIds"] or not set(stop["properties"]["routeIds"]) <= route_ids:
            raise ValueError("Invalid stop-to-route references")
    for route in routes:
        if not re.fullmatch(r"#[0-9A-F]{6}", route["properties"]["color"]):
            raise ValueError("Invalid route color")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "data")
    parser.add_argument("--cache-dir", type=Path, help="Optional ZIP cache; delete cached ZIPs to force a fresh download")
    args = parser.parse_args()
    routes, stops, agency_metadata, route_index = [], [], [], []
    for feed in FEEDS:
        # Even a fresh import persists exactly the bytes used, so the following
        # transit-details stage can verify its hashes against this snapshot.
        cache_path = (args.cache_dir or ROOT / ".cache/gtfs") / (feed["id"] + ".zip")
        if args.cache_dir and cache_path.exists():
            content = cache_path.read_bytes()
            fetched_at = datetime.fromtimestamp(cache_path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        else:
            content = download(feed.get("downloadUrl", feed["feedUrl"]))
            fetched_at = utc_now()
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(content)
        r, s, index, metadata = convert_feed(feed, content, fetched_at)
        routes.extend(r)
        stops.extend(s)
        route_index.extend(index)
        agency_metadata.append(metadata)
        print(f"{feed['id']}: {len(r)} routes, {len(s)} stops, {len(content):,} source bytes", flush=True)
    validate(routes, stops)
    manifest = dict(generatedAt=utc_now(), agencies=agency_metadata, routes=route_index,
        description="Official static GTFS network geometry. All feed patterns; not a current service guarantee or live vehicle data.",
        simplificationMetres=8, coordinateDecimals=6, stopsPolicy="Served stops only; platforms merged into parent stations.",
        extentPolicy="Full agency feeds retained throughout Southern California, including routes crossing county boundaries.",
        coverageNote="Selected official transit feeds across Southern California; not every operator or current-day service. NCTD is unavailable; RTA uses an explicitly dated official-feed archive. See coverageGaps and agency retrievalNote.",
        coverageGaps=COVERAGE_GAPS)
    payloads = {
        "transit-routes.geojson": dict(type="FeatureCollection", features=routes),
        "transit-stops.geojson": dict(type="FeatureCollection", features=stops),
        "transit-manifest.json": manifest,
    }
    encoded = {name: json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n" for name, data in payloads.items()}
    size = sum(len(s.encode("utf-8")) for s in encoded.values())
    if size > 15_000_000:
        raise ValueError(f"Snapshot is too large: {size:,} bytes")
    args.output.mkdir(parents=True, exist_ok=True)
    # Stage everything only after all feeds and cross-references validate.
    with tempfile.TemporaryDirectory(dir=args.output) as staging:
        for name, content in encoded.items():
            Path(staging, name).write_text(content, encoding="utf-8")
        for name in encoded:
            Path(staging, name).replace(args.output / name)
    print(f"Wrote {len(routes)} routes and {len(stops)} stops; {size:,} bytes total.")


if __name__ == "__main__":
    main()
