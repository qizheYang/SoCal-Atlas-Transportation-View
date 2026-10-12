#!/usr/bin/env python3
"""Audit regional catalog coverage and source identities without rebuilding roads."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
from pathlib import Path

import shapefile

from import_roads import ROOT, VEHICLE_CLASSES, VINTAGE, base_name, numbered_route
from region_scopes import add_scope_arguments, resolve_counties


def audit(output, cache, counties):
    index_path = output / "roads-index.json"
    index = json.loads(index_path.read_text())
    assert set(index["countyFips"]) == set(counties), "Catalog county coverage mismatch"
    roads = {road["id"]: road for road in index["roads"]}
    assert len(roads) == len(index["roads"]), "Duplicate catalog road IDs"
    city_ids = {city["id"] for city in index["cities"]}
    assert len(city_ids) == len(index["cities"]), "Duplicate city IDs"
    assert {city["countyFips"] for city in index["cities"]} == set(counties), "City coverage mismatch"
    assert gzip.decompress(index_path.with_suffix(".json.gz").read_bytes()) == index_path.read_bytes()
    expected_shards = {road["geometryUrl"].rsplit("/", 1)[-1] for road in roads.values()}
    seen = Counter()
    endpoint_count = 0
    unmatched_endpoint_count = 0
    missing_vertex_count = 0
    for filename in sorted(expected_shards):
        path = output / "roads" / filename
        raw = path.read_bytes()
        assert gzip.decompress(path.with_suffix(".geojson.gz").read_bytes()) == raw, filename
        collection = json.loads(raw)
        for feature in collection["features"]:
            properties = feature["properties"]
            identifier = feature["id"]
            assert identifier in roads, f"Orphan geometry {identifier}"
            seen[identifier] += 1
            road = roads[identifier]
            assert properties["roadId"] == identifier and properties["name"] == road["name"]
            assert road["geometryUrl"].endswith("/" + filename)
            assert set(road["cityIds"]) == set(properties["cityIds"])
            assert set(road["cityIds"]) <= city_ids
            assert set(road["counties"]) <= set(counties)
            endpoints = properties["endpoints"]
            assert len(endpoints) == road["endpointCount"] == properties["endpointCount"]
            assert "unsimplified Census TIGER/Line" in properties["endpointGeometryBasis"]
            assert feature["geometry"]["type"] == "MultiLineString"
            vertices = {tuple(point) for line in feature["geometry"]["coordinates"] for point in line}
            for endpoint in endpoints:
                endpoint_count += 1
                assert set(endpoint["cityIds"]) <= city_ids
                unmatched_endpoint_count += not endpoint["cityIds"]
                missing_vertex_count += tuple(endpoint["coordinates"]) not in vertices
            for crossing in properties["crossings"]:
                assert set(crossing["cityIds"]) <= city_ids
    assert set(seen) == set(roads) and all(count == 1 for count in seen.values()), "Missing/repeated geometry"
    assert endpoint_count == index["stats"]["geographicEndpointCount"]
    assert unmatched_endpoint_count == index["stats"]["endpointsWithoutCityMatch"]
    assert missing_vertex_count == 0, f"{missing_vertex_count} endpoints are not source-geometry vertices"
    numbered = {}
    for road in roads.values():
        if numbered_route(road["name"]):
            key = road["name"].casefold()
            assert key not in numbered, f"Split numbered route {road['name']}"
            numbered[key] = road
    source_ids = defaultdict(list)
    source_counts = {}
    for fips in counties:
        raw_count = named_count = 0
        with shapefile.Reader(str(cache / f"tl_{VINTAGE}_{fips}_roads.zip")) as source:
            for row in source.iterRecords():
                raw_count += 1
                properties = row.as_dict()
                name = properties["FULLNAME"].strip()
                if properties["MTFCC"] not in VEHICLE_CLASSES or not name:
                    continue
                named_count += 1
                canonical = base_name(name)
                if numbered_route(canonical):
                    source_ids[canonical.casefold()].append(fips + ":" + properties["LINEARID"])
        expected = index["stats"]["sourceCounts"][fips]
        assert expected["rawRecords"] == raw_count and expected["namedVehicleRecords"] == named_count, fips
        source_counts[fips] = {"rawRecords": raw_count, "namedVehicleRecords": named_count}
    assert set(source_ids) == set(numbered), "Numbered source/catalog route names differ"
    for name, identifiers in source_ids.items():
        digest = hashlib.sha256("\n".join(sorted(set(identifiers))).encode()).hexdigest()
        assert numbered[name]["sourceLinearIdSha256"] == digest, f"Incomplete source identity set: {name}"
        assert numbered[name]["sourceRecordCount"] == len(identifiers), name
    return {"countyCount": len(counties), "roadCount": len(roads), "cityAreaCount": len(city_ids),
            "numberedRoutesAudited": len(numbered), "geometryShards": len(expected_shards),
            "geographicEndpointsAudited": endpoint_count, "unmatchedEndpointCities": unmatched_endpoint_count,
            "allEndpointsOnGeometryVertices": missing_vertex_count == 0,
            "rawIndexBytes": index_path.stat().st_size,
            "gzipIndexBytes": index_path.with_suffix(".json.gz").stat().st_size,
            "rawGeometryBytes": sum((output / "roads" / name).stat().st_size for name in expected_shards),
            "gzipGeometryBytes": sum((output / "roads" / (name + ".gz")).stat().st_size for name in expected_shards),
            "sourceCounts": source_counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/data")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/roads")
    add_scope_arguments(parser)
    args = parser.parse_args()
    print(json.dumps(audit(args.output_dir, args.cache_dir, resolve_counties(args.scope, args.counties)), indent=2))


if __name__ == "__main__":
    main()
