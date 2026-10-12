"""Behavioral checks for full-road identity and real city intersections."""

import unittest

try:
    import import_roads as roads
    from shapely.geometry import LineString, Polygon, mapping
except ModuleNotFoundError:
    roads = None


@unittest.skipIf(roads is None, "Install scripts/requirements-data.txt in .venv-data to test GIS import")
class RoadImporterTests(unittest.TestCase):
    def record(self, key, name, points, county="06037", mtfcc="S1400"):
        return roads.RoadRecord(key, name, county, mtfcc, "M", LineString(points))

    def test_numbered_route_aliases_do_not_capture_local_avenues(self):
        self.assertEqual(roads.numbered_route("I- 405"), "I-405")
        self.assertEqual(roads.numbered_route("State Rte 1"), "CA-1")
        self.assertEqual(roads.numbered_route("US Hwy 101 Bus"), "US-101 Bus")
        self.assertIsNone(roads.numbered_route("E Ave I- 4"))

    def test_numbered_route_normalization_is_idempotent(self):
        for name in ["I- 405", "CA-118", "SR-261", "State Rte 118", "State Route 1", "US Hwy 101 Bus", "US-101"]:
            canonical = roads.numbered_route(name)
            self.assertIsNotNone(canonical)
            self.assertEqual(roads.numbered_route(canonical), canonical)

    def test_literal_cardinal_and_letter_names_are_not_erased(self):
        for name in ["South St", "West St", "West Blvd", "E St", "East Rd", "North Avenue"]:
            self.assertEqual(roads.base_name(name), name)
        self.assertEqual(roads.base_name("N South St"), "South St")
        self.assertEqual(roads.base_name("E Broadway"), "Broadway")
        groups = list(roads.build_groups([
            self.record("a", "East Rd", [(0, 0), (100, 0)]),
            self.record("b", "West Rd", [(100, 0), (200, 0)]),
        ]))
        self.assertEqual({name for name, _ in groups}, {"East Rd", "West Rd"})

    def test_disconnected_same_names_remain_distinct_results(self):
        records = [self.record("a", "Main St", [(0, 0), (100, 0)]),
                   self.record("b", "Main St", [(1000, 0), (1100, 0)], "06059")]
        grouped = list(roads.build_groups(records))
        self.assertEqual(len(grouped), 2)
        self.assertNotEqual(roads.road_identifier(*grouped[0]), roads.road_identifier(*grouped[1]))

    def test_cross_county_and_directional_sections_are_one_street(self):
        records = [self.record("a", "W Imperial Hwy", [(0, 0), (100, 0)]),
                   self.record("b", "E Imperial Hwy", [(100, 0), (200, 0)], "06059")]
        grouped = list(roads.build_groups(records))
        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0][0], "Imperial Hwy")
        self.assertEqual({record.county for record in grouped[0][1]}, {"06037", "06059"})

    def test_short_source_gap_groups_identity_without_drawing_a_bridge(self):
        records = [self.record("a", "Wilshire Blvd", [(0, 0), (100, 0)]),
                   self.record("b", "W Wilshire Blvd", [(114, 0), (200, 0)])]
        grouped = list(roads.build_groups(records))
        self.assertEqual(len(grouped), 1)
        self.assertEqual(sum(record.geometry.length for record in grouped[0][1]), 186)

    def test_numbered_route_retains_both_carriageways_and_regional_sections(self):
        records = [self.record("a", "I- 5", [(0, 0), (100, 0)], mtfcc="S1100"),
                   self.record("b", "I- 5", [(1000, 20), (1100, 20)], "06059", "S1100")]
        grouped = list(roads.build_groups(records))
        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0][0], "I-5")
        self.assertEqual(len(grouped[0][1]), 2)

    def test_state_and_us_routes_keep_disconnected_sections_and_highway_class(self):
        for raw_name, canonical in [("State Rte 118", "CA-118"), ("US Hwy 101 Bus", "US-101 Bus")]:
            records = [self.record("a", raw_name, [(0, 0), (100, 0)], mtfcc="S1200"),
                       self.record("b", raw_name, [(1000, 30), (1100, 30)], "06059", "S1200")]
            grouped = list(roads.build_groups(records))
            self.assertEqual(len(grouped), 1)
            self.assertEqual(grouped[0][0], canonical)
            self.assertEqual(len(grouped[0][1]), 2)
            self.assertEqual(roads.road_kind(canonical, records), "highway")

    def test_directional_state_route_names_join_the_canonical_route(self):
        names = ["E State Rte 66", "W State Rte 66", "State Rte 66", "CA-66"]
        self.assertEqual({roads.base_name(name) for name in names}, {"CA-66"})
        records = [self.record(str(i), name, [(i * 1000, 0), (i * 1000 + 100, 0)], mtfcc="S1200")
                   for i, name in enumerate(names)]
        groups = list(roads.build_groups(records))
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0][0], "CA-66")
        self.assertEqual(len(groups[0][1]), 4)

    def test_extended_counties_share_one_numbered_route_without_losing_sections(self):
        names = ["I- 5", "I-5", "I- 5", "I-5", "I- 5"]
        fips = ["06029", "06037", "06059", "06073", "06111"]
        records = [self.record(str(index), name, [(index * 1000, 0), (index * 1000 + 100, 0)],
                               county, "S1100")
                   for index, (name, county) in enumerate(zip(names, fips))]
        groups = list(roads.build_groups(records))
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0][0], "I-5")
        self.assertEqual({record.county for record in groups[0][1]}, set(fips))

    def test_identity_is_stable_under_source_order(self):
        records = [self.record("a", "Main St", [(0, 0), (100, 0)]),
                   self.record("b", "Main St", [(100, 0), (200, 0)])]
        self.assertEqual(roads.road_identifier("Main St", records),
                         roads.road_identifier("Main St", list(reversed(records))))

    def test_city_intersections_include_middle_city_not_only_endpoints(self):
        features = []
        for i, (west, east) in enumerate([(-118.03, -118.02), (-118.02, -118.01), (-118.01, -118.0)]):
            polygon = Polygon([(west, 33.99), (east, 33.99), (east, 34.01), (west, 34.01)])
            features.append({"type": "Feature", "properties": {"id": str(i), "name": str(i)},
                             "geometry": mapping(polygon)})
        index = roads.BoundaryIndex({"type": "FeatureCollection", "features": features})
        line = roads.transform(roads.BOUNDARY_TO_METRIC, LineString([(-118.025, 34), (-118.005, 34)]))
        cities, crossings = index.match(line)
        self.assertEqual(set(cities), {"0", "1", "2"})
        self.assertEqual(len(crossings), 2)
        self.assertEqual({tuple(crossing["cityIds"]) for crossing in crossings}, {("0", "1"), ("1", "2")})

    def test_point_only_city_tangency_does_not_claim_traversal(self):
        polygon = Polygon([(-118.02, 34), (-118.01, 34), (-118.01, 34.01), (-118.02, 34.01)])
        index = roads.BoundaryIndex({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"id": "city", "name": "City"}, "geometry": mapping(polygon)}]})
        line = roads.transform(roads.BOUNDARY_TO_METRIC, LineString([(-118.03, 33.99), (-118.02, 34)]))
        cities, _ = index.match(line)
        self.assertEqual(cities, [])


if __name__ == "__main__":
    unittest.main()
