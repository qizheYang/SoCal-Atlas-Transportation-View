import { describe, expect, it } from "vitest";
import {
  featureFilter,
  createExpression,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import { DEFAULT_LAYERS } from "../data/regions";
import { createMapStyle, transitFilters, transitHighlightColor } from "./style";
import { describeFeature } from "./inspect";
import type { ViewMode } from "../types";
import { computeRouteOverlaps } from "./routeOverlap";
import { OVERLAP_LAYER, OVERLAP_SOURCE } from "./overlapStyle";

describe("real-data map style", () => {
  it("uses per-selection comparison colors for lines and member stops while retaining source colors for agency browsing", () => {
    const filter = {
      agencyIds: [],
      routeId: null,
      routeIds: ["a", "b"],
      routeColors: { a: "#ef7d00", b: "#087e8b" },
    };
    const expression = createExpression(
      transitHighlightColor(filter),
      "line-color",
    );
    const stopExpression = createExpression(
      transitHighlightColor(filter, true),
      "circle-stroke-color",
    );
    if (expression.result !== "success" || stopExpression.result !== "success")
      throw new Error("Invalid color expression");
    expect(
      expression.value.evaluate(
        { zoom: 12 },
        { type: 2, properties: { id: "a", color: "#ef7d00" } },
      ),
    ).toBe("#ef7d00");
    expect(
      expression.value.evaluate(
        { zoom: 12 },
        { type: 2, properties: { id: "b", color: "#ef7d00" } },
      ),
    ).toBe("#087e8b");
    expect(
      expression.value.evaluate(
        { zoom: 12 },
        { type: 2, properties: { id: "c", color: "#aabbcc" } },
      ),
    ).toBe("#aabbcc");
    expect(
      stopExpression.value.evaluate(
        { zoom: 12 },
        { type: 1, properties: { routeIds: ["b"] } },
      ),
    ).toBe("#087e8b");
    const browse = createExpression(
      transitHighlightColor({ ...filter, routeIds: [] }),
      "line-color",
    );
    if (browse.result !== "success") throw new Error("Invalid browse color");
    expect(
      browse.value.evaluate(
        { zoom: 12 },
        { type: 2, properties: { id: "b", color: "#ef7d00" } },
      ),
    ).toBe("#ef7d00");
    expect(
      validateStyleMin(
        createMapStyle(
          "transit",
          { ...DEFAULT_LAYERS, transit: true },
          false,
          filter,
        ),
      ),
    ).toEqual([]);
  });
  it("always retains the overlap source and paints N-color corridors above solid lines but below labels", () => {
    const geometry = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [-118, 34],
              [-117.999, 34],
            ],
          },
        },
      ],
    };
    const overlaps = computeRouteOverlaps([
      { id: "a", color: "#f00", geometry },
      { id: "b", color: "#00f", geometry },
    ]);
    for (const mode of ["city", "roads", "transit", "terrain"] as ViewMode[]) {
      for (const is3D of [false, true]) {
        const style = createMapStyle(
          mode,
          { ...DEFAULT_LAYERS, transit: true },
          is3D,
          { agencyIds: [], routeId: null, routeIds: ["a", "b"] },
          {},
          overlaps,
        );
        expect(validateStyleMin(style)).toEqual([]);
        expect(style.sources[OVERLAP_SOURCE]).toMatchObject({
          type: "geojson",
          data: overlaps.geometry,
        });
        const ids = style.layers.map((layer) => layer.id);
        expect(ids.indexOf(OVERLAP_LAYER)).toBeGreaterThan(
          ids.indexOf("selected-road-line"),
        );
        expect(ids.indexOf(OVERLAP_LAYER)).toBeGreaterThan(
          ids.indexOf("transit-routes"),
        );
        expect(ids.indexOf(OVERLAP_LAYER)).toBeLessThan(
          ids.indexOf("selected-road-labels"),
        );
        expect(ids.indexOf(OVERLAP_LAYER)).toBeLessThan(
          ids.indexOf("transit-stops"),
        );
      }
    }
    const empty = createMapStyle("city", DEFAULT_LAYERS, false, {
      agencyIds: [],
      routeId: null,
    });
    expect(empty.sources[OVERLAP_SOURCE]).toBeDefined();
    expect(empty.layers.some((layer) => layer.id === OVERLAP_LAYER)).toBe(true);
  });

  it("provides named major-city anchors at overview zoom without depending on low-zoom vector tile labels", () => {
    const style = createMapStyle("city", DEFAULT_LAYERS, false, {
      agencyIds: [],
      routeId: null,
    });
    const source = style.sources["overview-places"];
    if (
      source.type !== "geojson" ||
      typeof source.data !== "object" ||
      source.data.type !== "FeatureCollection"
    )
      throw new Error("Missing overview places");
    const names = source.data.features.map(
      (feature) => feature.properties?.name,
    );
    expect(names).toContain("Los Angeles");
    expect(names).toContain("Santa Ana");
    expect(names).toContain("San Diego");
    expect(
      style.layers.find((layer) => layer.id === "overview-city-labels"),
    ).toMatchObject({ minzoom: 5, maxzoom: 9 });
    expect(
      style.layers.find((layer) => layer.id === "city-labels"),
    ).toMatchObject({ minzoom: 9 });
  });
  it.each(["city", "roads", "transit", "terrain"] as ViewMode[])(
    "validates %s in flat and terrain perspective modes",
    (mode) => {
      for (const perspective of [false, true]) {
        const style = createMapStyle(
          mode,
          { ...DEFAULT_LAYERS, terrain: perspective },
          perspective,
          { agencyIds: [], routeId: null },
        );
        expect(validateStyleMin(style).map((error) => error.message)).toEqual(
          [],
        );
      }
    },
  );

  it("uses all agencies for an empty agency selection and limits stops by their actual route membership", () => {
    const all = featureFilter(
      transitFilters({ agencyIds: [], routeId: null }).routes,
      "layers[0].filter",
    );
    expect(
      all.filter(
        { zoom: 12 },
        { type: "LineString", properties: { agencyId: "octa" } },
      ),
    ).toBe(true);
    const scoped = featureFilter(
      transitFilters({ agencyIds: ["octa"], routeId: "octa:43" }).stops,
      "layers[0].filter",
    );
    expect(
      scoped.filter(
        { zoom: 12 },
        {
          type: "Point",
          properties: { agencyId: "octa", routeIds: ["octa:43", "octa:57"] },
        },
      ),
    ).toBe(true);
    expect(
      scoped.filter(
        { zoom: 12 },
        {
          type: "Point",
          properties: { agencyId: "octa", routeIds: ["octa:57"] },
        },
      ),
    ).toBe(false);
    expect(
      scoped.filter(
        { zoom: 12 },
        {
          type: "Point",
          properties: { agencyId: "metro-bus", routeIds: ["octa:43"] },
        },
      ),
    ).toBe(false);
  });

  it("reveals lower-priority POIs progressively and includes unranked POIs at street detail", () => {
    const style = createMapStyle("city", DEFAULT_LAYERS, true, {
      agencyIds: [],
      routeId: null,
    });
    const layer = style.layers.find((item) => item.id === "poi");
    if (!layer || !("filter" in layer)) throw new Error("POI layer missing");
    const filter = featureFilter(layer.filter, "layers[0].filter");
    expect(
      filter.filter({ zoom: 15 }, { type: "Point", properties: { rank: 6 } }),
    ).toBe(false);
    expect(
      filter.filter({ zoom: 15 }, { type: "Point", properties: { rank: 3 } }),
    ).toBe(true);
    expect(
      filter.filter({ zoom: 16 }, { type: "Point", properties: { rank: 12 } }),
    ).toBe(true);
    expect(
      filter.filter({ zoom: 16 }, { type: "Point", properties: { rank: 16 } }),
    ).toBe(false);
    expect(filter.filter({ zoom: 18 }, { type: "Point", properties: {} })).toBe(
      true,
    );
  });
});

describe("inspection evidence boundaries", () => {
  it("labels a render height as estimated and never presents a fallback as a measurement", () => {
    const base = { source: "openmaptiles", sourceLayer: "building", id: 1 };
    expect(
      describeFeature(
        { ...base, properties: { render_height: 44 } },
        [-118, 34],
      ).properties["Estimated render height"],
    ).toBe("44.0 m");
    const missing = describeFeature({ ...base, properties: {} }, [-118, 34]);
    expect(missing.properties["Estimated render height"]).toBeUndefined();
    expect(missing.properties.Height).toMatch(/Not available/);
  });

  it("does not invent a road name or lane count for a sparse tile geometry", () => {
    const road = describeFeature(
      {
        source: "openmaptiles",
        sourceLayer: "transportation",
        id: 1,
        properties: { class: "motorway", oneway: -1 },
      },
      [-118, 34],
    );
    expect(road.name).toBe("motorway segment");
    expect(road.properties.Name).toMatch(/Not included/);
    expect(road.properties["One-way"]).toBe("Against source geometry");
    expect(road.properties.Lanes).toBeUndefined();
  });
});
