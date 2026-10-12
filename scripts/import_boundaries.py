#!/usr/bin/env python3
"""Fetch official Census city/CDP polygons and derive county residual areas.

Run with .venv-data/bin/python scripts/import_boundaries.py. Requires shapely
and pyproj. The full-resolution cache is for spatial joins; public output is
simplified only for display. No nearest-city assignment is used.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

from pyproj import Transformer
from shapely import make_valid, transform
from shapely.geometry import GeometryCollection, MultiPolygon, mapping, shape
from shapely.ops import unary_union

if __package__:
    from .region_scopes import COUNTIES, add_scope_arguments, cache_key, resolve_counties
else:
    from region_scopes import COUNTIES, add_scope_arguments, cache_key, resolve_counties

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "scripts" / ".cache" / "boundaries"
SERVICE = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"
SOURCE = "U.S. Census Bureau TIGERweb"
VINTAGE = "2026-01-01"
TO_METERS = Transformer.from_crs("EPSG:4326", "EPSG:3310", always_xy=True).transform
TO_LONLAT = Transformer.from_crs("EPSG:3310", "EPSG:4326", always_xy=True).transform


def fetch_json(url: str, cache_file: Path, refresh: bool = False) -> dict:
    """Cache complete API replies, rejecting truncation and service errors."""
    if cache_file.exists() and not refresh:
        return json.loads(cache_file.read_text())
    request = urllib.request.Request(url, headers={"User-Agent": "CSL2-Regional-Map/1.0 (public Census boundaries)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.load(response)
            if "error" in payload:
                raise RuntimeError(f"Census API error: {payload['error']}")
            if payload.get("exceededTransferLimit"):
                raise RuntimeError("Census response is truncated; narrow the query")
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(payload, separators=(",", ":")))
            return payload
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def query(layer: int, where: str, cache_name: str, refresh: bool, bounds=None, cache_dir=CACHE) -> dict:
    params = {
        "where": where,
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    if bounds:
        params.update(geometry=",".join(map(str, bounds)), geometryType="esriGeometryEnvelope",
                      inSR="4326", spatialRel="esriSpatialRelIntersects")
    return fetch_json(f"{SERVICE}/{layer}/query?{urllib.parse.urlencode(params)}",
                      cache_dir / cache_name, refresh)


def polygonal(geometry):
    """Retain positive-area geometry only, avoiding neighbor boundary touches."""
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    if isinstance(geometry, GeometryCollection):
        parts = []
        for part in geometry.geoms:
            valid = polygonal(part)
            if not valid.is_empty:
                parts.append(valid)
        return unary_union(parts)
    return MultiPolygon([])


def feature(geometry, properties: dict) -> dict:
    point = geometry.representative_point()
    west, south, east, north = geometry.bounds
    return {
        "type": "Feature",
        "id": properties["id"],
        "properties": {
            **properties,
            "labelLng": round(point.x, 6),
            "labelLat": round(point.y, 6),
            "bounds": [[west, south], [east, north]],
            "source": SOURCE,
            "vintage": VINTAGE,
        },
        "geometry": mapping(geometry),
    }


def build_boundaries(county_collection: dict, place_collections: list[tuple[str, dict]]) -> list[dict]:
    features = []
    for county in county_collection["features"]:
        county_id = county["properties"]["GEOID"]
        county_name = COUNTIES[county_id]
        county_geometry = polygonal(shape(county["geometry"]))
        covered = []
        for kind, collection in place_collections:
            for place in collection["features"]:
                geometry = polygonal(shape(place["geometry"]))
                if not geometry.intersects(county_geometry):
                    continue
                clipped = polygonal(geometry.intersection(county_geometry))
                # Shared administrative boundary lines have zero area; tiny
                # floating-point slivers must not invent a neighboring city.
                if clipped.is_empty or transform(clipped, TO_METERS, interleaved=False).area < 1:
                    continue
                props = place["properties"]
                geoid = props["GEOID"]
                name = props["BASENAME"]
                covered.append(clipped)
                features.append(feature(clipped, {
                    "id": f"place-{geoid}-{county_id}",
                    "geoid": geoid,
                    "name": name,
                    "label": name if kind == "city" else f"{name} (CDP)",
                    "kind": kind,
                    "county": county_name,
                    "countyFips": county_id,
                }))
        # CDPs are unincorporated too, but labeled individually. This residual
        # is the county area outside both cities and named Census places.
        residual = polygonal(county_geometry.difference(unary_union(covered)))
        if not residual.is_empty:
            name = f"Unincorporated {county_name}"
            features.append(feature(residual, {
                "id": f"unincorporated-{county_id}",
                "geoid": county_id,
                "name": name,
                "label": name,
                "kind": "unincorporated",
                "county": county_name,
                "countyFips": county_id,
            }))
    return sorted(features, key=lambda item: item["properties"]["id"])


def simplify_features(features: list[dict], tolerance_m: float) -> list[dict]:
    result = []
    for item in features:
        geometry = shape(item["geometry"])
        metric = transform(geometry, TO_METERS, interleaved=False)
        simplified = transform(metric.simplify(tolerance_m, preserve_topology=True), TO_LONLAT, interleaved=False)
        result.append({**item, "geometry": mapping(simplified)})
    return result


def validate_coverage(features: list[dict], counties: dict) -> dict:
    """Check county partition completeness without assuming any place count."""
    result = {}
    for county in counties["features"]:
        county_id = county["properties"]["GEOID"]
        geometry = shape(county["geometry"])
        parts = [shape(f["geometry"]) for f in features if f["properties"]["countyFips"] == county_id]
        union = unary_union(parts)
        uncovered_m2 = transform(geometry.symmetric_difference(union), TO_METERS, interleaved=False).area
        if uncovered_m2 > 2:
            raise RuntimeError(f"{county_id}: partition differs from county by {uncovered_m2} sq m")
        result[county_id] = {
            "name": COUNTIES[county_id],
            "cities": sum(f["properties"]["kind"] == "city" and f["properties"]["countyFips"] == county_id for f in features),
            "cdps": sum(f["properties"]["kind"] == "cdp" and f["properties"]["countyFips"] == county_id for f in features),
            "uncoveredSquareMeters": round(uncovered_m2, 3),
        }
    return result


def fetch_scope_sources(counties, refresh=False, cache_dir=CACHE):
    """Fetch the selected county extents and candidate places without publishing."""
    layer_metadata = fetch_json(f"{SERVICE}/28?f=json", cache_dir / "cities-layer.json", refresh)
    if "January 1, 2026" not in layer_metadata.get("description", ""):
        raise RuntimeError("Census layer vintage changed; update VINTAGE and review source metadata")
    key = cache_key(counties)
    identifiers = ",".join(f"'{identifier}'" for identifier in sorted(counties))
    county_collection = query(82, f"GEOID IN ({identifiers})", f"counties-{key}.geojson", refresh,
                              cache_dir=cache_dir)
    returned = {f["properties"]["GEOID"] for f in county_collection["features"]}
    if returned != set(counties):
        raise RuntimeError(f"County boundary coverage mismatch: expected {sorted(counties)}, got {sorted(returned)}")
    bounds = unary_union([shape(f["geometry"]) for f in county_collection["features"]]).bounds
    cities = query(28, "STATE='06'", f"cities-raw-{key}.geojson", refresh, bounds, cache_dir)
    cdps = query(30, "STATE='06'", f"cdps-raw-{key}.geojson", refresh, bounds, cache_dir)
    return county_collection, cities, cdps


def navigation_regions(counties):
    """Derive navigation bounds from official polygons, including county islands."""
    county_ids = {
        "06025": "imperial", "06029": "kern", "06037": "la", "06059": "oc",
        "06065": "riverside", "06071": "san-bernardino", "06073": "san-diego",
        "06079": "san-luis-obispo", "06083": "santa-barbara", "06111": "ventura",
    }
    union = unary_union([shape(item["geometry"]) for item in counties["features"]])

    def region(identifier, name, short_name, subtitle, geometry, zoom, fips):
        west, south, east, north = geometry.bounds
        return {"id": identifier, "name": name, "shortName": short_name, "subtitle": subtitle,
                "center": [round((west + east) / 2, 6), round((south + north) / 2, 6)],
                "zoom": zoom, "bearing": 0,
                "bounds": [[round(west, 6), round(south, 6)], [round(east, 6), round(north, 6)]],
                "countyFips": fips}

    ordered = sorted(counties["features"], key=lambda item: item["properties"]["GEOID"])
    count = len(ordered)
    regions = [region("socal", "Southern California", "SoCal", f"南加州 · {count} 县", union, 7,
                      [item["properties"]["GEOID"] for item in ordered])]
    for item in ordered:
        fips = item["properties"]["GEOID"]
        name = COUNTIES[fips]
        short_name = {"06037": "Los Angeles", "06059": "Orange County"}.get(fips, name.removesuffix(" County"))
        regions.append(region(county_ids[fips], name, short_name, "SOUTHERN CALIFORNIA",
                              shape(item["geometry"]), 8, [fips]))
    return regions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Refetch current official sources")
    parser.add_argument("--simplify-meters", type=float, default=3.0)
    parser.add_argument("--cache-dir", type=Path, default=CACHE)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data")
    parser.add_argument("--regions-output", type=Path, default=ROOT / "src/data/county-regions.json")
    parser.add_argument("--download-only", action="store_true", help="Cache official source replies without replacing public data")
    add_scope_arguments(parser)
    args = parser.parse_args()
    try:
        selected_counties = resolve_counties(args.scope, args.counties)
    except ValueError as error:
        parser.error(str(error))
    if args.simplify_meters < 0:
        parser.error("--simplify-meters must be non-negative")
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    counties, cities, cdps = fetch_scope_sources(selected_counties, args.refresh, args.cache_dir)
    if args.download_only:
        print(json.dumps({"countyFips": list(selected_counties), "countyCount": len(counties["features"]),
                          "cityCandidates": len(cities["features"]), "cdpCandidates": len(cdps["features"]),
                          "cacheKey": cache_key(selected_counties)}, indent=2))
        return
    features = build_boundaries(counties, [("city", cities), ("cdp", cdps)])
    validation = validate_coverage(features, counties)
    regions = navigation_regions(counties)
    args.regions_output.parent.mkdir(parents=True, exist_ok=True)
    args.regions_output.write_text(json.dumps(regions, ensure_ascii=False, indent=2) + "\n")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "regions.json").write_text(json.dumps(regions, ensure_ascii=False, indent=2) + "\n")
    metadata = {
        "source": SOURCE,
        "sourceUrl": SERVICE,
        "vintage": VINTAGE,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "counties": validation,
        "scope": args.scope if not args.counties else "custom",
        "countyFips": list(selected_counties),
        "method": "Exact county polygon intersection; county minus cities and CDPs for residual unincorporated areas",
        "featureCount": len(features),
    }
    full = {"type": "FeatureCollection", "metadata": metadata, "features": features}
    full_path = args.cache_dir / "full-city-boundaries.geojson"
    full_path.write_text(json.dumps(full, separators=(",", ":")))
    display = {"type": "FeatureCollection", "metadata": {**metadata, "displaySimplificationMeters": args.simplify_meters},
               "features": simplify_features(features, args.simplify_meters)}
    output = args.output_dir / "city-boundaries.geojson"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(display, separators=(",", ":")))
    manifest = {**metadata, "displayFile": str(output.relative_to(ROOT)) if output.is_relative_to(ROOT) else str(output),
                "fullResolutionFile": str(full_path.relative_to(ROOT)) if full_path.is_relative_to(ROOT) else str(full_path),
                "displaySha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "fullResolutionSha256": hashlib.sha256(full_path.read_bytes()).hexdigest()}
    (args.output_dir / "city-boundaries-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({**manifest, "displayBytes": output.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
