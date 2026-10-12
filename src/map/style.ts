import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { LayerSettings, TransitFilter, ViewMode } from "../types";
import type { RouteOverlapResult } from "./routeOverlap";
import { routeOverlapStyle } from "./overlapStyle";
import { PLACES } from "../data/regions";
import {
  activeRoadSelections,
  roadOverlayStyle,
  type RoadStyleOptions,
} from "./roadStyle";

export const EMPTY_COLLECTION = {
  type: "FeatureCollection" as const,
  features: [],
};
// Curated navigation reference points keep regional orientation readable even
// when low-zoom vector tiles omit smaller county hubs. These are not centroids.
const OVERVIEW_PLACES = {
  type: "FeatureCollection" as const,
  features: PLACES.filter((place) => place.category === "城市中心").map(
    (place) => ({
      type: "Feature" as const,
      properties: {
        name: place.name.replace(/^Downtown /, ""),
        priority: place.id === "dtla" || place.id === "san-diego" ? 0 : 1,
      },
      geometry: { type: "Point" as const, coordinates: place.center },
    }),
  ),
};
const font = ["Noto Sans Regular"];
const name: ExpressionSpecification = [
  "coalesce",
  ["get", "name:en"],
  ["get", "name_en"],
  ["get", "name"],
  "",
];
const interpolate = (...stops: number[]): ExpressionSpecification => [
  "interpolate",
  ["linear"],
  ["zoom"],
  ...stops,
];
const cls = (classes: string[]): ExpressionSpecification => [
  "in",
  ["get", "class"],
  ["literal", classes],
];

export const ROAD_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "path",
  "track",
];
// OpenMapTiles rank is local importance within a tile grid, not a rating.
// Missing ranks remain hidden at overview zooms, then every mapped POI appears.
const poiDensity: FilterSpecification = [
  "step",
  ["zoom"],
  ["<=", ["coalesce", ["get", "rank"], 999], 5],
  16,
  ["<=", ["coalesce", ["get", "rank"], 999], 15],
  18,
  true,
];

export function transitFilters(filter: TransitFilter): {
  routes: FilterSpecification;
  stops: FilterSpecification;
} {
  const agency: FilterSpecification = filter.agencyIds.length
    ? ["in", ["get", "agencyId"], ["literal", filter.agencyIds]]
    : ["has", "agencyId"];
  if (filter.routeIds !== undefined) {
    const ids = [...new Set(filter.routeIds)];
    return ids.length
      ? {
          routes: ["in", ["get", "id"], ["literal", ids]],
          stops: [
            "any",
            ...ids.map(
              (id) =>
                [
                  "in",
                  id,
                  ["coalesce", ["get", "routeIds"], ["literal", []]],
                ] as ExpressionSpecification,
            ),
          ],
        }
      : { routes: agency, stops: agency };
  }
  return {
    routes: filter.routeId
      ? ["all", agency, ["==", ["get", "id"], filter.routeId]]
      : agency,
    stops: filter.routeId
      ? ["all", agency, ["in", filter.routeId, ["get", "routeIds"]]]
      : agency,
  };
}

/** Only explicit selections override the source's original agency color. */
export function transitHighlightColor(
  filter: TransitFilter,
  stops = false,
): ExpressionSpecification {
  const fallback: ExpressionSpecification | string = stops
    ? "#34747d"
    : ["coalesce", ["get", "color"], "#268d9c"];
  const ids = filter.routeIds ?? (filter.routeId ? [filter.routeId] : []);
  const selected = [...new Set(ids)].filter((id) => filter.routeColors?.[id]);
  if (!selected.length)
    return typeof fallback === "string" ? ["literal", fallback] : fallback;
  return stops
    ? ([
        "case",
        ...selected.flatMap((id) => [
          ["in", id, ["coalesce", ["get", "routeIds"], ["literal", []]]],
          filter.routeColors![id],
        ]),
        fallback,
      ] as ExpressionSpecification)
    : [
        "match",
        ["get", "id"],
        selected[0],
        filter.routeColors![selected[0]],
        ...selected.slice(1).flatMap((id) => [id, filter.routeColors![id]]),
        fallback,
      ];
}

export function createMapStyle(
  mode: ViewMode,
  settings: LayerSettings,
  is3D: boolean,
  transitFilter: TransitFilter,
  roadOptions: RoadStyleOptions = {},
  overlaps?: RouteOverlapResult | null,
): StyleSpecification {
  const analysis = mode === "roads" || mode === "transit";
  const terrain = settings.terrain;
  const visible = (enabled: boolean) =>
    enabled ? ("visible" as const) : ("none" as const);
  const base = analysis ? "#e4e7e3" : "#aabb97";
  const roadOverlay = roadOverlayStyle(roadOptions);
  const overlapOverlay = routeOverlapStyle(overlaps);
  const isolateRoad = Boolean(
    activeRoadSelections(roadOptions).length && roadOptions.isolated,
  );
  const layers: LayerSpecification[] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": base },
    },
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "wood",
          analysis ? "#d2dbce" : "#82976f",
          "grass",
          analysis ? "#dde2d5" : "#acba8b",
          "sand",
          "#ded5b5",
          "rock",
          "#aea895",
          base,
        ],
        "fill-opacity": 0.86,
      },
    },
    {
      id: "landuse",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          ["residential", "suburb", "neighbourhood"],
          analysis ? "#eef0ec" : "#c9c9ae",
          ["industrial", "railway"],
          analysis ? "#dbdeda" : "#b6b3a5",
          ["commercial", "retail"],
          analysis ? "#e4e5de" : "#c1bdac",
          ["school", "university", "hospital"],
          analysis ? "#e4e8e2" : "#c3c5b3",
          ["cemetery", "pitch", "playground"],
          analysis ? "#d5dfcf" : "#91a57c",
          base,
        ],
        "fill-opacity": 0.68,
      },
    },
    {
      id: "parks",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: {
        "fill-color": analysis ? "#d1deca" : "#8ca779",
        "fill-opacity": 0.47,
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": analysis ? "#aac7d0" : "#699dac" },
    },
    {
      id: "waterways",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      paint: {
        "line-color": analysis ? "#9cbec9" : "#699dac",
        "line-width": interpolate(8, 0.5, 16, 3),
      },
    },
    {
      id: "aeroway",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "aeroway",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#b4b4a8", "fill-opacity": 0.8 },
    },
    {
      id: "county-boundaries",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      minzoom: 7,
      filter: [
        "all",
        ["==", ["get", "admin_level"], 6],
        ["!=", ["get", "maritime"], 1],
      ],
      paint: {
        "line-color": "#7a8278",
        "line-opacity": 0.45,
        "line-width": 1,
        "line-dasharray": [3, 3],
      },
    },
    {
      id: "buildings",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      layout: { visibility: visible(settings.buildings && !is3D) },
      paint: {
        "fill-color": analysis ? "#c5cac5" : "#dedbcb",
        "fill-outline-color": analysis ? "#adb7ad" : "#b2b3a2",
        "fill-opacity": mode === "transit" ? 0.48 : 0.9,
      },
    },
    {
      id: "buildings-3d",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      filter: ["!=", ["get", "hide_3d"], true],
      layout: { visibility: visible(settings.buildings && is3D) },
      paint: {
        "fill-extrusion-color": analysis ? "#c5cac5" : "#e1dfd1",
        "fill-extrusion-height": [
          "max",
          3,
          ["to-number", ["get", "render_height"], 3],
        ],
        "fill-extrusion-base": [
          "max",
          0,
          ["to-number", ["get", "render_min_height"], 0],
        ],
        "fill-extrusion-opacity": 0.94,
      },
    },
  ];

  if (terrain)
    layers.splice(3, 0, {
      id: "hillshade",
      type: "hillshade",
      source: "hillshade",
      paint: {
        "hillshade-exaggeration": 0.35,
        "hillshade-shadow-color": "#5d614a",
        "hillshade-highlight-color": "#eee9cf",
        "hillshade-accent-color": "#637357",
      },
    });

  layers.push(...roadOverlay.cityLayers);

  // Bridges are ordered above surface streets, which are above tunnels.
  for (const level of ["tunnel", "surface", "bridge"]) {
    for (const group of ["local", "arterial", "highway"]) {
      const classes =
        group === "highway"
          ? ["motorway", "trunk"]
          : group === "arterial"
            ? ["primary", "secondary", "tertiary"]
            : ["minor", "service", "path", "track"];
      const levelFilter: ExpressionSpecification =
        level === "surface"
          ? ["!", ["in", ["get", "brunnel"], ["literal", ["tunnel", "bridge"]]]]
          : ["==", ["get", "brunnel"], level];
      const filter: FilterSpecification = [
        "all",
        ["==", ["geometry-type"], "LineString"],
        cls(classes),
        levelFilter,
      ];
      const enabled =
        !isolateRoad &&
        (group === "highway" ? settings.highways : settings.roads);
      const width =
        group === "highway"
          ? [5, 0.7, 9, 2, 13, 5, 16, 11, 19, 23]
          : group === "arterial"
            ? [8, 0.4, 11, 1.2, 14, 3.3, 16, 7, 19, 17]
            : [11, 0.2, 13, 0.7, 15, 2.2, 17, 6, 19, 14];
      const casingWidth = width.map((n, i) =>
        i % 2 ? n + (level === "bridge" ? 2.5 : 1.1) : n,
      );
      const color =
        mode === "roads"
          ? group === "highway"
            ? "#d19b52"
            : group === "arterial"
              ? "#e0bb71"
              : "#fafaf5"
          : mode === "transit"
            ? group === "highway"
              ? "#bcc5bf"
              : "#f8f9f5"
            : group === "highway"
              ? "#888d84"
              : group === "arterial"
                ? "#c2c3b9"
                : "#dadbd0";
      for (const casing of [true, false]) {
        layers.push({
          id: `road-${level}-${group}-${casing ? "casing" : "fill"}`,
          type: "line",
          source: "openmaptiles",
          "source-layer": "transportation",
          minzoom: group === "local" ? 11 : group === "arterial" ? 8 : 5,
          filter,
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: visible(enabled),
          },
          paint: {
            "line-color": casing
              ? level === "bridge"
                ? "#677367"
                : analysis
                  ? "#adb7ac"
                  : "#7c8975"
              : color,
            "line-width": interpolate(...(casing ? casingWidth : width)),
            "line-opacity":
              level === "tunnel" ? 0.43 : mode === "terrain" ? 0.65 : 1,
            ...(level === "tunnel" && !casing
              ? { "line-dasharray": [3, 2] }
              : {}),
          },
        });
      }
    }
  }

  layers.push({
    id: "rail",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 9,
    filter: cls(["rail", "transit"]),
    layout: { visibility: visible(settings.rail) },
    paint: {
      "line-color": "#586b63",
      "line-width": interpolate(9, 0.8, 15, 2.2, 18, 4),
      "line-dasharray": [3, 2],
      "line-opacity": 0.75,
    },
  });
  // Keep all line solids underneath shared corridor patterns and all labels.
  layers.push(
    ...roadOverlay.roadLayers.filter((layer) => layer.type === "line"),
  );
  const filters = transitFilters(transitFilter);
  const selectedTransit = Boolean(
    transitFilter.routeIds?.length ||
      (transitFilter.routeIds === undefined && transitFilter.routeId),
  );
  layers.push(
    {
      id: "transit-route-casing",
      type: "line",
      source: "transit-routes",
      filter: filters.routes,
      layout: {
        visibility: visible(settings.transit),
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#fffdf4",
        "line-width": interpolate(7, 2.7, 12, 4.8, 17, 8),
        "line-opacity": mode === "transit" || selectedTransit ? 0.95 : 0.65,
      },
    },
    {
      id: "transit-routes",
      type: "line",
      source: "transit-routes",
      filter: filters.routes,
      layout: {
        visibility: visible(settings.transit),
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": transitHighlightColor(transitFilter),
        "line-width": interpolate(7, 1.5, 12, 2.8, 17, 5.5),
        "line-opacity": mode === "transit" || selectedTransit ? 1 : 0.72,
      },
    },
    ...overlapOverlay.layers,
    ...roadOverlay.roadLayers.filter((layer) => layer.type !== "line"),
    {
      id: "transit-stops",
      type: "circle",
      source: "transit-stops",
      minzoom: 12,
      filter: filters.stops,
      layout: { visibility: visible(settings.transit) },
      paint: {
        "circle-color": "#fbfff7",
        "circle-stroke-color": transitHighlightColor(transitFilter, true),
        "circle-stroke-width": 1.5,
        "circle-radius": interpolate(12, 2, 16, 4.5, 19, 6),
      },
    },
    {
      id: "poi",
      type: "circle",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 14,
      filter: poiDensity,
      layout: { visibility: visible(settings.pois) },
      paint: {
        "circle-radius": interpolate(14, 2, 18, 4),
        "circle-color": [
          "match",
          ["get", "class"],
          ["hospital", "pharmacy"],
          "#d27666",
          ["school", "college", "library"],
          "#7683ba",
          ["park", "attraction"],
          "#598369",
          "#698b8b",
        ],
        "circle-stroke-color": "#fcfbeb",
        "circle-stroke-width": 1.1,
      },
    },
    {
      id: "poi-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 15,
      filter: poiDensity,
      layout: {
        visibility: visible(settings.pois && settings.labels),
        "text-field": name,
        "text-font": font,
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 8,
      },
      paint: {
        "text-color": "#415d54",
        "text-halo-color": "#f1f2e7",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "road-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 12,
      filter: ["all", ["!", cls(["motorway", "trunk"])], cls(ROAD_CLASSES)],
      layout: {
        visibility: visible(settings.labels && settings.roads && !isolateRoad),
        "symbol-placement": "line",
        "text-field": name,
        "text-font": font,
        "text-size": interpolate(12, 10, 17, 12.5),
        "symbol-spacing": 280,
      },
      paint: {
        "text-color": "#4a564c",
        "text-halo-color": analysis ? "#f5f6f1" : "#d9ddca",
        "text-halo-width": 1.3,
      },
    },
    {
      id: "highway-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 8,
      filter: cls(["motorway", "trunk"]),
      layout: {
        visibility: visible(
          settings.labels && settings.highways && !isolateRoad,
        ),
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "ref"], name],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "symbol-spacing": 330,
        "text-padding": 8,
      },
      paint: {
        "text-color": "#f8faed",
        "text-halo-color": "#687c72",
        "text-halo-width": 2.5,
      },
    },
    {
      id: "transit-stop-labels",
      type: "symbol",
      source: "transit-stops",
      minzoom: 15,
      filter: filters.stops,
      layout: {
        visibility: visible(settings.transit && settings.labels),
        "text-field": ["get", "name"],
        "text-font": font,
        "text-size": 10.5,
        "text-offset": [0.7, 0],
        "text-anchor": "left",
        "text-max-width": 12,
      },
      paint: {
        "text-color": "#2d6571",
        "text-halo-color": "#f9fbf4",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "overview-city-labels",
      type: "symbol",
      source: "overview-places",
      minzoom: 5,
      maxzoom: 9,
      layout: {
        visibility: visible(settings.labels),
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": interpolate(5, 11, 8, 15),
        "text-padding": 8,
        "text-max-width": 12,
        "symbol-sort-key": ["get", "priority"],
      },
      paint: {
        "text-color": "#253c35",
        "text-halo-color": "#f0f3e8",
        "text-halo-width": 2,
      },
    },
    {
      id: "city-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: cls(["city", "town", "village"]),
      minzoom: 9,
      maxzoom: 14,
      layout: {
        visibility: visible(settings.labels),
        "text-field": ["upcase", name],
        "text-font": ["Noto Sans Bold"],
        "text-size": interpolate(6, 10, 10, 13, 13, 17),
        "text-letter-spacing": 0.13,
        "text-max-width": 9,
        "text-padding": 18,
      },
      paint: {
        "text-color": "#3c534b",
        "text-halo-color": analysis ? "#e9ede5" : "#d3dcc5",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "neighborhood-labels",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 11,
      filter: cls(["suburb", "neighbourhood", "quarter"]),
      layout: {
        visibility: visible(settings.labels),
        "text-field": ["upcase", name],
        "text-font": font,
        "text-size": 10,
        "text-letter-spacing": 0.15,
        "text-max-width": 10,
        "text-padding": 16,
      },
      paint: {
        "text-color": "#607566",
        "text-halo-color": "#dfe4d5",
        "text-halo-width": 1.3,
      },
    },
    {
      id: "selection-fill",
      type: "fill",
      source: "selection",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#66e3cf", "fill-opacity": 0.3 },
    },
    {
      id: "selection-line",
      type: "line",
      source: "selection",
      filter: ["!=", ["geometry-type"], "Point"],
      paint: { "line-color": "#16b8a4", "line-width": 4, "line-opacity": 0.92 },
    },
    {
      id: "selection-point",
      type: "circle",
      source: "selection",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 8,
        "circle-color": "#16b8a4",
        "circle-opacity": 0.3,
        "circle-stroke-color": "#087d70",
        "circle-stroke-width": 2,
      },
    },
  );
  return {
    version: 8,
    name: "SoCal Atlas · Transportation View",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
      },
      "transit-routes": {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/transit-routes.geojson`,
        attribution: "Transit: official SoCal agency GTFS",
      },
      "transit-stops": {
        type: "geojson",
        data: `${import.meta.env.BASE_URL}data/transit-stops.geojson`,
      },
      "overview-places": { type: "geojson", data: OVERVIEW_PLACES },
      selection: { type: "geojson", data: EMPTY_COLLECTION },
      ...roadOverlay.sources,
      ...overlapOverlay.sources,
      ...(terrain
        ? {
            terrain: {
              type: "raster-dem" as const,
              url: "https://tiles.mapterhorn.com/tilejson.json",
              encoding: "terrarium" as const,
              tileSize: 512,
            },
            hillshade: {
              type: "raster-dem" as const,
              url: "https://tiles.mapterhorn.com/tilejson.json",
              encoding: "terrarium" as const,
              tileSize: 512,
            },
          }
        : {}),
    },
    layers,
    ...(terrain && is3D
      ? { terrain: { source: "terrain", exaggeration: 1.15 } }
      : {}),
    light: {
      anchor: "viewport",
      color: "#fff9e9",
      intensity: 0.42,
      position: [1.15, 210, 42],
    },
    transition: { duration: 250, delay: 0 },
  };
}
