# Shared route checkerboards

Selecting two or more highways, streets or transit routes preserves each normal
highlight and adds a checkerboard only along their shared source geometry.
Three, four or more members use all member colors, rather than drawing pairs on
top of one another. Each pattern has two rows; row two advances by one color.

All explicitly selected roads and transit routes share one color allocator.
Transit keeps its agency color when available; if another selected or loading
route already owns that color, a distinct comparison color is reserved instead.
Beyond the initial palette, generated hues extend the set without cycling back
to colors already in use. Re-focusing or removing another selection never
recolors retained highlights. The transit `color` metadata stays unchanged;
`highlightColor` and `TransitFilter.routeColors` carry display overrides through
the tray, route list, map lines, stop outlines and checkerboards. Agency-wide
browsing continues to use original agency colors. Details identify overrides.

## Geometry and interpretation

`src/map/routeOverlap.ts` accepts complete selected road geometry and the selected
route features from `public/data/transit-routes.geojson`. GTFS directions and
short-turn shapes with the same route ID count as one member. Neither input is
mutated. There is no viewport clipping and no count or agency list hardcoded into
the detector.

Coordinates are projected into a local meter system. A 128 m spatial grid limits
candidate comparisons; long edges are subdivided to at most 120 m. Candidates
must align within 2 degrees and 2 m. Their overlapping intervals are split at
every membership change and then joined without bridging gaps. Shared runs
shorter than 3 m are discarded. Thus differently sampled or reversed shapes can
match while perpendicular crossings, endpoint contacts and neighboring roads
outside the tolerance do not.

This is a conservative comparison of 2D source centerlines, not a claim about
physical lane sharing, travel direction, grade separation or scheduled service.
Two layers with larger geometry offsets can describe the same infrastructure
without qualifying; a small source discrepancy within 2 m can qualify. At a
zoom where neighboring lines merely look coincident, they are still separate.

## Browser integration and responsiveness

`useRouteOverlaps.ts` starts work only for at least two distinct selected IDs.
Agency-wide browsing does not qualify. Transit participates only while its map
layer is visible. The extra GTFS download is lazy and cached for the page session;
road-only comparisons do not fetch it. Download failures can retry on selection.

`overlapJobs.ts` passes only selected geometries to a dedicated module Web Worker.
Changing selections, removing highlights or unmounting terminates active work.
Canceled downloads cannot create a worker, queued stale responses are ignored,
and the previous overlay disappears immediately when membership changes. Mode,
camera and perspective changes reuse the current result; map gestures do not
run geometry analysis on the main thread.

Every generated map style includes `selected-route-overlaps` and
`selected-route-overlap-pattern`, even when empty. The pattern is above all road
and transit solid highlights and below road labels, boundary annotations and
stops. Existing road/transit features handle inspection, keeping their IDs and
details. Clicking a selected route does not cover its colors with the generic
selection stroke.

`overlapStyle.ts` generates opaque RGBA images directly. Their width is a power
of two, as required for seamless [MapLibre line-pattern images](https://maplibre.org/maplibre-style-spec/layers/#line-pattern).
Every member receives a column even for odd counts such as three or five. Images
are registered on `style.load` and `styleimagemissing`, so mode and 2D/3D style
updates preserve the checkerboard. No external icon or sprite service is needed.

## Validation

Unit coverage includes differently sampled and reversed geometry; exact two,
three, four and five-member intervals; duplicate route directions; crossing,
touching and parallel non-overlap; fine samples and gaps; cancellation before
and during work; stale callbacks; worker/download failures; hidden transit;
RGBA color coverage; and full MapLibre style validation and layer ordering.

On the initial LA/OC snapshot, a local benchmark of I-5, I-10, I-405 and six Metro
Rail lines processed 12,755 indexed segments and 84,386 candidate comparisons in
approximately 53 ms. This is a local measurement, not a performance guarantee
for future expanded datasets. Computation runs in a worker to protect map input.
