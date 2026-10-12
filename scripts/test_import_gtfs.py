"""Small behavioral checks for geometry and GTFS relationships, without network."""
import csv
import io
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path
import unittest
import zipfile

from import_gtfs import FEEDS, convert_feed, simplify, validate


def fixture(missing_shape=False, metrolink=False, operators=False):
    tables = {
        "routes.txt": [
            ["route_id", "route_short_name", "route_long_name", "route_type", "route_color"],
            ["1", "A", "Test Line", "0", "aa00bb"],
        ],
        "stops.txt": [
            ["stop_id", "stop_name", "stop_lat", "stop_lon", "parent_station"],
            ["station", "Union Station", "34.05", "-118.24", ""],
            ["platform1", "Platform 1", "34.0501", "-118.2401", "station"],
            ["platform2", "Platform 2", "34.0502", "-118.2402", "station"],
            ["unused", "Unused Stop", "34.1", "-118.1", ""],
        ],
        "trips.txt": [
            ["route_id", "trip_id", "shape_id"], ["1", "trip1", "shape"], ["1", "trip2", "reverse"],
        ],
        "stop_times.txt": [
            ["trip_id", "stop_id"], ["trip1", "platform1"], ["trip2", "platform2"],
        ],
        "shapes.txt": [
            ["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"],
            ["shape", "34.06", "-118.24", "3"],
            ["shape", "34.05", "-118.24", "1"],
            ["shape", "34.05", "-118.23", "2"],
            ["reverse", "34.06", "-118.24", "1"],
            ["reverse", "34.05", "-118.23", "2"],
            ["reverse", "34.05", "-118.24", "3"],
        ],
    }
    if missing_shape:
        tables["shapes.txt"] = tables["shapes.txt"][:4]
    if metrolink:
        tables["routes.txt"][1][0] = "Orange County Line"
        tables["trips.txt"] = [["route_id", "trip_id"], ["Orange County Line", "trip1"], ["Orange County Line", "trip2"]]
        for row in tables["shapes.txt"][1:]:
            row[0] = "OCin" if row[0] == "shape" else "OCout"
    if operators:
        tables["agency.txt"] = [["agency_id", "agency_name", "agency_url"],
                                ["a", "First Operator", "https://example.com/a"],
                                ["b", "Second Operator", "https://example.com/b"]]
        tables["routes.txt"][0].append("agency_id")
        tables["routes.txt"][1].append("b")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, records in tables.items():
            text = io.StringIO()
            csv.writer(text).writerows(records)
            archive.writestr(name, text.getvalue())
    return buffer.getvalue()


class ImportTests(unittest.TestCase):
    def test_gtfs_shape_sequence_parent_station_and_namespaced_links(self):
        routes, stops, index, meta = convert_feed(FEEDS[0], fixture(), "2026-10-12T00:00:00Z")
        validate(routes, stops)
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]["properties"]["color"], "#AA00BB")
        line = routes[0]["geometry"]["coordinates"][0]
        self.assertEqual(len(routes[0]["geometry"]["coordinates"]), 1)
        self.assertIn(line, [[(-118.24, 34.05), (-118.23, 34.05), (-118.24, 34.06)],
                             [(-118.24, 34.06), (-118.23, 34.05), (-118.24, 34.05)]])
        self.assertEqual(len(stops), 1)
        self.assertEqual(stops[0]["properties"]["name"], "Union Station")
        self.assertEqual(stops[0]["properties"]["routeIds"], ["metro-rail:1"])
        self.assertEqual(index[0]["bounds"], [[-118.24, 34.05], [-118.23, 34.06]])
        self.assertEqual(meta["sourceStopCount"], 4)

    def test_missing_shape_is_recorded_without_inventing_geometry(self):
        routes, _, _, meta = convert_feed(FEEDS[0], fixture(missing_shape=True), "2026-10-12T00:00:00Z")
        self.assertEqual(len(routes[0]["geometry"]["coordinates"]), 1)
        self.assertEqual(meta["skippedShapeIds"], ["reverse"])

    def test_simplification_removes_straight_points_but_preserves_corner(self):
        self.assertEqual(simplify([(0, 0), (0.001, 0), (0.002, 0)]), [(0, 0), (0.002, 0)])
        corner = [(0, 0), (0.001, 0.001), (0.002, 0)]
        self.assertEqual(simplify(corner), corner)

    def test_cross_reference_validation_rejects_dangling_route(self):
        routes, stops, _, _ = convert_feed(FEEDS[0], fixture(), "2026-10-12T00:00:00Z")
        stops[0]["properties"]["routeIds"] = ["missing:1"]
        with self.assertRaisesRegex(ValueError, "stop-to-route"):
            validate(routes, stops)

    def test_metrolink_uses_verified_official_named_shapes_when_trip_field_absent(self):
        routes, stops, _, meta = convert_feed(FEEDS[3], fixture(metrolink=True), "2026-10-12T00:00:00Z")
        validate(routes, stops)
        self.assertEqual(routes[0]["properties"]["id"], "metrolink:Orange County Line")
        self.assertIn("Explicit provider", meta["shapeAssociation"])
        self.assertEqual(meta["skippedShapeIds"], [])

    def test_combined_feed_preserves_actual_route_operator(self):
        routes, _, index, meta = convert_feed(FEEDS[0], fixture(operators=True), "2026-10-12T00:00:00Z")
        self.assertEqual(routes[0]["properties"]["operatorName"], "Second Operator")
        self.assertEqual(routes[0]["properties"]["operatorId"], "b")
        self.assertEqual(index[0]["operatorName"], "Second Operator")
        self.assertEqual(len(meta["operators"]), 2)

    def test_archived_official_feed_is_distinguished_from_a_live_download(self):
        feed = next(feed for feed in FEEDS if feed["id"] == "rta")
        _, _, _, meta = convert_feed(feed, fixture(), "2026-10-12T00:00:00Z")
        self.assertEqual(meta["feedUrl"], feed["feedUrl"])
        self.assertNotEqual(meta["downloadUrl"], meta["feedUrl"])
        self.assertEqual(meta["archiveDate"], "2026-09-14")
        self.assertIn("403", meta["retrievalNote"])


class PublishedSnapshotTests(unittest.TestCase):
    """Verify the actual three deployable files agree with the viewer contract."""

    @classmethod
    def setUpClass(cls):
        cls.data_dir = Path(__file__).resolve().parents[1] / "public" / "data"
        cls.manifest = json.loads((cls.data_dir / "transit-manifest.json").read_text())
        cls.route_collection = json.loads((cls.data_dir / "transit-routes.geojson").read_text())
        cls.stop_collection = json.loads((cls.data_dir / "transit-stops.geojson").read_text())
        cls.routes = cls.route_collection["features"]
        cls.stops = cls.stop_collection["features"]
        cls.agencies = {agency["id"]: agency for agency in cls.manifest["agencies"]}

    def test_manifest_exactly_matches_feature_ids_metadata_and_per_agency_counts(self):
        self.assertEqual(self.route_collection["type"], "FeatureCollection")
        self.assertEqual(self.stop_collection["type"], "FeatureCollection")
        validate(self.routes, self.stops)
        self.assertEqual(set(self.agencies), {feed["id"] for feed in FEEDS})
        self.assertEqual(len(self.agencies), len(self.manifest["agencies"]))
        datetime.fromisoformat(self.manifest["generatedAt"].replace("Z", "+00:00"))
        features = {route["properties"]["id"]: route for route in self.routes}
        index = {route["id"]: route for route in self.manifest["routes"]}
        self.assertEqual(set(features), set(index))
        self.assertEqual(len(index), len(self.manifest["routes"]))
        for rid, route in index.items():
            with self.subTest(route=rid):
                for key in ("id", "agencyId", "shortName", "longName", "color", "type"):
                    self.assertEqual(route[key], features[rid]["properties"][key])
                lines = features[rid]["geometry"]["coordinates"]
                flat = [point for line in lines for point in line]
                self.assertEqual(route["bounds"], [[min(p[0] for p in flat), min(p[1] for p in flat)],
                                                    [max(p[0] for p in flat), max(p[1] for p in flat)]])
        routes_by_agency = Counter(route["properties"]["agencyId"] for route in self.routes)
        stops_by_agency = Counter(stop["properties"]["agencyId"] for stop in self.stops)
        for aid, agency in self.agencies.items():
            with self.subTest(agency=aid):
                self.assertEqual(agency["routeCount"], routes_by_agency[aid])
                self.assertEqual(agency["stopCount"], stops_by_agency[aid])
                self.assertEqual(agency["status"], "ready")
                self.assertTrue(agency["url"].startswith("https://"))
                datetime.fromisoformat(agency["fetchedAt"].replace("Z", "+00:00"))
                self.assertEqual(agency["sourceRouteCount"], agency["routeCount"] + len(agency["skippedRoutes"]))
                self.assertTrue(set(row["id"] for row in agency["skippedRoutes"]).isdisjoint(features))

    def test_geometry_sources_and_stop_route_arrays_are_valid(self):
        routes = {route["properties"]["id"]: route for route in self.routes}
        for feature in self.routes + self.stops:
            props, geometry = feature["properties"], feature["geometry"]
            aid = props["agencyId"]
            with self.subTest(feature=props["id"]):
                self.assertEqual(feature["type"], "Feature")
                self.assertEqual(feature["id"], props["id"])
                self.assertTrue(props["id"].startswith(aid + ":"))
                self.assertEqual(props["source"], self.agencies[aid]["name"])
                self.assertEqual(props["feedUrl"], self.agencies[aid]["feedUrl"])
                self.assertIsInstance(props["name"], str)
                self.assertTrue(props["name"].strip())
                if geometry["type"] == "Point":
                    points = [geometry["coordinates"]]
                    self.assertIsInstance(props["routeIds"], list, "GeoJSON routeIds must remain arrays, not pre-serialized strings")
                    self.assertTrue(props["routeIds"])
                    self.assertEqual(len(props["routeIds"]), len(set(props["routeIds"])))
                    for rid in props["routeIds"]:
                        self.assertIsInstance(rid, str)
                        self.assertEqual(routes[rid]["properties"]["agencyId"], aid)
                else:
                    self.assertEqual(geometry["type"], "MultiLineString")
                    self.assertTrue(geometry["coordinates"])
                    self.assertTrue(all(len(line) >= 2 for line in geometry["coordinates"]))
                    self.assertIsInstance(props["type"], int)
                    self.assertEqual(props["shapeCount"], len(geometry["coordinates"]))
                    points = [p for line in geometry["coordinates"] for p in line]
                self.assertTrue(all(len(p) == 2 and all(math.isfinite(v) for v in p)
                                    and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in points))
        files = ("transit-manifest.json", "transit-routes.geojson", "transit-stops.geojson")
        self.assertLess(sum((self.data_dir / name).stat().st_size for name in files), 15_000_000)


if __name__ == "__main__":
    unittest.main()
