import { describe, expect, it } from "vitest";
import {
  cityLabelPoints,
  focusedRoadSelection,
  roadBoundaryCrossings,
  roadFitPadding,
  roadGeometryBounds,
} from "./roadGeometry";

describe("road geometry and camera framing", () => {
  it("auto-fits the focused road while retaining other selections and allows transit to take focus", () => {
    const roads = [{ id: "i5" }, { id: "i10" }];
    expect(focusedRoadSelection(roads, "i5")).toBe(roads[0]);
    expect(focusedRoadSelection(roads, "i10")).toBe(roads[1]);
    expect(focusedRoadSelection(roads, null)).toBeNull();
    expect(focusedRoadSelection(roads, "pending-road")).toBeNull();
    expect(focusedRoadSelection(roads)).toBe(roads[1]);
  });
  it("fits every disconnected segment and divided carriageway without changing geometry", () => {
    const roads = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "MultiLineString" as const,
            coordinates: [
              [
                [-118.7, 34.2],
                [-118.5, 34.1],
              ],
              [
                [-118.69, 34.21],
                [-118.49, 34.11],
              ],
              [
                [-117.6, 33.5],
                [-117.4, 33.4],
              ],
            ],
          },
        },
      ],
    };
    const original = JSON.stringify(roads);
    expect(roadGeometryBounds(roads)).toEqual([
      [-118.7, 33.4],
      [-117.4, 34.21],
    ]);
    expect(JSON.stringify(roads)).toBe(original);
    expect(
      roadGeometryBounds({ type: "FeatureCollection", features: [] }),
    ).toBeNull();
  });

  it("uses supplied interior city label points and skips missing coordinates", () => {
    const points = cityLabelPoints({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "irvine", labelLng: -117.82, labelLat: 33.69 },
          geometry: { type: "Polygon", coordinates: [] },
        },
        {
          type: "Feature",
          properties: { id: "missing" },
          geometry: { type: "Polygon", coordinates: [] },
        },
      ],
    });
    expect(points.features).toHaveLength(1);
    expect(points.features[0].geometry.coordinates).toEqual([-117.82, 33.69]);
  });

  it("accounts for both desktop panels and preserves space on a narrow display", () => {
    expect(
      roadFitPadding(1440, 900, [
        { left: 22, right: 302, top: 100, bottom: 788 },
        { left: 1059, right: 1361, top: 100, bottom: 620 },
      ]),
    ).toEqual({ left: 326, right: 405, top: 116, bottom: 155 });
    const mobile = roadFitPadding(390, 650, [
      { left: 14, right: 328, top: 170, bottom: 535 },
    ]);
    expect(390 - mobile.left - mobile.right).toBeGreaterThanOrEqual(180);
    expect(650 - mobile.top - mobile.bottom).toBeGreaterThan(180);
  });

  it("frames above a centered navigation dock without shrinking a horizontal edge", () => {
    const padding = roadFitPadding(1440, 900, [
      { left: 550, right: 890, top: 710, bottom: 880 },
    ]);
    expect(padding).toEqual({ left: 28, right: 28, top: 116, bottom: 214 });
  });

  it("marks real imported intersections and labels both sides of a city boundary", () => {
    const crossings = roadBoundaryCrossings(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              crossings: [
                { coordinates: [-118.02, 33.91], cityIds: ["a", "b"] },
                { coordinates: [null, 33.91], cityIds: ["a"] },
              ],
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [-118.1, 33.9],
                [-118, 33.92],
              ],
            },
          },
        ],
      },
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { id: "a", label: "Norwalk" },
            geometry: { type: "Polygon", coordinates: [] },
          },
          {
            type: "Feature",
            properties: { id: "b", label: "Santa Fe Springs" },
            geometry: { type: "Polygon", coordinates: [] },
          },
        ],
      },
    );
    expect(crossings.features).toHaveLength(1);
    expect(crossings.features[0].geometry.coordinates).toEqual([
      -118.02, 33.91,
    ]);
    expect(crossings.features[0].properties?.label).toBe(
      "Norwalk / Santa Fe Springs",
    );
  });
});
