#!/usr/bin/env python3
"""Add all geographic open endpoints to existing road geometry shards.

Endpoint positions describe the supplied regional road geometry, not driving
direction or the road's national termini. Exact line intersections are noded;
degree-one vertices are candidates. Apparent source gaps up to 20 m are treated
as continuations only when an endpoint points toward the neighboring geometry.
Two nearby endpoints must face one another. This preserves side-by-side divided
carriageway terminals and short branches instead of collapsing every close pair.
The geometry itself is never snapped, extended, merged across gaps, or changed.

The normal importer calls road_endpoints on full source geometry before its 2 m
display simplification. This repair command uses the existing display geometry.
Both paths locate cities using unsimplified boundary polygons, with no nearest-
city guesses. Run with .venv-data/bin/python scripts/add_road_endpoints.py.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
import gzip
import json
import math
from pathlib import Path

from pyproj import Transformer
from shapely import STRtree, transform, union_all
from shapely.geometry import Point, shape


ROOT = Path(__file__).resolve().parents[1]
CONNECT_DISTANCE_M = 20.0
TO_METRIC = Transformer.from_crs("EPSG:4326", "EPSG:26911", always_xy=True).transform
TO_WGS84 = Transformer.from_crs("EPSG:26911", "EPSG:4326", always_xy=True).transform
ENDPOINT_METHOD = (
    "All degree-one vertices of exactly noded road linework within the selected regional counties; "
    "apparent source gaps up to 20 m are suppressed only for forward-facing continuations; "
    "nearby parallel carriageway ends and actual branches remain separate. "
    "Geographic positions, not travel direction or national road termini. "
    "Closed source networks have no open endpoints. Geometry is not changed."
)


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry] if geometry.length > 0 else []
    if geometry.geom_type in {"MultiLineString", "GeometryCollection"}:
        return [part for child in geometry.geoms for part in line_parts(child)]
    return []


def node_key(coordinates):
    # Sub-micrometre numerical noise is irrelevant in this metric source CRS.
    return tuple(round(float(value), 6) for value in coordinates[:2])


@dataclass
class Terminal:
    point: object
    line_index: int
    inward: tuple[float, float]


def inward_direction(line, at_start):
    endpoint = Point(line.coords[0] if at_start else line.coords[-1])
    distance = min(10.0, line.length)
    interior = line.interpolate(distance if at_start else line.length - distance)
    dx, dy = interior.x - endpoint.x, interior.y - endpoint.y
    norm = math.hypot(dx, dy)
    if norm <= 1e-9:
        # An unusually tight loop can interpolate onto the same location.
        coords = list(line.coords) if at_start else list(reversed(line.coords))
        for x, y, *_ in coords[1:]:
            dx, dy = x - endpoint.x, y - endpoint.y
            norm = math.hypot(dx, dy)
            if norm > 1e-9:
                break
    return (dx / norm, dy / norm) if norm > 1e-9 else (0.0, 0.0)


def points_toward(terminal, target, cosine=0.5):
    """The gap lies within 60 degrees of the endpoint's outward tangent."""
    dx, dy = target.x - terminal.point.x, target.y - terminal.point.y
    distance = math.hypot(dx, dy)
    if distance <= 1e-6:
        return True
    return -(dx * terminal.inward[0] + dy * terminal.inward[1]) / distance >= cosine


def terminal_points(metric_geometry, connect_distance=CONNECT_DISTANCE_M):
    """Return source-position Points in a metric CRS, without editing geometry."""
    if connect_distance < 0:
        raise ValueError("Connection distance must be non-negative")
    lines = line_parts(union_all(line_parts(metric_geometry)))
    if not lines:
        return []
    incidence = defaultdict(list)
    for index, line in enumerate(lines):
        incidence[node_key(line.coords[0])].append((index, True))
        incidence[node_key(line.coords[-1])].append((index, False))
    candidates = []
    for entries in incidence.values():
        if len(entries) != 1:
            continue
        index, at_start = entries[0]
        line = lines[index]
        candidates.append(Terminal(Point(line.coords[0] if at_start else line.coords[-1]),
                                   index, inward_direction(line, at_start)))
    if connect_distance == 0 or len(candidates) == 0:
        return sorted((item.point for item in candidates), key=lambda point: (point.x, point.y))

    suppressed = set()
    terminal_tree = STRtree([item.point for item in candidates])
    for index, candidate in enumerate(candidates):
        for other in terminal_tree.query(candidate.point, predicate="dwithin", distance=connect_distance):
            other = int(other)
            if other <= index:
                continue
            peer = candidates[other]
            if points_toward(candidate, peer.point) and points_toward(peer, candidate.point):
                suppressed.update((index, other))

    line_tree = STRtree(lines)
    for index, candidate in enumerate(candidates):
        if index in suppressed:
            continue
        for other in line_tree.query(candidate.point, predicate="dwithin", distance=connect_distance):
            other = int(other)
            if other == candidate.line_index:
                continue
            target_line = lines[other]
            location = target_line.project(candidate.point)
            target = target_line.interpolate(location)
            if not points_toward(candidate, target):
                continue
            # A target at another open terminal requires both tangent tests
            # above. At an existing junction or line interior, this endpoint
            # is an apparent short source gap before the connection.
            at_endpoint = location <= 1e-6 or target_line.length - location <= 1e-6
            if at_endpoint:
                degree = len(incidence[node_key(target.coords[0])])
                if degree < 2:
                    continue
            suppressed.add(index)
            break
    return sorted((item.point for index, item in enumerate(candidates) if index not in suppressed),
                  key=lambda point: (point.x, point.y))


class EndpointBoundaryIndex:
    """Same metric/index contract as import_roads.BoundaryIndex, without a cycle."""

    def __init__(self, collection):
        self.properties = [feature["properties"] for feature in collection["features"]]
        self.geometries = [transform(shape(feature["geometry"]), TO_METRIC, interleaved=False)
                           for feature in collection["features"]]
        self.tree = STRtree(self.geometries)


def road_endpoints(metric_geometry, boundary_index, connect_distance=CONNECT_DISTANCE_M):
    """Return every open endpoint as WGS84 coordinates and exact city membership."""
    output = []
    for point in terminal_points(metric_geometry, connect_distance):
        city_ids = sorted({boundary_index.properties[int(index)]["id"]
                           for index in boundary_index.tree.query(point, predicate="intersects")})
        longitude, latitude = TO_WGS84(point.x, point.y)
        output.append({"coordinates": [round(longitude, 6), round(latitude, 6)], "cityIds": city_ids})
    return output


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(path)


def enrich(output_dir, boundaries_path, connect_distance=CONNECT_DISTANCE_M):
    """Repair existing shards; source geometry and all existing attributes survive."""
    output_dir, boundaries_path = Path(output_dir), Path(boundaries_path)
    boundaries = EndpointBoundaryIndex(json.loads(boundaries_path.read_text()))
    stats = {"roadsEnriched": 0, "geographicEndpointCount": 0, "roadsWithoutOpenEndpoints": 0,
             "endpointsWithoutCityMatch": 0, "maximumEndpointsPerRoad": 0}
    counts = {}
    shards = sorted((output_dir / "roads").glob("*.geojson"))
    if not shards:
        raise ValueError(f"No road geometry shards found in {output_dir / 'roads'}")
    for shard_number, path in enumerate(shards, 1):
        collection = json.loads(path.read_text())
        for feature in collection["features"]:
            metric = transform(shape(feature["geometry"]), TO_METRIC, interleaved=False)
            endpoints = road_endpoints(metric, boundaries, connect_distance)
            properties = feature.setdefault("properties", {})
            properties["endpoints"] = endpoints
            properties["endpointCount"] = len(endpoints)
            properties["endpointGeometryBasis"] = "exported Census geometry (2 m simplification)"
            identifier = properties.get("roadId", properties.get("id", feature.get("id")))
            if identifier:
                counts[identifier] = len(endpoints)
            stats["roadsEnriched"] += 1
            stats["geographicEndpointCount"] += len(endpoints)
            stats["roadsWithoutOpenEndpoints"] += not endpoints
            stats["endpointsWithoutCityMatch"] += sum(not point["cityIds"] for point in endpoints)
            stats["maximumEndpointsPerRoad"] = max(stats["maximumEndpointsPerRoad"], len(endpoints))
        write_json(path, collection)
        if shard_number % 32 == 0:
            print(f"Enriched {shard_number}/{len(shards)} shards · {stats['roadsEnriched']:,} roads", flush=True)
    index_path = output_dir / "roads-index.json"
    if index_path.exists():
        index = json.loads(index_path.read_text())
        for road in index.get("roads", []):
            if road["id"] in counts:
                road["endpointCount"] = counts[road["id"]]
        index.setdefault("method", {})["endpoints"] = {
            "definition": ENDPOINT_METHOD,
            "connectivityToleranceMetres": connect_distance,
            "geometryBasis": "Existing regional display geometry (2 m simplification); source endpoint positions retained",
            "cityAssignment": "Exact point intersection against unsimplified jurisdiction polygons; unmatched remains unlabeled",
        }
        index.setdefault("stats", {}).update(stats)
        write_json(index_path, index)
        compressed = index_path.with_suffix(".json.gz")
        temporary = compressed.with_suffix(".gz.tmp")
        temporary.write_bytes(gzip.compress(index_path.read_bytes(), compresslevel=9, mtime=0))
        temporary.replace(compressed)
    return stats


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data")
    parser.add_argument("--boundaries", type=Path,
                        default=ROOT / "scripts/.cache/boundaries/full-city-boundaries.geojson")
    parser.add_argument("--connect-distance", type=float, default=CONNECT_DISTANCE_M)
    args = parser.parse_args()
    if not args.boundaries.exists():
        parser.error(f"Missing unsimplified boundary polygons: {args.boundaries}")
    print(json.dumps(enrich(args.output_dir, args.boundaries, args.connect_distance), indent=2), flush=True)


if __name__ == "__main__":
    main()
