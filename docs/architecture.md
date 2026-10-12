# Architecture and acceptance plan

Research date: 2026-10-12. Architecture and acceptance plan, updated during implementation. Passing the checks below still requires explicit test and browser evidence.

## Product boundary

Build a browser map viewer with a Cities: Skylines II inspired map-editor composition: map-first canvas, inspectable real features, compact view controls, road hierarchy, neutral buildings, and selectively emphasized infrastructure. First supported region is Los Angeles County plus Orange County, with separate camera presets. The user confirmed a real-world 2D/3D viewer, with no editing in the first version. Region presets select a camera and dataset configuration; they do not claim to be county boundary polygons.

The first release is a viewer. Drawing, demolition, city simulation, traffic simulation, route planning, and editing source geography require distinct future features and must not appear to work through decorative controls. Terrain may have a real DEM-backed layer if its provider is verified; a landcover-only view should be called landcover, not elevation.

## Stack and data delivery

- React, TypeScript and Vite for the application shell; MapLibre GL JS owns a single long-lived WebGL map.
- Commit a custom MapLibre style in application code. Use the OpenFreeMap vector TileJSON, glyphs and source attribution. Avoid runtime dependence on modifying a remote provider's style-layer IDs.
- OpenFreeMap provides keyless OpenStreetMap tiles with the OpenMapTiles schema, allows custom styles, and offers no service-level guarantee. Keep its endpoint and attribution configurable and report failures visibly. Its current Vite instructions include an explicit worker URL. [OpenFreeMap](https://openfreemap.org/), [quick start](https://openfreemap.org/quick_start/).
- Include compact, reproducibly generated GTFS route and stop GeoJSON plus a source manifest. Serve these static assets locally with the app. Keep sources stable across camera and view changes.
- Do not download either county's complete raw OSM buildings into browser GeoJSON. Vector tiles provide view-dependent loading. A later self-hosted regional PMTiles archive can use the same renderer and styles; PMTiles retrieves only necessary byte ranges and is a read-only archive. [PMTiles concepts](https://docs.protomaps.com/pmtiles/).
- Use local place presets and loaded stop/route/POI filtering for first-version search, clearly labeled by search scope. Public Nominatim is not a drop-in autocomplete: the official policy prohibits autocomplete, restricts total request volume, and imposes additional requirements on LLM-generated integrations. Choose a geocoder deliberately in a later increment. [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

## Parallel implementation contract

The source of truth for shared interfaces is `src/types.ts`. The map exports a default `forwardRef<MapHandle, MapViewProps>` component. The parent owns region, mode, layer settings, 2D/3D state, transit filters, inspector and status UI. The ref provides `flyTo`, `fitRegion`, `zoomBy` and `resetBearing`.

- `agencyIds: []` means all transit agencies. A nonempty list filters the agency IDs.
- `routeId: null` means all routes; a string matches the globally namespaced route property `id`. Stops match that route through their `routeIds` array.
- `regionId` controls the initial camera. Later camera changes are explicit ref calls, so changing the region label cannot override a selected place.
- `onFeatureSelect` receives source-backed properties only. Clearing a map selection emits `null`.
- `onStatus` distinguishes loading, ready, degraded and error; initial source loading must complete before ready.
- Regions and places are exported as `REGIONS` and `PLACES` from `src/data/regions.ts`.

Suggested ownership:

| Module | Owner responsibility |
| --- | --- |
| `src/types.ts`, `src/data/regions.ts` | Stable shared contracts, SoCal counties / LA+OC / preset registration |
| `src/map/style.ts` | Palette, zoom-dependent road widths, source/layer IDs, visibility rules |
| `src/map/MapView.tsx` | Map lifecycle, selection, camera, loading/errors, layer updates |
| `src/map/inspect.ts` | Pure tile/GTFS property normalization into truthful display fields |
| `src/App.tsx`, application CSS | Toolbar, view controls, layers, inspector, legend, sources |
| `scripts/build-transit.*`, `public/data/` | Reproducible ingestion, local overlay data, source manifest |

Never have React rerender a new map on each control change. Create the map once, then apply MapLibre style diffs and camera changes; remove map/listeners on unmount. Do not let a freshly allocated region object reset the user's camera every render.

## Cartography and inspection

Use separate ordered layers for landcover/water, building footprints, tunnels, road casings and fills, bridges, transit overlays, POI symbols, labels and selection. At county zoom, favor freeways and arterials. Reveal local roads and footprints as the user zooms; reveal minor POIs later. Limit pitch to keep tilted mode usable.

The OpenMapTiles building field `render_height` is derived/approximated and should be labeled estimated. The road geometry layer and road-label layer are separate; do not borrow the nearest label as if it were a verified road identity. Available road properties include class, one-way, bridge/tunnel, toll and surface; absent properties remain unknown. POIs expose limited names/categories, not a complete business directory. [OpenMapTiles schema](https://openmaptiles.org/docs/schema/).

Query only currently visible selectable layers, in an explicit priority order, within a small click box. Hide selection when its layer is disabled. Deduplicate fragments and casing/fill copies. Do not turn tile IDs into OSM object links unless their identifier encoding and object type are established. MapLibre's rendered-feature query is scoped to visible map features; its output is not a region-wide census. [MapLibre queries](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#queryrenderedfeatures).

For regular buildings, render footprints in 2D and modest extrusions in 3D. Heights from source render fields are estimated; a fallback height is visual only and must never appear as measured building height in the inspector. Do not infer residential/commercial category from appearance.

For transit, retain route ID/name/type/color, agency, direction or shape identity when present. A representative shape per route is not a full timetable. Label the snapshot and coverage. Include LA Metro rail and bus plus OCTA bus only when validated feeds are actually included; do not imply coverage of every LA/OC operator. Train tracks in OSM alone do not prove passenger routes or service frequency.

## State and resilience

- Persist safe display preferences and the last camera in versioned local storage; malformed old storage should fall back to defaults.
- Hash/deep-link camera and mode if inexpensive; validate all numeric inputs before passing them to MapLibre.
- Render a useful failure panel if WebGL is unavailable; leave source information and local place controls accessible.
- Distinguish map loading from complete failure and individual tile errors. Rate-limit repeated error messages. Offer an explicit retry that reconstructs failed sources safely.
- Cancel stale data fetches on dataset changes. Never report ready merely because the style document loaded; wait for at least initial source loading/idle and keep optional-source errors separate.
- Keep CSS panels pointer-interactive while unoccupied canvas remains draggable. Controls have labels, keyboard focus, selected states, and adequate contrast. Respect reduced motion.

## Acceptance checks

Run checks against the installed dependency versions, not assumptions from examples. Build/type-check is necessary but does not prove rendered tiles or usable interaction.

| Check | Passing evidence |
| --- | --- |
| Build | TypeScript and production bundle succeed; no missing worker/assets |
| Real geography | Live browser shows LA coastline/freeways and OC streets from provider tiles; no decorative background passed off as a map |
| Regional navigation | LA, OC and combined presets move the camera; manual navigation remains stable after toggles |
| 2D/3D | Perspective changes and building representation follows the active switch without leaking duplicate layers |
| Road view | Major/freeway hierarchy readable; other layers de-emphasized; road click opens only source-backed fields |
| Transit | Real local route shapes and stops render; source date/coverage is visible; agency or type filtering affects the map |
| Layer controls | Each toggle changes map content and legend consistently; hidden selected feature is cleared |
| Inspection | Building fallback height stays visual-only; absent road/POI properties display as unknown or are omitted |
| Error recovery | Blocking provider requests produces an intelligible degraded/failed state and retry, without inventing data |
| Search | Search scope is explicit; local preset/route/stop results select the correct feature or camera |
| Responsive shell | At desktop and narrow width, primary controls remain reachable and map has usable height |
| Attribution | Map attribution remains visible; transit/terrain provenance and coverage are accessible |

Meaningful automated tests should target the normalization and data pipeline boundaries: bounds validation, GTFS route-to-shape joins, coordinate order, duplicate shape handling, sparse/malformed source properties, estimated height labeling, and hidden-layer selection behavior. A small browser smoke flow should exercise mode switches and loading one LA and one OC view. Test content counts only when derived from the generated manifest; never hard-code a guessed network count.

## Implemented road catalogs and persistent highlights

The road directory is a lazy local Census index, gzip-decoded through the browser's DecompressionStream with raw JSON fallback. Geometry lives in 256 shards with an eight-shard memory cache. A name search and a municipal filter choose catalog records; neither reconstructs roads from visible tiles nor clips a selected corridor to the filter's city. Real Census polygons provide memberships and boundary crossings.

`roadSelections` and `selectedRoutes` are persistent session selections independent of the active view, region, agency browse filter and detail inspector. Each road request has its own AbortController. Adding one road preserves previous roads; removals and clear cancel pending requests. `focusedRoadId` is separate from the set so late results cannot take the camera away from a newer transit focus. Explicit transit `routeIds` select a union across agencies; the agency filter becomes the browse scope while highlights exist.

Road detail positions are topology endpoints, not fabricated directional termini; lengths sum source carriageways. Transit detail endpoints use GTFS stop_sequence and lengths report min/max individual source shapes, not all alternatives summed together. See [road details](road-details.md) and [transit details](transit-details.md).

## Further extension

Add another region as data/config, without branching UI code on individual county IDs. Large new overlays graduate from GeoJSON to vector tiles. A future road-detail service may expose original OSM tags such as lane count and speed limits that the basemap schema omits. A future editor needs an explicit draft model, undo/redo, and local export; it must not silently modify real map data.

## SoCal scope and navigation update

`county-regions.json` is generated from official county polygons and drives the default SoCal overview plus county navigation. `startupSettings` deliberately ignores former neighborhood / mode / 3D state so every visit starts north-up and flat. Input-mode preferences remain local. Wheel events on the map canvas are owned by `navigation.ts`; scrollable UI is outside that surface.

Regional roads are stored in Git as gzip snapshots. `materialize-road-data.mjs` verifies required assets and restores ignored raw JSON before dev/build/preview. The browser prefers compressed data and caches geometry shards. Overlap geometry is calculated by cancellable workers, with style image registration restored across style changes. See the dedicated navigation and overlap documents.
