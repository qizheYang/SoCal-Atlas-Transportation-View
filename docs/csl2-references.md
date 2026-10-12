# Cities: Skylines II reference study

Research date: 2026-10-12. These are design references, not a claim that every pictured feature reflects the latest game build. Official images were inspected visually from the linked dev diaries. Game screenshots are not bundled as application assets.

## 1. Editor composition

The [official Map Editor diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/modding/dev-diary-2-map-editor) shows a large, uninterrupted oblique terrain viewport, a compact workspace tree on the left, a tall property inspector on the right, tools near the bottom center, and a shallow bottom status/control strip. The editor exposes map, climate, water, resources, terrain, and object functions. Its normal terrain rendering uses muted grass greens, blue water, and atmospheric distance, rather than a dark cartographic basemap. Selected workspace rows use an amber fill; panels are dark blue-gray and translucent.

Inspected [editor screenshot](https://images.ctfassets.net/u73tyf0fa8v1/1tX2zZcSqs8nLJKJXkpbPc/9bf50fd918b4655a4fe9a01baec349f2/1_Empty_map.png?fm=webp&q=75&w=1920).

**Application decisions:** keep the viewport dominant; use a collapsible layer/workspace panel, context inspector, and small bottom mode dock. Provide a useful initial oblique camera but preserve a one-click north-up 2D view. Use original icons and styling. The V1 workspace concerns viewing layers and selecting features, not editable simulation terrain.

## 2. Road hierarchy and inspection

[Road Tools](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/road-tools) distinguishes small, medium, large, and highway networks, with separate pedestrian facilities and dedicated public-transport infrastructure. Its visuals make the road surface, hierarchy, junctions, and direction easy to perceive. Large interchanges and parallel carriageways are part of the visual identity.

Inspected [road scene](https://images.ctfassets.net/u73tyf0fa8v1/2d30qCZu63NaSDZL9aZVku/57c99ab652136ba0ac3137d796653fd4/cities-skylines-ii-road-tools-8_Roads.jpg?fm=webp&q=75&w=1920).

**Application decisions:** distinguish highway, arterial, local street, service road, and path at appropriate zoom levels. Keep highways legible at regional zoom; progressively reveal residential streets, rail, buildings, and POIs. Selecting a road should highlight its actual source geometry and show its name/reference, class, and any genuinely available attributes. Show one-way direction only when the source encodes it. Do not infer lane counts from line width or depict unsupported grade-separated topology as surveyed detail.

## 3. Analytical info views

[Traffic AI](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai) separates a citywide traffic view from road inspection. Traffic flow, volume, and road condition are different measures. In the inspected road screenshot, most geometry is grayscale and the measured road becomes an intense thematic color; the floating panel includes a labeled legend.

Inspected [road infoview](https://images.ctfassets.net/u73tyf0fa8v1/5hojqhdR4euAdvtp7r4bdH/9f97a3dea3bacb783ed39d550100a2ab/Cities-skylines-ii-traffic-ai9.png?fm=webp&q=75&w=1920).

**Application decisions:** implement deliberate city and analysis modes. The road analysis view should tint by factual road class in V1 and clearly label that measure. Do not generate green/red congestion, road-condition scores, traffic counters, or animated live-looking vehicles without an actual data source. The selected road gets a visible outline independent of its thematic color; the legend must remain accessible.

## 4. Public transportation

[Public & Cargo Transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation) connects a system overview to individual line details. Its transport infoview reduces buildings to pale ivory, retains dark slate roads, and emphasizes colored lines plus bright stop/service icons. The line panel adds a stop diagram and line statistics.

Inspected [transport infoview](https://images.ctfassets.net/u73tyf0fa8v1/3ylzHtJIOIISfQwP5gcAJJ/6fa91ef2aa955111781846f0da282741/15_Infoview.png?fm=webp&q=75&w=1920) and [line inspector](https://images.ctfassets.net/u73tyf0fa8v1/7aIyRCpAtFkhrdKdMVlp6o/c452a828b1495b99dfc8de61505d81b5/17_Line_view.png?fm=webp&q=75&w=1920).

**Application decisions:** use recognizable agency/route colors where licensed source data supplies them, group routes by agency/mode, select lines from the map or panel, and show their stops. Ground line length and stop count in source geometries/data. Label GTFS as scheduled service, not real-time vehicles. A future live source can add separately labeled vehicle positions and freshness. Rail infrastructure and scheduled passenger services are distinct layers.

## 5. Route selection behavior

[Detailer’s Patch #2](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/detailers-patch-2) describes traffic routes reached through the selected-item panel, with separate mode colors and line width proportional to simulated traffic. The inspected scene shows cyan routes remaining attached to real road paths while the surrounding city retains natural colors.

Inspected [traffic routes screenshot](https://images.ctfassets.net/u73tyf0fa8v1/5BRD6jNBVf6VxQEHGQLJCr/ba3aa828e69c81dd6a4a28fbb1ec7128/Detailer_s_Patch_2_-_1_Traffic_Routes.png?fm=webp&q=75&w=1920).

**Application decisions:** carry this selected-object-to-network relationship into roads and public transit. Selecting a route can dim unrelated lines and frame the route bounds; closing the inspector restores the prior overview. Do not label route widths as volume unless volume is known. A real-world viewer cannot derive individual travel demand or vehicle journeys from OSM.

## 6. Camera and presentation

[Cinematic Camera & Photo Mode](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/cinematic-camera-photo-mode) treats camera position, rotation, appearance, weather, and environment as separate controls.

**Application decisions:** V1 needs only rotate, tilt, zoom, reset north, 2D/3D, and selected-place focus. Building extrusions with a restrained directional light can suggest a city model; they are not photogrammetry. Actual heights and inferred/default heights must be distinguished. Terrain shading is optional and should not interfere with street and route legibility.

## Proposed V1 visual system

These values are original implementation choices informed by the visual study, not sampled game assets:

| Element | Proposed treatment |
| --- | --- |
| Panel surface | Deep slate/navy, subtly translucent, thin cool border |
| Main accent | Cyan for focus and selected map features |
| Secondary accent | Amber for selected workspace/mode control |
| Natural map | Muted olive/sage vegetation, dusty neutral urban land, blue water |
| Analysis map | Ivory buildings, subdued neutral ground, slate roads |
| Buildings | Low-saturation extrusions, fine footprint outline, height-aware only when supported |
| Roads | Dark asphalt with lighter casing; width and casing encode road class |
| Transport | Route-specific colors; stop symbols visible at useful zoom; selected line stronger |
| Labels | Clean sans-serif, high-contrast halo, restrained density |
| Region controls | LA + Orange County, with named locations for camera bookmarks |

## Acceptance criteria and scope

- The default view visibly depicts real LA/OC geometry and offers useful neighborhood-level detail after zooming.
- Roads, highways, ordinary building footprints, POIs, and public transportation have independent layer controls.
- Features with attributes are inspectable; absent source attributes are omitted or marked unavailable.
- A road mode and a transit mode materially change the map emphasis and legend.
- 2D/3D changes the camera/building rendering; it does not claim photorealistic models or a traffic simulation.
- The UI retains data attribution and exposes source/freshness details without making the viewport a technical dashboard.
- Regional definitions and source adapters allow additional regions without redesigning the viewer.
- Future possibilities include actual road editing, route planning, realistic meshes, real-time traffic, and vehicles; none are implied by V1's editor-inspired appearance.
