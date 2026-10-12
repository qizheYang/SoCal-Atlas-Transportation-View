"""Endpoint topology tests: no invented direction, geometry, or two-point limit."""

import gzip
import json
from pathlib import Path
import tempfile
import unittest

try:
    import add_road_endpoints as endpoints
    from shapely import STRtree
    from shapely.geometry import LineString, MultiLineString, Polygon, box, mapping
except ModuleNotFoundError:
    endpoints = None


@unittest.skipIf(endpoints is None, "Install scripts/requirements-data.txt in .venv-data")
class RoadEndpointTests(unittest.TestCase):
    def positions(self, geometry, distance=20):
        return {(round(point.x, 6), round(point.y, 6))
                for point in endpoints.terminal_points(geometry, distance)}

    def test_segmentation_direction_and_duplicate_linework_do_not_create_terminals(self):
        geometry = MultiLineString([
            [(0, 0), (50, 0)], [(100, 0), (50, 0)], [(50, 0), (100, 0)],
        ])
        before = geometry.wkb
        self.assertEqual(self.positions(geometry), {(0, 0), (100, 0)})
        self.assertEqual(geometry.wkb, before)

    def test_short_forward_source_gap_is_not_reported_as_two_extra_ends(self):
        geometry = MultiLineString([[(0, 0), (100, 0)], [(115, 0), (200, 0)]])
        self.assertEqual(self.positions(geometry), {(0, 0), (200, 0)})
        self.assertEqual(self.positions(geometry, 0), {(0, 0), (100, 0), (115, 0), (200, 0)})

    def test_disconnected_sections_above_tolerance_keep_all_four_endpoints(self):
        geometry = MultiLineString([[(0, 0), (100, 0)], [(125, 0), (200, 0)]])
        self.assertEqual(self.positions(geometry), {(0, 0), (100, 0), (125, 0), (200, 0)})

    def test_close_parallel_carriageway_ends_are_not_erased_by_distance_clustering(self):
        geometry = MultiLineString([[(0, 0), (100, 0)], [(100, 8), (0, 8)]])
        self.assertEqual(self.positions(geometry), {(0, 0), (100, 0), (0, 8), (100, 8)})

    def test_branches_and_exact_crossings_are_noded_without_a_two_endpoint_limit(self):
        geometry = MultiLineString([[(0, 0), (100, 0)], [(50, -60), (50, 60)],
                                    [(75, 0), (75, 10)]])
        self.assertEqual(self.positions(geometry), {(0, 0), (100, 0), (50, -60), (50, 60), (75, 10)})

    def test_t_junction_with_small_source_gap_has_three_outer_terminals(self):
        geometry = MultiLineString([[(0, 0), (100, 0)], [(50, 15), (50, 60)]])
        self.assertEqual(self.positions(geometry), {(0, 0), (100, 0), (50, 60)})

    def test_closed_network_has_no_open_terminal_and_loop_branch_has_one(self):
        ring = [(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)]
        self.assertEqual(self.positions(LineString(ring)), set())
        self.assertEqual(self.positions(MultiLineString([ring, [(100, 50), (150, 50)]])), {(150, 50)})

    def test_short_real_road_retains_two_close_ends(self):
        self.assertEqual(self.positions(LineString([(0, 0), (8, 0)])), {(0, 0), (8, 0)})

    def test_city_assignment_uses_exact_polygon_membership_and_keeps_unknowns_empty(self):
        class Boundaries:
            properties = [{"id": "west"}, {"id": "east"}]
            geometries = [box(400000, 3760000, 400100, 3760100), box(400100, 3760000, 400200, 3760100)]
            tree = STRtree(geometries)
        geometry = LineString([(400100, 3760050), (400300, 3760050)])
        result = endpoints.road_endpoints(geometry, Boundaries())
        self.assertEqual(result[0]["cityIds"], ["east", "west"])
        self.assertEqual(result[1]["cityIds"], [])
        self.assertTrue(all(-119 < item["coordinates"][0] < -117 for item in result))
        self.assertTrue(all(33 < item["coordinates"][1] < 35 for item in result))

    def test_enrichment_preserves_geometry_and_keeps_compressed_catalog_in_sync(self):
        geometry = {"type": "MultiLineString", "coordinates": [[[-118.01, 34], [-118, 34]], [[-118, 34], [-117.99, 34]]]}
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "roads").mkdir()
            polygon = Polygon([(-118.1, 33.9), (-117.9, 33.9), (-117.9, 34.1), (-118.1, 34.1)])
            boundary = base / "boundaries.geojson"
            boundary.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"id": "city"}, "geometry": mapping(polygon)}]}))
            shard = base / "roads" / "aa.geojson"
            shard.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "id": "road", "properties": {"name": "Main St", "crossings": []}, "geometry": geometry}]}))
            index = base / "roads-index.json"
            index.write_text(json.dumps({"roads": [{"id": "road", "name": "Main St"}], "method": {"length": "existing definition"}, "stats": {}}))
            stats = endpoints.enrich(base, boundary)
            feature = json.loads(shard.read_text())["features"][0]
            self.assertEqual(feature["geometry"], geometry)
            self.assertEqual(feature["properties"]["crossings"], [])
            self.assertEqual(feature["properties"]["endpointCount"], 2)
            self.assertEqual([point["cityIds"] for point in feature["properties"]["endpoints"]], [["city"], ["city"]])
            self.assertEqual(stats["roadsEnriched"], 1)
            self.assertEqual(json.loads(index.read_text())["roads"][0]["endpointCount"], 2)
            self.assertEqual(gzip.decompress((base / "roads-index.json.gz").read_bytes()), index.read_bytes())


if __name__ == "__main__":
    unittest.main()
