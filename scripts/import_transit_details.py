#!/usr/bin/env python3
"""Derive route lengths and scheduled terminal pairs from cached official GTFS.

Standard library only. Does not infer endpoints from display-geometry bounds,
or sum alternative shapes into a fictional one-way route length.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
import math
from pathlib import Path
import tempfile
import zipfile

from import_gtfs import FEEDS, METROLINK_SHAPES, ROOT, coordinates, rows, utc_now


def line_length_km(points):
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
        a, b = math.radians(lat1), math.radians(lat2)
        delta_lat, delta_lon = b - a, math.radians(lon2 - lon1)
        hav = math.sin(delta_lat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(delta_lon / 2) ** 2
        total += 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(hav)))
    return total


def convert_details(feed, content, included_ids, fetched_at):
    prefix = feed["id"] + ":"
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        trips = {row["trip_id"]: row for row in rows(archive, "trips.txt")
                 if prefix + row["route_id"] in included_ids}
        stops = {row["stop_id"]: row for row in rows(archive, "stops.txt")}
        route_shapes = defaultdict(set)
        for trip in trips.values():
            if trip.get("shape_id"):
                route_shapes[trip["route_id"]].add(trip["shape_id"])
        explicit_mapping = feed["id"] == "metrolink" and not route_shapes
        if explicit_mapping:
            for route_id in {trip["route_id"] for trip in trips.values()}:
                route_shapes[route_id].update(METROLINK_SHAPES[route_id])
        wanted = set().union(*route_shapes.values()) if route_shapes else set()
        shapes = defaultdict(list)
        for row in rows(archive, "shapes.txt"):
            if row["shape_id"] in wanted:
                shapes[row["shape_id"]].append((int(row["shape_pt_sequence"]),
                                               coordinates(row, "shape_pt_lat", "shape_pt_lon")))
        ordered_shapes = {sid: [point for _, point in sorted(points)] for sid, points in shapes.items()}
        extremes = {}
        for row in rows(archive, "stop_times.txt"):
            trip_id = row["trip_id"]
            if trip_id not in trips:
                continue
            stop_id = row["stop_id"]
            if stop_id not in stops:
                raise ValueError(f"Missing terminal stop {stop_id}")
            sequence = int(row["stop_sequence"])
            if trip_id not in extremes:
                extremes[trip_id] = [sequence, stop_id, sequence, stop_id, 1]
            else:
                value = extremes[trip_id]
                if sequence < value[0]:
                    value[0], value[1] = sequence, stop_id
                if sequence > value[2]:
                    value[2], value[3] = sequence, stop_id
                value[4] += 1

        def station(stop_id):
            parent = stops[stop_id].get("parent_station")
            return parent if parent in stops else stop_id

        def endpoint(stop_id):
            row = stops[stop_id]
            return {"id": prefix + stop_id, "name": row.get("stop_name") or stop_id,
                    "coordinates": list(coordinates(row, "stop_lat", "stop_lon"))}

        pairs = defaultdict(Counter)
        for trip_id, (_, first, _, last, count) in extremes.items():
            if count < 2:
                continue
            pairs[trips[trip_id]["route_id"]][(station(first), station(last))] += 1

        result = {}
        for route_id in sorted({trip["route_id"] for trip in trips.values()}):
            seen, lengths = set(), []
            for shape_id in route_shapes[route_id]:
                points = ordered_shapes.get(shape_id, [])
                if len(set(points)) < 2:
                    continue
                key = min(tuple(points), tuple(reversed(points)))
                if key in seen:
                    continue
                seen.add(key)
                lengths.append(line_length_km(points))
            if not lengths or not pairs[route_id]:
                raise ValueError(f"No usable route geometry/endpoints: {prefix}{route_id}")
            fid = prefix + route_id
            result[fid] = {
                "id": fid,
                "patternCount": len(lengths),
                "lengthKm": {"min": round(min(lengths), 3), "max": round(max(lengths), 3)},
                "endpoints": [{"from": endpoint(first), "to": endpoint(last), "tripCount": count}
                              for (first, last), count in sorted(pairs[route_id].items(), key=lambda x: (-x[1], x[0]))],
                "source": feed["name"] + " official GTFS" + (f" · archive {feed['archiveDate']}" if feed.get("archiveDate") else ""),
                "sourceUrl": feed.get("archiveSourceUrl", feed["sourceUrl"]),
                "fetchedAt": fetched_at,
                "lengthMethod": ("Unique mapped GTFS shapes; explicit official named-shape mapping because Metrolink trips omit shape_id"
                                 if explicit_mapping else "Unique GTFS shapes linked by trips.shape_id; geodesic approximation"),
            }
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/gtfs")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/transit-details.json")
    parser.add_argument("--manifest", type=Path, default=ROOT / "public/data/transit-manifest.json")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    included = {route["id"] for route in manifest["routes"]}
    agencies = {agency["id"]: agency for agency in manifest["agencies"]}
    result = {}
    for feed in FEEDS:
        content = (args.cache_dir / (feed["id"] + ".zip")).read_bytes()
        agency = agencies[feed["id"]]
        if hashlib.sha256(content).hexdigest() != agency["sha256"]:
            raise ValueError(f"{feed['id']} cache differs from displayed transit snapshot; refresh transit layers first")
        result.update(convert_details(feed, content, included, agency["fetchedAt"]))
    if set(result) != included:
        raise ValueError("Details must cover every displayed route exactly once")
    output = {"generatedAt": utc_now(), "routes": result,
              "sourceFeeds": {aid: {key: agency[key] for key in ("sha256", "fetchedAt", "downloadUrl", "archiveDate") if key in agency}
                              for aid, agency in agencies.items()},
              "method": "Endpoints from first/last stop_sequence of scheduled trips, platforms grouped to parent station. Length range covers linked mapped shapes, not a sum of alternatives. Trip counts are feed records, not daily departures."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=args.output.parent, encoding="utf-8", delete=False) as staging:
        staging.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
        staging_path = Path(staging.name)
    staging_path.replace(args.output)
    print(json.dumps({"routes": len(result), "endpointPairs": sum(len(r["endpoints"]) for r in result.values()),
                      "bytes": args.output.stat().st_size, "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
