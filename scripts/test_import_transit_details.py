"""Behavioral checks for transit length and terminal derivation."""
import csv
import io
import json
from pathlib import Path
import unittest
import zipfile

from import_gtfs import FEEDS
from import_transit_details import convert_details, line_length_km


def fixture():
    tables = {
        "trips.txt": [["trip_id", "route_id", "shape_id"], ["t1", "1", "long"],
                      ["t2", "1", "short"], ["t3", "1", "reverse"], ["t4", "1", "long"]],
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon", "parent_station"],
                      ["a", "Station A", "34", "-118", ""], ["ap", "Platform A", "34", "-118", "a"],
                      ["b", "Station B", "34.02", "-118", ""], ["c", "Station C", "34.01", "-118", ""]],
        "stop_times.txt": [["trip_id", "stop_id", "stop_sequence"],
                           ["t1", "b", "9"], ["t1", "ap", "2"], ["t1", "c", "3"],
                           ["t2", "ap", "1"], ["t2", "c", "2"],
                           ["t3", "b", "1"], ["t3", "ap", "2"],
                           ["t4", "ap", "1"], ["t4", "b", "2"]],
        "shapes.txt": [["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"],
                       ["long", "2", "34.02", "-118"], ["long", "1", "34", "-118"],
                       ["reverse", "1", "34.02", "-118"], ["reverse", "2", "34", "-118"],
                       ["short", "1", "34", "-118"], ["short", "2", "34.01", "-118"]],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, records in tables.items():
            text = io.StringIO()
            csv.writer(text).writerows(records)
            archive.writestr(name, text.getvalue())
    return buffer.getvalue()


class TransitDetailsTests(unittest.TestCase):
    def setUp(self):
        self.details = convert_details(FEEDS[0], fixture(), {"metro-rail:1"}, "2026-10-12T00:00:00Z")["metro-rail:1"]

    def test_endpoints_follow_stop_sequence_and_parent_station(self):
        pair = self.details["endpoints"][0]
        self.assertEqual(pair["from"]["id"], "metro-rail:a")
        self.assertEqual(pair["from"]["name"], "Station A")
        self.assertEqual(pair["to"]["id"], "metro-rail:b")
        self.assertEqual(pair["tripCount"], 2)

    def test_lengths_keep_short_patterns_and_deduplicate_reverse_not_sum(self):
        self.assertEqual(self.details["patternCount"], 2)
        self.assertAlmostEqual(self.details["lengthKm"]["min"], 1.112, places=2)
        self.assertAlmostEqual(self.details["lengthKm"]["max"], 2.224, places=2)
        self.assertLess(self.details["lengthKm"]["max"], 3)

    def test_short_turn_and_reverse_terminal_pairs_remain_distinct(self):
        pairs = {(p["from"]["id"], p["to"]["id"]) for p in self.details["endpoints"]}
        self.assertEqual(pairs, {("metro-rail:a", "metro-rail:b"), ("metro-rail:b", "metro-rail:a"), ("metro-rail:a", "metro-rail:c")})

    def test_length_follows_corners_not_endpoint_straight_line(self):
        direct = line_length_km([(-118, 34), (-117.99, 34.01)])
        bent = line_length_km([(-118, 34), (-118, 34.01), (-117.99, 34.01)])
        self.assertGreater(bent, direct)

    def test_published_details_cover_the_displayed_snapshot(self):
        root = Path(__file__).resolve().parents[1] / "public/data"
        details = json.loads((root / "transit-details.json").read_text())["routes"]
        routes = json.loads((root / "transit-manifest.json").read_text())["routes"]
        self.assertEqual(set(details), {r["id"] for r in routes})
        for value in details.values():
            self.assertGreater(value["lengthKm"]["min"], 0)
            self.assertGreaterEqual(value["lengthKm"]["max"], value["lengthKm"]["min"])
            self.assertGreater(len(value["endpoints"]), 0)
            for pair in value["endpoints"]:
                self.assertGreater(pair["tripCount"], 0)
                for endpoint in (pair["from"], pair["to"]):
                    self.assertTrue(endpoint["name"])
                    self.assertTrue(-180 <= endpoint["coordinates"][0] <= 180)
                    self.assertTrue(-90 <= endpoint["coordinates"][1] <= 90)

    def test_published_details_match_each_manifest_feed_hash(self):
        root = Path(__file__).resolve().parents[1] / "public/data"
        details = json.loads((root / "transit-details.json").read_text())
        manifest = json.loads((root / "transit-manifest.json").read_text())
        self.assertEqual(set(details["sourceFeeds"]), {agency["id"] for agency in manifest["agencies"]})
        for agency in manifest["agencies"]:
            source = details["sourceFeeds"][agency["id"]]
            self.assertEqual(source["sha256"], agency["sha256"])
            self.assertEqual(source["fetchedAt"], agency["fetchedAt"])

    def test_archived_feed_terminal_details_show_the_archive_date(self):
        feed = next(feed for feed in FEEDS if feed["id"] == "rta")
        details = convert_details(feed, fixture(), {"rta:1"}, "2026-10-12T00:00:00Z")["rta:1"]
        self.assertIn("archive 2026-09-14", details["source"])
        self.assertEqual(details["sourceUrl"], feed["archiveSourceUrl"])


if __name__ == "__main__":
    unittest.main()
