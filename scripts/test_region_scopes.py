"""Import coverage must be explicit and consistent across datasets."""

import unittest

from region_scopes import COUNTIES, SCOPES, cache_key, resolve_counties


class RegionalScopeTests(unittest.TestCase):
    def test_ten_counties_include_core_and_original_scope(self):
        self.assertEqual(len(resolve_counties("socal-ten")), 10)
        self.assertEqual(set(resolve_counties("la-oc")), {"06037", "06059"})
        self.assertEqual(len(resolve_counties("core-six")), 6)
        self.assertTrue(set(SCOPES["core-six"]) < set(COUNTIES))

    def test_override_deduplicates_and_orders_real_fips(self):
        self.assertEqual(list(resolve_counties("socal-ten", "06073,06037,06073")), ["06037", "06073"])
        self.assertEqual(cache_key(["06073", "06037"]), "06037-06073")

    def test_unknown_or_empty_counties_fail_instead_of_silent_partial_import(self):
        for counties in ["", "06000", "06037,", []]:
            with self.assertRaises(ValueError):
                resolve_counties(counties=counties)
        with self.assertRaises(ValueError):
            resolve_counties("nonexistent")


if __name__ == "__main__":
    unittest.main()
