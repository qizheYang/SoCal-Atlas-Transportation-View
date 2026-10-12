import { describe, expect, it } from "vitest";
import {
  featureFilter,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection, MultiLineString, Polygon } from "geojson";
import { DEFAULT_LAYERS } from "../data/regions";
import { createMapStyle, transitFilters } from "./style";
import { combinedRoadGeometry, selectedCityFilter } from "./roadStyle";
import { describeFeature, selectionPriority } from "./inspect";

const geometry: FeatureCollection<MultiLineString> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        id: "main-1",
        name: "Main St",
        crossings: [{ coordinates: [-118, 34], cityIds: ["city-a", "city-b"] }],
      },
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [-118.1, 34],
            [-118, 34],
          ],
          [
            [-118, 34],
            [-117.9, 34],
          ],
        ],
      },
    },
  ],
};
const boundaries: FeatureCollection<Polygon> = {
  type: "FeatureCollection",
  features: ["city-a", "city-b", "city-c"].map((id, i) => ({
    type: "Feature",
    properties: {
      id,
      name: id,
      label: id,
      labelLng: -118 + i * 0.1,
      labelLat: 34,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-118, 34],
          [-117, 34],
          [-117, 35],
          [-118, 34],
        ],
      ],
    },
  })),
};
const selection = {
  id: "main-1",
  name: "Main St",
  cityIds: ["city-a", "city-b"],
  geometry,
};

describe("complete-road overlay and city boundaries", () => {
  it.each([false, true])(
    "validates road selection with isolated=%s and preserves all loaded geometry across style changes",
    (isolated) => {
      for (const is3D of [false, true]) {
        const style = createMapStyle(
          "roads",
          { ...DEFAULT_LAYERS, terrain: is3D },
          is3D,
          { agencyIds: [], routeId: null },
          { selection, isolated, showCityBoundaries: true, boundaries },
        );
        expect(validateStyleMin(style).map((error) => error.message)).toEqual(
          [],
        );
        const source = style.sources["selected-road"];
        expect(source.type).toBe("geojson");
        if (source.type !== "geojson")
          throw new Error("Missing complete-road source");
        expect(source.data).toBe(geometry);
        expect(
          style.layers.find((layer) => layer.id === "selected-road-line")
            ?.layout?.visibility,
        ).toBe("visible");
        for (const layer of style.layers.filter((item) =>
          /^road-(surface|tunnel|bridge)-/.test(item.id),
        )) {
          expect(layer.layout?.visibility).toBe(isolated ? "none" : "visible");
        }
        expect(
          style.layers.find((layer) => layer.id === "highway-labels")?.layout
            ?.visibility,
        ).toBe(isolated ? "none" : "visible");
      }
    },
  );

  it("filters municipal overlays by all crossed city IDs and restores roads when selection is cleared", () => {
    const filter = featureFilter(
      selectedCityFilter(selection.cityIds),
      "layers[0].filter",
    );
    expect(
      filter.filter(
        { zoom: 12 },
        { type: "Polygon", properties: { id: "city-a" } },
      ),
    ).toBe(true);
    expect(
      filter.filter(
        { zoom: 12 },
        { type: "Polygon", properties: { id: "city-b" } },
      ),
    ).toBe(true);
    expect(
      filter.filter(
        { zoom: 12 },
        { type: "Polygon", properties: { id: "city-c" } },
      ),
    ).toBe(false);
    const cleared = createMapStyle(
      "roads",
      DEFAULT_LAYERS,
      false,
      { agencyIds: [], routeId: null },
      {
        selection: null,
        isolated: true,
        boundaries,
        showCityBoundaries: false,
      },
    );
    expect(
      cleared.layers.find((layer) => layer.id === "road-surface-local-fill")
        ?.layout?.visibility,
    ).toBe("visible");
    expect(
      cleared.layers.find((layer) => layer.id === "selected-road-line")?.layout
        ?.visibility,
    ).toBe("none");
    expect(
      cleared.layers.find((layer) => layer.id === "road-city-boundaries")
        ?.layout?.visibility,
    ).toBe("none");
  });

  it("identifies full-road data separately from the clipped basemap features", () => {
    const feature = {
      source: "selected-road",
      sourceLayer: "",
      id: "main-1",
      properties: { name: "Main St" },
    };
    const result = describeFeature(feature, [-118, 34]);
    expect(result.kind).toBe("road");
    expect(result.name).toBe("Main St");
    expect(result.source).toMatch(/Census/);
    expect(result.properties.Geometry).toMatch(/Complete selected road/);
    expect(
      selectionPriority(
        { source: "selected-road", sourceLayer: "" } as Parameters<
          typeof selectionPriority
        >[0],
        "roads",
      ),
    ).toBeGreaterThan(100);
  });
});

describe("simultaneous road and transit selections", () => {
  const i5 = {
    ...selection,
    id: "i5",
    name: "I-5",
    highlightColor: "#098f83",
    cityIds: ["city-a", "city-b"],
  };
  const i10 = {
    ...selection,
    id: "i10",
    name: "I-10",
    highlightColor: "#d47a2c",
    cityIds: ["city-b", "city-c"],
  };

  it("retains I-5, I-10, and A Line together with per-road colors and every crossed city", () => {
    const style = createMapStyle(
      "roads",
      { ...DEFAULT_LAYERS, transit: true },
      false,
      { agencyIds: ["octa"], routeId: "octa:43", routeIds: ["metro-rail:A"] },
      {
        selections: [i5, i10],
        isolated: true,
        showCityBoundaries: true,
        boundaries,
      },
    );
    expect(validateStyleMin(style).map((error) => error.message)).toEqual([]);
    const source = style.sources["selected-road"];
    if (
      source.type !== "geojson" ||
      typeof source.data === "string" ||
      source.data.type !== "FeatureCollection"
    )
      throw new Error("Missing multi-road collection");
    expect(
      source.data.features.map((feature) => [
        feature.properties?.roadId,
        feature.properties?.name,
        feature.properties?.highlightColor,
      ]),
    ).toEqual([
      ["i5", "I-5", "#098f83"],
      ["i10", "I-10", "#d47a2c"],
    ]);
    expect(source.data.features[0].geometry).toBe(
      geometry.features[0].geometry,
    );
    expect(source.data.features[1].geometry).toBe(
      geometry.features[0].geometry,
    );
    const cityLayer = style.layers.find(
      (layer) => layer.id === "road-city-fill",
    );
    if (!cityLayer || !("filter" in cityLayer))
      throw new Error("Missing city overlay");
    const cities = featureFilter(cityLayer.filter, "layers[0].filter");
    for (const id of ["city-a", "city-b", "city-c"])
      expect(
        cities.filter({ zoom: 12 }, { type: "Polygon", properties: { id } }),
      ).toBe(true);
    const transitLayer = style.layers.find(
      (layer) => layer.id === "transit-routes",
    );
    if (!transitLayer || !("filter" in transitLayer))
      throw new Error("Missing selected transit");
    expect(transitLayer.layout?.visibility).toBe("visible");
    const transit = featureFilter(transitLayer.filter, "layers[0].filter");
    expect(
      transit.filter(
        { zoom: 12 },
        {
          type: "LineString",
          properties: { id: "metro-rail:A", agencyId: "metro-rail" },
        },
      ),
    ).toBe(true);
    expect(
      transit.filter(
        { zoom: 12 },
        { type: "LineString", properties: { id: "octa:43", agencyId: "octa" } },
      ),
    ).toBe(false);
    expect(
      style.layers.findIndex((layer) => layer.id === "transit-routes"),
    ).toBeGreaterThan(
      style.layers.findIndex((layer) => layer.id === "selected-road-line"),
    );
  });

  it("selects route and stop unions across agencies despite the agency browser filter", () => {
    const selected = transitFilters({
      agencyIds: ["metrolink"],
      routeId: "legacy",
      routeIds: ["metro-rail:A", "octa:43"],
    });
    const routes = featureFilter(selected.routes, "layers[0].filter");
    for (const [id, agencyId] of [
      ["metro-rail:A", "metro-rail"],
      ["octa:43", "octa"],
    ])
      expect(
        routes.filter(
          { zoom: 12 },
          { type: "LineString", properties: { id, agencyId } },
        ),
      ).toBe(true);
    expect(
      routes.filter(
        { zoom: 12 },
        {
          type: "LineString",
          properties: { id: "legacy", agencyId: "metrolink" },
        },
      ),
    ).toBe(false);
    const stops = featureFilter(selected.stops, "layers[0].filter");
    for (const routeIds of [
      ["metro-rail:A"],
      ["octa:43", "octa:57"],
      ["metro-rail:A", "octa:43"],
    ])
      expect(
        stops.filter(
          { zoom: 12 },
          { type: "Point", properties: { agencyId: "different", routeIds } },
        ),
      ).toBe(true);
    expect(
      stops.filter(
        { zoom: 12 },
        { type: "Point", properties: { routeIds: ["octa:57"] } },
      ),
    ).toBe(false);
    expect(stops.filter({ zoom: 12 }, { type: "Point", properties: {} })).toBe(
      false,
    );
    const roadPriority = selectionPriority(
      { source: "selected-road" } as Parameters<typeof selectionPriority>[0],
      "transit",
    );
    const routePriority = selectionPriority(
      { source: "transit-routes" } as Parameters<typeof selectionPriority>[0],
      "transit",
    );
    expect(routePriority).toBeGreaterThan(roadPriority);
  });

  it("keeps another road's geometry and fallback color when removing one selection", () => {
    const before = JSON.stringify(geometry);
    const uncoloredI5 = { ...i5, highlightColor: undefined };
    const uncoloredI10 = { ...i10, highlightColor: undefined };
    const both = combinedRoadGeometry([uncoloredI5, uncoloredI10]);
    const remaining = combinedRoadGeometry([uncoloredI10]);
    expect(remaining.features).toHaveLength(1);
    expect(remaining.features[0]).toEqual(both.features[1]);
    expect(JSON.stringify(geometry)).toBe(before);
  });

  it("uses an explicit empty selection list to clear the legacy selection", () => {
    const cleared = createMapStyle(
      "roads",
      DEFAULT_LAYERS,
      false,
      { agencyIds: ["octa"], routeId: "legacy", routeIds: [] },
      { selection: i5, selections: [], isolated: true },
    );
    expect(
      cleared.layers.find((layer) => layer.id === "selected-road-line")?.layout
        ?.visibility,
    ).toBe("none");
    expect(
      cleared.layers.find((layer) => layer.id === "road-surface-highway-fill")
        ?.layout?.visibility,
    ).toBe("visible");
    const transit = featureFilter(
      transitFilters({ agencyIds: ["octa"], routeId: "legacy", routeIds: [] })
        .routes,
      "layers[0].filter",
    );
    expect(
      transit.filter(
        { zoom: 12 },
        { type: "LineString", properties: { id: "octa:57", agencyId: "octa" } },
      ),
    ).toBe(true);
    expect(
      transit.filter(
        { zoom: 12 },
        {
          type: "LineString",
          properties: { id: "metro-rail:A", agencyId: "metro-rail" },
        },
      ),
    ).toBe(false);
  });
});
