#!/usr/bin/env python3
"""Import the complete named vehicle-road network for selected SoCal counties.

Sources are the Census TIGER/Line 2025 county All Roads ZIPs, not viewport
tiles. Build city boundaries first using import_boundaries.py. Dependencies:
    python3 -m venv .venv-data
    .venv-data/bin/pip install shapely pyshp pyproj
    .venv-data/bin/python scripts/import_roads.py

Numbered routes retain their complete regional geometry, including divided
carriageways and discontinuous signed sections. Ordinary roads are grouped
only when the same base name is connected (20 m positional tolerance); a
directional prefix alone does not split one continuous street. Disconnected
same-name streets remain separate searchable results. No geometry is invented
to bridge the tolerance or gaps. The catalog is for viewing, not navigation.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import urllib.request

import shapefile
from pyproj import Transformer
from shapely import STRtree, prepare, union_all, transform as shapely_transform
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point, mapping, shape

if __package__:
    from .add_road_endpoints import ENDPOINT_METHOD, road_endpoints
    from .region_scopes import COUNTIES, add_scope_arguments, resolve_counties
else:
    from add_road_endpoints import ENDPOINT_METHOD, road_endpoints
    from region_scopes import COUNTIES, add_scope_arguments, resolve_counties


ROOT = Path(__file__).resolve().parents[1]
VINTAGE = "2025"
SOURCE_PAGE = "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html"
SOURCE_DOC = "https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc.pdf"
VEHICLE_CLASSES = {"S1100", "S1200", "S1400", "S1500", "S1630", "S1640", "S1730", "S1740"}
CONNECT_DISTANCE_M = 20.0
SIMPLIFY_M = 2.0
ENDPOINT_GEOMETRY_BASIS = "unsimplified Census TIGER/Line source geometry"
STREET_SUFFIXES = {
    "st", "street", "rd", "road", "blvd", "boulevard", "ave", "avenue", "av",
    "dr", "drive", "way", "ln", "lane", "ct", "court", "cir", "circle", "pl", "place",
    "ter", "terrace", "trl", "trail", "pkwy", "parkway", "hwy", "highway", "fwy", "freeway",
    "aly", "alley", "walk", "loop", "row", "run", "path", "pass", "paseo", "via",
    "cres", "crescent", "sq", "square", "pike", "bend", "mall", "rte", "route",
}
# All source coordinates are NAD83 longitude/latitude. Use a regional metric
# CRS for spatial comparisons; export WGS84 GeoJSON for the browser.
TO_METRIC = Transformer.from_crs("EPSG:4269", "EPSG:26911", always_xy=True).transform
TO_WGS84 = Transformer.from_crs("EPSG:26911", "EPSG:4326", always_xy=True).transform
BOUNDARY_TO_METRIC = Transformer.from_crs("EPSG:4326", "EPSG:26911", always_xy=True).transform


def transform(function, geometry):
    return shapely_transform(geometry, function, interleaved=False)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def numbered_route(name):
    """Canonical US route identifiers; do not mistake local Avenue I-4."""
    patterns = (
        (r"I\s*-\s*(\d+)(.*)", "I-"),
        (r"US\s*-\s*(\d+)(.*)", "US-"),
        (r"(?:CA|SR)\s*-\s*(\d+)(.*)", "CA-"),
        (r"US\s+(?:Hwy|Highway|Route)\s+(\d+)(.*)", "US-"),
        (r"State\s+(?:Rte|Route|Hwy|Highway)\s+(\d+)(.*)", "CA-"),
    )
    for pattern, prefix in patterns:
        match = re.fullmatch(pattern, name.strip(), re.IGNORECASE)
        if match:
            suffix = match[2].strip()
            return f"{prefix}{int(match[1])}" + (f" {suffix}" if suffix else "")
    return None


def base_name(name):
    """Retain original aliases but connect directional sections of a street."""
    name = re.sub(r"\s+", " ", name.strip())
    route = numbered_route(name)
    if route:
        return route
    without_direction = re.sub(r"^(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\s+", "", name, flags=re.IGNORECASE)
    # South St and West Blvd are names, not directional prefixes attached to
    # unnamed roads. Likewise, the E in E St is its actual letter name. A
    # prefix may be removed only when a meaningful base name remains.
    if without_direction.casefold().rstrip(".") in STREET_SUFFIXES:
        return name
    # The source also has names such as E State Rte 66. Canonicalize again
    # after removing that prefix so they join the unprefixed CA-66 records.
    return numbered_route(without_direction) or without_direction


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry] if geometry.length > 0 else []
    if geometry.geom_type in {"MultiLineString", "GeometryCollection"}:
        return [part for child in geometry.geoms for part in line_parts(child)]
    return []


def point_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Point":
        return [geometry]
    if geometry.geom_type in {"MultiPoint", "GeometryCollection"}:
        return [part for child in geometry.geoms for part in point_parts(child)]
    # A road can run exactly along a city border. Mark the two ends, not every
    # vertex of a border-overlapping line, and let polygon outlines show it.
    if geometry.geom_type == "LineString":
        return [Point(geometry.coords[0]), Point(geometry.coords[-1])]
    if geometry.geom_type == "MultiLineString":
        return [point for child in geometry.geoms for point in point_parts(child)]
    return []


@dataclass
class RoadRecord:
    linear_id: str
    name: str
    county: str
    mtfcc: str
    route_type: str
    geometry: object


def components(records, distance=CONNECT_DISTANCE_M):
    """Spatially connect records without fusing unrelated same-name roads."""
    if len(records) <= 1:
        return [records] if records else []
    parents = list(range(len(records)))

    def find(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    tree = STRtree([record.geometry for record in records])
    for i, record in enumerate(records):
        for other in tree.query(record.geometry, predicate="dwithin", distance=distance):
            j = int(other)
            if j > i:
                parents[find(j)] = find(i)
    grouped = defaultdict(list)
    for i, record in enumerate(records):
        grouped[find(i)].append(record)
    return list(grouped.values())


def read_county(path, fips):
    records = []
    raw_count = 0
    excluded_unnamed = 0
    excluded_nonvehicle = 0
    with shapefile.Reader(str(path)) as reader:
        for item in reader.iterShapeRecords():
            raw_count += 1
            row = item.record.as_dict()
            if row["MTFCC"] not in VEHICLE_CLASSES:
                excluded_nonvehicle += 1
                continue
            name = row["FULLNAME"].strip()
            if not name:
                excluded_unnamed += 1
                continue
            geometry = transform(TO_METRIC, shape(item.shape.__geo_interface__))
            if not line_parts(geometry):
                continue
            records.append(RoadRecord(row["LINEARID"], name, fips, row["MTFCC"], row["RTTYP"], geometry))
    return records, dict(rawRecords=raw_count, namedVehicleRecords=len(records),
                         excludedUnnamed=excluded_unnamed, excludedNonvehicle=excluded_nonvehicle)


class BoundaryIndex:
    """Intersect full roads with unsimplified polygons, not endpoint samples."""

    def __init__(self, collection):
        self.properties = [feature["properties"] for feature in collection["features"]]
        self.geometries = [transform(BOUNDARY_TO_METRIC, shape(feature["geometry"]))
                           for feature in collection["features"]]
        prepare(self.geometries)
        self.tree = STRtree(self.geometries)

    def match(self, geometry):
        hits = []
        crossings = []
        for index in self.tree.query(geometry, predicate="intersects"):
            index = int(index)
            polygon = self.geometries[index]
            properties = self.properties[index]
            if polygon.contains_properly(geometry):
                hits.append((properties, geometry.length))
                continue
            # Mere tangency at one point is not a traversal through a city.
            length = geometry.intersection(polygon).length
            if length < 0.5:
                continue
            hits.append((properties, length))
            for point in point_parts(geometry.intersection(polygon.boundary)):
                if not any(point.distance(existing[0]) < 30 for existing in crossings):
                    crossings.append([point, {properties["id"]}])
                else:
                    for existing in crossings:
                        if point.distance(existing[0]) < 30:
                            existing[1].add(properties["id"])
                            break
        # Add all adjacent jurisdiction names, including those only touching
        # at the marker, to make a shared boundary useful to the UI.
        output_crossings = []
        for point, identifiers in crossings:
            for index in self.tree.query(point, predicate="dwithin", distance=2):
                identifiers.add(self.properties[int(index)]["id"])
            if len(identifiers) < 2:
                continue
            longitude, latitude = transform(TO_WGS84, point).coords[0]
            output_crossings.append({"coordinates": [round(longitude, 6), round(latitude, 6)],
                                     "cityIds": sorted(identifiers)})
        # Largest traversed length first gives road cards a useful primary
        # location, while retaining every crossed jurisdiction.
        hits.sort(key=lambda item: (-item[1], item[0]["name"], item[0]["id"]))
        return [item[0]["id"] for item in hits], output_crossings


def rounded_coordinates(value):
    if isinstance(value, (list, tuple)):
        return [rounded_coordinates(item) for item in value]
    return round(value, 6)


def road_identifier(name, records):
    keys = sorted({record.county + ":" + record.linear_id for record in records})
    digest = hashlib.sha256((name.lower() + "\n" + "\n".join(keys)).encode()).hexdigest()[:12]
    return "r-" + digest


def road_kind(name, records):
    return "highway" if numbered_route(name) or any(record.mtfcc == "S1100" for record in records) else "street"


def route_aliases(name):
    if name.startswith("I-"):
        return ["Interstate " + name[2:], "I " + name[2:], name[2:]]
    if name.startswith("CA-"):
        return ["State Route " + name[3:], "SR " + name[3:], "CA " + name[3:], name[3:]]
    if name.startswith("US-"):
        return ["US Highway " + name[3:], "US " + name[3:], name[3:]]
    return []


def build_groups(records):
    by_name = defaultdict(list)
    display_names = {}
    for record in records:
        name = base_name(record.name)
        key = name.casefold()
        display_names.setdefault(key, name)
        by_name[key].append(record)
    for key in sorted(by_name):
        name = display_names[key]
        group = by_name[key]
        if numbered_route(name):
            yield name, group
        else:
            for component in components(group):
                yield name, component


def convert(records, boundaries):
    catalog = []
    shards = defaultdict(list)
    for number, (name, group) in enumerate(build_groups(records), 1):
        geometry = union_all([record.geometry for record in group])
        lines = line_parts(geometry)
        if not lines:
            continue
        geometry = MultiLineString(lines)
        city_ids, crossings = boundaries.match(geometry)
        endpoints = road_endpoints(geometry, boundaries, CONNECT_DISTANCE_M)
        identifier = road_identifier(name, group)
        kind = road_kind(name, group)
        simplified = MultiLineString([line.simplify(SIMPLIFY_M) for line in lines])
        exported = mapping(transform(TO_WGS84, simplified))
        exported["coordinates"] = rounded_coordinates(exported["coordinates"])
        west, south, east, north = transform(TO_WGS84, geometry).bounds
        aliases = sorted({record.name for record in group} | set(route_aliases(name)))
        shard = identifier[2:4]
        source_proof = {}
        if numbered_route(name):
            identifiers = sorted({record.county + ":" + record.linear_id for record in group})
            source_proof = {"sourceRecordCount": len(group),
                            "sourceLinearIdSha256": hashlib.sha256("\n".join(identifiers).encode()).hexdigest()}
        properties = {**source_proof, "id": identifier, "roadId": identifier, "name": name, "kind": kind,
                      "cityIds": city_ids, "crossings": crossings,
                      "endpoints": endpoints, "endpointCount": len(endpoints),
                      "endpointGeometryBasis": ENDPOINT_GEOMETRY_BASIS}
        shards[shard].append({"type": "Feature", "id": identifier,
                              "properties": properties, "geometry": exported})
        catalog.append({**source_proof, "id": identifier, "name": name, "aliases": aliases, "kind": kind,
                        "cityIds": city_ids, "counties": sorted({record.county for record in group}),
                        "bounds": [[round(west, 6), round(south, 6)], [round(east, 6), round(north, 6)]],
                        "lengthKm": round(geometry.length / 1000, 2), "segmentCount": len(lines),
                        "endpointCount": len(endpoints),
                        "geometryUrl": f"/data/roads/{shard}.geojson",
                        "geometryCompressedUrl": f"/data/roads/{shard}.geojson.gz"})
        if number % 10000 == 0:
            print(f"  Converted {number:,} road groups", flush=True)
    catalog.sort(key=lambda road: (road["kind"] != "highway", road["name"].casefold(), road["id"]))
    return catalog, shards


def fetch_county(fips, cache, refresh):
    filename = f"tl_{VINTAGE}_{fips}_roads.zip"
    path = cache / filename
    url = f"https://www2.census.gov/geo/tiger/TIGER{VINTAGE}/ROADS/{filename}"
    if refresh or not path.exists():
        print(f"Downloading {url}", flush=True)
        request = urllib.request.Request(url, headers={"User-Agent": "SouthlandMapStudio/0.2 (public GIS import)"})
        with urllib.request.urlopen(request, timeout=120) as response:
            content = response.read()
        temporary = path.with_suffix(".zip.tmp")
        temporary.write_bytes(content)
        temporary.replace(path)
    content = path.read_bytes()
    return path, {"name": f"U.S. Census Bureau TIGER/Line {VINTAGE} — {COUNTIES[fips]} All Roads",
                  "countyFips": fips, "url": url, "sha256": hashlib.sha256(content).hexdigest(),
                  "bytes": len(content), "vintage": VINTAGE,
                  "retrievedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Download the county source files again")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/roads")
    parser.add_argument("--boundaries", type=Path,
                        default=ROOT / "scripts/.cache/boundaries/full-city-boundaries.geojson")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data")
    parser.add_argument("--download-only", action="store_true", help="Cache source ZIPs without replacing public data")
    add_scope_arguments(parser)
    args = parser.parse_args()
    try:
        counties = resolve_counties(args.scope, args.counties)
    except ValueError as error:
        parser.error(str(error))
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    if args.download_only:
        sources = [fetch_county(fips, args.cache_dir, args.refresh)[1] for fips in counties]
        print(json.dumps({"countyFips": list(counties), "sourceBytes": sum(source["bytes"] for source in sources),
                          "sources": sources}, indent=2), flush=True)
        return
    if not args.boundaries.exists():
        parser.error(f"Missing full city polygons: {args.boundaries}; run the boundary importer first")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    collection = json.loads(args.boundaries.read_text())
    boundary_counties = {f["properties"].get("countyFips") for f in collection["features"]}
    if boundary_counties != set(counties):
        parser.error(f"Road/boundary scope mismatch: roads {sorted(counties)}, boundaries {sorted(boundary_counties)}. "
                     "Run import_boundaries.py with the same scope first.")
    boundaries = BoundaryIndex(collection)
    records, sources, source_counts = [], [], {}
    for fips in counties:
        path, metadata = fetch_county(fips, args.cache_dir, args.refresh)
        county_records, counts = read_county(path, fips)
        records.extend(county_records)
        sources.append(metadata)
        source_counts[fips] = counts
        print(f"Loaded {len(county_records):,} named vehicle-road records for {COUNTIES[fips]}", flush=True)
    catalog, shards = convert(records, boundaries)
    cities = [{key: properties[key] for key in ("id", "name", "label", "kind", "county", "countyFips", "bounds")
               if key in properties}
              for properties in boundaries.properties]
    manifest = {
        "generatedAt": now_iso(), "vintage": VINTAGE,
        "scope": args.scope if not args.counties else "custom", "countyFips": list(counties),
        "source": "U.S. Census Bureau TIGER/Line 2025", "sourceUrl": SOURCE_PAGE,
        "documentationUrl": SOURCE_DOC, "sources": sources,
        "boundarySource": collection.get("metadata", {"file": args.boundaries.name}),
        "cities": cities, "roads": catalog,
        "stats": {"roadCount": len(catalog), "highwayCount": sum(road["kind"] == "highway" for road in catalog),
                  "streetCount": sum(road["kind"] == "street" for road in catalog),
                  "sourceCounts": source_counts, "geometryShards": len(shards),
                  "geographicEndpointCount": sum(road["endpointCount"] for road in catalog),
                  "roadsWithoutOpenEndpoints": sum(road["endpointCount"] == 0 for road in catalog),
                  "maximumEndpointsPerRoad": max((road["endpointCount"] for road in catalog), default=0),
                  "endpointsWithoutCityMatch": sum(not endpoint["cityIds"] for features in shards.values()
                                                   for feature in features
                                                   for endpoint in feature["properties"]["endpoints"])},
        "method": {"coverage": "Complete named vehicle roads in " + ", ".join(counties.values()),
                   "cityAssignment": "Positive-length intersection against unsimplified jurisdiction polygons",
                   "streetGrouping": f"Same name without directional prefix, connected within {CONNECT_DISTANCE_M:g} metres",
                   "highwayGrouping": "All source sections of each numbered route within the selected counties",
                   "length": "Total mapped carriageway length; divided road directions count separately",
                   "geometrySimplificationMetres": SIMPLIFY_M,
                   "endpoints": {"definition": ENDPOINT_METHOD,
                                 "connectivityToleranceMetres": CONNECT_DISTANCE_M,
                                 "geometryBasis": ENDPOINT_GEOMETRY_BASIS,
                                 "cityAssignment": "Exact point intersection against unsimplified jurisdiction polygons; unmatched remains unlabeled"},
                   "limitations": ["Static source vintage; not navigation, traffic, or current closure data",
                                   "Named local roads separated by a real gap appear as distinct results",
                                   "A road may have both a numbered-route and a local-name catalog entry",
                                   "Names and classifications follow Census source data",
                                   "Unincorporated areas and Census-designated places are labeled separately"]},
    }
    for shard, features in shards.items():
        shard_path = args.output_dir / "roads" / f"{shard}.geojson"
        write_json(shard_path, {"type": "FeatureCollection", "features": features})
        compressed_shard = shard_path.with_suffix(".geojson.gz")
        compressed_shard.write_bytes(gzip.compress(shard_path.read_bytes(), compresslevel=9, mtime=0))
    index_path = args.output_dir / "roads-index.json"
    write_json(index_path, manifest)
    # The viewer explicitly decompresses this static asset, so production does
    # not depend on a web-server Content-Encoding configuration. The raw JSON
    # remains the fallback for browsers without DecompressionStream.
    compressed = gzip.compress(index_path.read_bytes(), compresslevel=9, mtime=0)
    compressed_path = index_path.with_suffix(".json.gz")
    temporary = compressed_path.with_suffix(".gz.tmp")
    temporary.write_bytes(compressed)
    temporary.replace(compressed_path)
    print(json.dumps(manifest["stats"], indent=2), flush=True)


if __name__ == "__main__":
    main()
