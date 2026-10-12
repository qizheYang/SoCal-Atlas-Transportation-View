"""Shared, explicit county coverage for reproducible Southern California imports."""

from __future__ import annotations

COUNTIES = {
    "06025": "Imperial County",
    "06029": "Kern County",
    "06037": "Los Angeles County",
    "06059": "Orange County",
    "06065": "Riverside County",
    "06071": "San Bernardino County",
    "06073": "San Diego County",
    "06079": "San Luis Obispo County",
    "06083": "Santa Barbara County",
    "06111": "Ventura County",
}
SCOPES = {
    "la-oc": ("06037", "06059"),
    "core-six": ("06037", "06059", "06065", "06071", "06073", "06111"),
    "socal-ten": tuple(COUNTIES),
}
DEFAULT_SCOPE = "socal-ten"


def resolve_counties(scope=DEFAULT_SCOPE, counties=None):
    """Return a stable selection; reject typos instead of silently omitting data."""
    identifiers = counties.split(",") if isinstance(counties, str) else counties
    identifiers = identifiers if identifiers is not None else SCOPES.get(scope)
    if not identifiers:
        raise ValueError(f"Unknown or empty regional scope: {scope!r}")
    identifiers = sorted({identifier.strip() for identifier in identifiers})
    unknown = set(identifiers) - set(COUNTIES)
    if unknown:
        raise ValueError(f"Unsupported county FIPS: {', '.join(sorted(unknown))}")
    return {identifier: COUNTIES[identifier] for identifier in identifiers}


def add_scope_arguments(parser):
    parser.add_argument("--scope", choices=tuple(SCOPES), default=DEFAULT_SCOPE,
                        help="County coverage preset (default: %(default)s)")
    parser.add_argument("--counties", help="Comma-separated county FIPS; overrides --scope")


def cache_key(counties):
    """Query caches must never silently reuse a different geographic scope."""
    return "-".join(sorted(counties))
