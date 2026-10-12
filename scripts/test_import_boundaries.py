"""Geographic guarantees needed by city-disambiguated road search.

Run with .venv-data/bin/python -m unittest discover -s scripts -p 'test_*.py'.
"""

import unittest

try:
    from shapely.geometry import Point, box, mapping, shape
    from shapely.ops import unary_union
    from import_boundaries import build_boundaries, navigation_regions, polygonal, validate_coverage
except ModuleNotFoundError:
    build_boundaries = None


def collection(features):
    return {"type": "FeatureCollection", "features": features}


def source_feature(geometry, **properties):
    return {"type": "Feature", "geometry": mapping(geometry), "properties": properties}


@unittest.skipIf(build_boundaries is None, "Requires scripts/requirements-data.txt in .venv-data")
class BoundaryImportTests(unittest.TestCase):
    def setUp(self):
        # Small realistic WGS84 rectangle; western part is a city, central
        # part a CDP, and eastern part unlabeled county territory.
        self.county = box(-118.4, 34.0, -118.3, 34.1)
        self.counties = collection([source_feature(self.county, GEOID="06037")])
        self.cities = collection([
            source_feature(box(-118.5, 34.0, -118.36, 34.1), GEOID="0600001", BASENAME="Test City"),
            source_feature(box(-118.3, 34.0, -118.2, 34.1), GEOID="0600002", BASENAME="Adjacent City"),
        ])
        self.cdps = collection([
            source_feature(box(-118.36, 34.0, -118.34, 34.1), GEOID="0600003", BASENAME="Test Community"),
        ])
        self.features = build_boundaries(self.counties, [("city", self.cities), ("cdp", self.cdps)])

    def test_places_are_clipped_to_real_county_not_extent_candidates(self):
        self.assertEqual(len(self.features), 3)
        names = [f["properties"]["name"] for f in self.features]
        self.assertNotIn("Adjacent City", names)
        for item in self.features:
            self.assertTrue(self.county.covers(shape(item["geometry"])))

    def test_county_partition_has_no_uncovered_or_double_counted_area(self):
        geometries = [shape(f["geometry"]) for f in self.features]
        self.assertTrue(unary_union(geometries).equals(self.county))
        for i, geometry in enumerate(geometries):
            for other in geometries[i + 1:]:
                self.assertEqual(geometry.intersection(other).area, 0)
        validation = validate_coverage(self.features, self.counties)
        self.assertEqual(validation["06037"]["uncoveredSquareMeters"], 0)

    def test_cdp_and_residual_are_not_misrepresented_as_cities(self):
        indexed = {f["properties"]["kind"]: f for f in self.features}
        self.assertEqual(set(indexed), {"city", "cdp", "unincorporated"})
        self.assertEqual(indexed["cdp"]["properties"]["label"], "Test Community (CDP)")
        self.assertTrue(shape(indexed["unincorporated"]["geometry"]).contains(Point(-118.32, 34.05)))

    def test_labels_lie_inside_their_area_and_bounds_are_complete(self):
        for item in self.features:
            props = item["properties"]
            geometry = shape(item["geometry"])
            self.assertTrue(geometry.covers(Point(props["labelLng"], props["labelLat"])))
            self.assertEqual(props["bounds"], [list(geometry.bounds[:2]), list(geometry.bounds[2:])])

    def test_multi_county_place_keeps_real_clipped_parts_and_county_residuals(self):
        counties = collection([
            source_feature(box(-118.4, 34, -118.3, 34.1), GEOID="06037"),
            source_feature(box(-118.3, 34, -118.2, 34.1), GEOID="06065"),
        ])
        shared_city = collection([source_feature(box(-118.35, 34, -118.25, 34.1),
                                                GEOID="0600999", BASENAME="Cross County")])
        features = build_boundaries(counties, [("city", shared_city)])
        city_parts = [item for item in features if item["properties"]["kind"] == "city"]
        self.assertEqual({item["properties"]["countyFips"] for item in city_parts}, {"06037", "06065"})
        self.assertEqual(len({item["properties"]["id"] for item in city_parts}), 2)
        self.assertEqual({item["properties"]["geoid"] for item in city_parts}, {"0600999"})
        self.assertEqual(len([item for item in features if item["properties"]["kind"] == "unincorporated"]), 2)
        self.assertTrue(all(value["uncoveredSquareMeters"] == 0
                            for value in validate_coverage(features, counties).values()))

    def test_navigation_bounds_come_from_full_county_polygons(self):
        counties = collection([
            source_feature(box(-120, 33, -119, 35), GEOID="06037"),
            source_feature(box(-117, 32, -116, 34), GEOID="06073"),
        ])
        regions = navigation_regions(counties)
        self.assertEqual(regions[0]["bounds"], [[-120, 32], [-116, 35]])
        self.assertEqual(regions[0]["bearing"], 0)
        self.assertEqual({region["id"] for region in regions}, {"socal", "la", "san-diego"})
        self.assertTrue(all(region["bearing"] == 0 for region in regions))

    def test_shared_boundary_line_is_not_a_city_area(self):
        self.assertTrue(polygonal(self.county.boundary).is_empty)


if __name__ == "__main__":
    unittest.main()
