import type {
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";
import { cityLabelPoints, roadBoundaryCrossings } from "./roadGeometry";

export interface RoadStyleOptions {
  selection?: RoadOverlaySelection | null;
  selections?: RoadOverlaySelection[];
  isolated?: boolean;
  showCityBoundaries?: boolean;
  boundaries?: FeatureCollection<Polygon | MultiPolygon> | null;
}

interface RoadOverlaySelection {
  id: string;
  name: string;
  cityIds: string[];
  geometry: FeatureCollection<LineString | MultiLineString>;
  highlightColor?: string;
}

export function activeRoadSelections(
  options: Pick<RoadStyleOptions, "selection" | "selections">,
): RoadOverlaySelection[] {
  return options.selections ?? (options.selection ? [options.selection] : []);
}

/** Copy display attributes while preserving the original segment geometry. */
export function combinedRoadGeometry(
  selections: RoadOverlaySelection[],
): FeatureCollection<LineString | MultiLineString> {
  return {
    type: "FeatureCollection",
    features: selections.flatMap((road) =>
      road.geometry.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          roadId: road.id,
          name: road.name,
          highlightColor:
            road.highlightColor ??
            ROAD_COLORS[
              Array.from(road.id).reduce(
                (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
                0,
              ) % ROAD_COLORS.length
            ],
        },
      })),
    ),
  };
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };
const ROAD_COLORS = [
  "#098f83",
  "#d47a2c",
  "#8462b4",
  "#c45f86",
  "#5e8e38",
  "#377eae",
];
const CITY_COLORS = [
  "#418b94",
  "#a17abd",
  "#bb795d",
  "#859340",
  "#5985b6",
  "#ad8840",
];

export function selectedCityFilter(cityIds: string[]): FilterSpecification {
  return ["in", ["get", "id"], ["literal", cityIds]];
}

/** Full source geometry remains intact; map styling never stitches visible tiles. */
export function roadOverlayStyle(options: RoadStyleOptions = {}): {
  sources: Record<string, SourceSpecification>;
  cityLayers: LayerSpecification[];
  roadLayers: LayerSpecification[];
} {
  const selections = activeRoadSelections(options);
  const selected = selections.length > 0;
  // Retain the singular source contract for existing callers. New selections
  // carry individual colors and names in their feature properties.
  const geometry =
    options.selections !== undefined
      ? combinedRoadGeometry(selections)
      : (options.selection?.geometry ?? EMPTY);
  const cityIds = [...new Set(selections.flatMap((road) => road.cityIds))];
  const cityFilter: FilterSpecification = selected
    ? selectedCityFilter(cityIds)
    : ["has", "id"];
  const showBoundaries = Boolean(
    options.showCityBoundaries && options.boundaries,
  );
  const boundaryVisibility = showBoundaries ? "visible" : "none";
  const cityColor: ExpressionSpecification | string = cityIds.length
    ? [
        "match",
        ["get", "id"],
        cityIds[0],
        CITY_COLORS[0],
        ...cityIds
          .slice(1)
          .flatMap((id, index) => [
            id,
            CITY_COLORS[(index + 1) % CITY_COLORS.length],
          ]),
        "#5e7c82",
      ]
    : "#63848b";
  const roadVisibility = selected ? "visible" : "none";
  return {
    sources: {
      "selected-road": {
        type: "geojson",
        data: geometry,
        attribution: "Road search: U.S. Census Bureau, TIGER/Line 2025",
      },
      "city-boundaries": {
        type: "geojson",
        data: options.boundaries ?? EMPTY,
        attribution: "City boundaries: U.S. Census Bureau, TIGERweb 2026",
      },
      "city-boundary-labels": {
        type: "geojson",
        data: cityLabelPoints(options.boundaries),
      },
      "road-boundary-crossings": {
        type: "geojson",
        data: roadBoundaryCrossings(geometry, options.boundaries),
      },
    },
    cityLayers: [
      {
        id: "road-city-fill",
        type: "fill",
        source: "city-boundaries",
        filter: cityFilter,
        layout: { visibility: boundaryVisibility },
        paint: {
          "fill-color": cityColor,
          "fill-opacity": selected ? 0.1 : 0.035,
        },
      },
      {
        id: "road-city-boundaries",
        type: "line",
        source: "city-boundaries",
        filter: cityFilter,
        layout: { visibility: boundaryVisibility },
        paint: {
          "line-color": cityColor,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            1.2,
            12,
            2,
            17,
            2.5,
          ],
          "line-dasharray": [4, 2],
          "line-opacity": 0.85,
        },
      },
    ],
    roadLayers: [
      {
        id: "selected-road-casing",
        type: "line",
        source: "selected-road",
        layout: {
          "line-cap": "round",
          "line-join": "round",
          visibility: roadVisibility,
        },
        paint: {
          "line-color": "#f9fff2",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            4,
            12,
            7.5,
            17,
            12,
          ],
          "line-opacity": 0.94,
        },
      },
      {
        id: "selected-road-line",
        type: "line",
        source: "selected-road",
        layout: {
          "line-cap": "round",
          "line-join": "round",
          visibility: roadVisibility,
        },
        paint: {
          "line-color": ["coalesce", ["get", "highlightColor"], "#098f83"],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            2.1,
            12,
            4.5,
            17,
            8,
          ],
          "line-opacity": 1,
        },
      },
      {
        id: "selected-road-labels",
        type: "symbol",
        source: "selected-road",
        minzoom: 9,
        layout: {
          visibility: roadVisibility,
          "symbol-placement": "line",
          "symbol-spacing": 450,
          "text-field": [
            "coalesce",
            ["get", "name"],
            options.selection?.name ?? "",
          ],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-padding": 12,
        },
        paint: {
          "text-color": ["coalesce", ["get", "highlightColor"], "#075a54"],
          "text-halo-color": "#f8fff4",
          "text-halo-width": 2,
        },
      },
      {
        id: "road-city-labels",
        type: "symbol",
        source: "city-boundary-labels",
        filter: cityFilter,
        minzoom: 8,
        layout: {
          visibility: boundaryVisibility,
          "text-field": ["coalesce", ["get", "label"], ["get", "name"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 13],
          "text-max-width": 12,
          "text-padding": 5,
        },
        paint: {
          "text-color": cityColor,
          "text-halo-color": "#fcfff6",
          "text-halo-width": 2,
        },
      },
      {
        id: "road-city-crossings",
        type: "circle",
        source: "road-boundary-crossings",
        layout: { visibility: boundaryVisibility },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            2.3,
            12,
            4.2,
            16,
            5.5,
          ],
          "circle-color": "#fafff1",
          "circle-stroke-color": "#735581",
          "circle-stroke-width": 1.8,
        },
      },
      {
        id: "road-city-crossing-labels",
        type: "symbol",
        source: "road-boundary-crossings",
        minzoom: 11,
        layout: {
          visibility: boundaryVisibility,
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10.5,
          "text-offset": [0, 1],
          "text-anchor": "top",
          "text-max-width": 16,
          "text-padding": 9,
        },
        paint: {
          "text-color": "#644574",
          "text-halo-color": "#fafff1",
          "text-halo-width": 2,
        },
      },
    ],
  };
}
