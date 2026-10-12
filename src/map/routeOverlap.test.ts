import { describe, expect, it } from "vitest";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  computeRouteOverlaps,
  selectedOverlapRoutes,
  visibleOverlapTransitIds,
  type OverlapRoute,
} from "./routeOverlap";
import { createCheckerboardImage, routeOverlapStyle } from "./overlapStyle";

// Use meter coordinates near Los Angeles so assertions read as physical lengths.
const LON = -118;
const LAT = 34;
const M_LAT = (Math.PI * 6_371_008.8) / 180;
const M_LON = M_LAT * Math.cos((LAT * Math.PI) / 180);
const position = ([x, y]: number[]) => [LON + x / M_LON, LAT + y / M_LAT];
function route(
  id: string,
  lines: number[][][],
  color = "#12aabb",
): OverlapRoute {
  return {
    id,
    color,
    geometry: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiLineString",
            coordinates: lines.map((line) => line.map(position)),
          },
        },
      ],
    },
  };
}
function spans(result: ReturnType<typeof computeRouteOverlaps>) {
  return result.geometry.features
    .map((feature) => ({
      ids: feature.properties.memberIds.join(""),
      start: Math.round((feature.geometry.coordinates[0][0] - LON) * M_LON),
      end: Math.round((feature.geometry.coordinates.at(-1)![0] - LON) * M_LON),
    }))
    .sort((a, b) => a.start - b.start);
}

describe("selected route shared corridors", () => {
  it("uses selected transit comparison colors in checkerboards without changing GTFS agency colors", () => {
    const geometry = route("unused", [
      [
        [0, 0],
        [100, 0],
      ],
    ]).geometry;
    const transit: FeatureCollection<LineString | MultiLineString> = {
      type: "FeatureCollection",
      features: [
        { ...geometry.features[0], properties: { id: "a", color: "#ef7d00" } },
        { ...geometry.features[0], properties: { id: "b", color: "#ef7d00" } },
      ],
    };
    const before = JSON.stringify(transit);
    const selected = selectedOverlapRoutes([], transit, ["a", "b"], {
      a: "#ef7d00",
      b: "#087e8b",
    });
    const overlap = computeRouteOverlaps(selected);
    expect(overlap.patterns[0].colors).toEqual(["#ef7d00", "#087e8b"]);
    expect(JSON.stringify(transit)).toBe(before);
  });
  it("excludes hidden transit and agency-wide browsing from overlap membership", () => {
    expect(
      visibleOverlapTransitIds(
        { agencyIds: [], routeId: null, routeIds: ["a", "b"] },
        false,
      ),
    ).toEqual([]);
    expect(
      visibleOverlapTransitIds({ agencyIds: ["metro"], routeId: null }, true),
    ).toEqual([]);
    expect(
      visibleOverlapTransitIds(
        { agencyIds: [], routeId: "a", routeIds: [] },
        true,
      ),
    ).toEqual([]);
    expect(
      visibleOverlapTransitIds(
        { agencyIds: [], routeId: null, routeIds: ["a", "a", "b"] },
        true,
      ),
    ).toEqual(["a", "b"]);
  });
  it("recognizes the same path with different densification and reverse direction", () => {
    const result = computeRouteOverlaps([
      route(
        "a",
        [
          [
            [0, 0],
            [100, 0],
            [100, 80],
          ],
        ],
        "#ff0000",
      ),
      route(
        "b",
        [
          [
            [100, 80],
            [100, 40],
            [100, 0],
            [75, 0],
            [25, 0],
            [0, 0],
          ],
        ],
        "#0000ff",
      ),
    ]);
    expect(result.geometry.features).toHaveLength(1);
    expect(result.geometry.features[0].properties.memberIds).toEqual([
      "a",
      "b",
    ]);
    expect(result.geometry.features[0].properties.colors).toEqual([
      "#ff0000",
      "#0000ff",
    ]);
    expect(
      result.geometry.features[0].geometry.coordinates.length,
    ).toBeGreaterThan(3);
  });

  it("splits a corridor into complete two, three, four and five member combinations", () => {
    const result = computeRouteOverlaps([
      route("a", [
        [
          [0, 0],
          [100, 0],
        ],
      ]),
      route("b", [
        [
          [0, 0],
          [100, 0],
        ],
      ]),
      route("c", [
        [
          [20, 0],
          [80, 0],
        ],
      ]),
      route("d", [
        [
          [40, 0],
          [60, 0],
        ],
      ]),
      route("e", [
        [
          [45, 0],
          [55, 0],
        ],
      ]),
    ]);
    expect(spans(result)).toEqual([
      { ids: "ab", start: 0, end: 20 },
      { ids: "abc", start: 20, end: 40 },
      { ids: "abcd", start: 40, end: 45 },
      { ids: "abcde", start: 45, end: 55 },
      { ids: "abcd", start: 55, end: 60 },
      { ids: "abc", start: 60, end: 80 },
      { ids: "ab", start: 80, end: 100 },
    ]);
  });

  it("does not turn perpendicular crossings, touching endpoints, or adjacent lanes into shared corridors", () => {
    expect(
      computeRouteOverlaps([
        route("a", [
          [
            [0, 0],
            [100, 0],
          ],
        ]),
        route("b", [
          [
            [50, -50],
            [50, 50],
          ],
        ]),
        route("c", [
          [
            [0, 4],
            [100, 4],
          ],
        ]),
        route("d", [
          [
            [100, 0],
            [150, 0],
          ],
        ]),
      ]).geometry.features,
    ).toEqual([]);
  });

  it("accepts small source geometry discrepancies but not parallel paths outside the tolerance", () => {
    expect(
      computeRouteOverlaps([
        route("a", [
          [
            [0, 0],
            [100, 0],
          ],
        ]),
        route("b", [
          [
            [20, 1],
            [80, 1],
          ],
        ]),
      ]).geometry.features,
    ).toHaveLength(1);
    expect(
      computeRouteOverlaps([
        route("a", [
          [
            [0, 0],
            [100, 0],
          ],
        ]),
        route("b", [
          [
            [0, 2.5],
            [100, 2.5],
          ],
        ]),
      ]).geometry.features,
    ).toHaveLength(0);
  });

  it("does not add colors or duplicate overlays for multiple shapes of one logical route", () => {
    const a = route("a", [
      [
        [0, 0],
        [100, 0],
      ],
      [
        [100, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [25, 0],
        [60, 0],
        [100, 0],
      ],
    ]);
    const original = JSON.stringify(a);
    const result = computeRouteOverlaps([
      a,
      route("a", [
        [
          [0, 0],
          [100, 0],
        ],
      ]),
      route("b", [
        [
          [0, 0],
          [100, 0],
        ],
      ]),
    ]);
    expect(spans(result)).toEqual([{ ids: "ab", start: 0, end: 100 }]);
    expect(JSON.stringify(a)).toBe(original);
    expect(computeRouteOverlaps([a, a]).geometry.features).toEqual([]);
  });

  it("joins fine samples before the minimum shared length check and does not bridge gaps", () => {
    const fine = Array.from({ length: 101 }, (_, x) => [x, 0]);
    const result = computeRouteOverlaps([
      route("a", [fine]),
      route("b", [
        [
          [0, 0],
          [40, 0],
        ],
        [
          [60, 0],
          [100, 0],
        ],
      ]),
    ]);
    expect(spans(result)).toEqual([
      { ids: "ab", start: 0, end: 40 },
      { ids: "ab", start: 60, end: 100 },
    ]);
  });

  it("indexes long paths instead of doing a quadratic all-segments comparison", () => {
    const long = Array.from({ length: 2001 }, (_, x) => [x * 30, 0]);
    const result = computeRouteOverlaps([
      route("a", [long]),
      route("b", [long.slice().reverse()]),
    ]);
    expect(result.geometry.features).toHaveLength(1);
    expect(result.stats.candidateChecks).toBeLessThan(
      result.stats.segmentCount * 35,
    );
    expect(spans(result)).toEqual([{ ids: "ab", start: 0, end: 60000 }]);
  });

  it("adapts full road geometry and only the explicitly selected GTFS routes", () => {
    const road = route(
      "road",
      [
        [
          [0, 0],
          [100, 0],
        ],
      ],
      "#ff0000",
    );
    const transit: FeatureCollection<LineString | MultiLineString> = {
      type: "FeatureCollection",
      features: [
        {
          ...route("b", [
            [
              [0, 0],
              [100, 0],
            ],
          ]).geometry.features[0],
          properties: { id: "metro:b", color: "#abcdef" },
        },
        {
          ...route("c", [
            [
              [0, 0],
              [100, 0],
            ],
          ]).geometry.features[0],
          properties: { id: "metro:c", color: "#123456" },
        },
      ],
    };
    const selected = selectedOverlapRoutes(
      [
        {
          ...road,
          name: "Road",
          bounds: [
            [-118, 34],
            [-117, 35],
          ],
          cityIds: [],
          highlightColor: road.color,
        },
      ],
      transit,
      ["metro:b"],
    );
    expect(selected.map(({ id }) => id)).toEqual(["road", "metro:b"]);
    expect(
      computeRouteOverlaps(selected).geometry.features[0].properties.colors,
    ).toEqual(["#abcdef", "#ff0000"]);
  });
});

describe("N-color checkerboard line patterns", () => {
  it.each([2, 3, 4, 5, 7])(
    "keeps all %i member colors in both rows with a seamless power-of-two width",
    (count) => {
      const colors = [
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#ffff00",
        "#ff00ff",
        "#00ffff",
        "#aa44cc",
      ].slice(0, count);
      const image = createCheckerboardImage(colors);
      expect(image.width & (image.width - 1)).toBe(0);
      expect(image.data.length).toBe(image.width * image.height * 4);
      const rowColors = (y: number) =>
        new Set(
          Array.from({ length: image.width }, (_, x) => {
            const offset = (y * image.width + x) * 4;
            return `#${Array.from(image.data.slice(offset, offset + 3))
              .map((v) => v.toString(16).padStart(2, "0"))
              .join("")}`;
          }),
        );
      expect(rowColors(0)).toEqual(new Set(colors));
      expect(rowColors(image.height - 1)).toEqual(new Set(colors));
      expect(Array.from(image.data.slice(0, 3))).not.toEqual(
        Array.from(
          image.data.slice(
            image.width * (image.height / 2) * 4,
            image.width * (image.height / 2) * 4 + 3,
          ),
        ),
      );
      for (let index = 3; index < image.data.length; index += 4)
        expect(image.data[index]).toBe(255);
    },
  );

  it("produces a valid data-driven MapLibre pattern style", () => {
    const overlap = computeRouteOverlaps([
      route(
        "a",
        [
          [
            [0, 0],
            [50, 0],
          ],
        ],
        "#f00",
      ),
      route(
        "b",
        [
          [
            [0, 0],
            [50, 0],
          ],
        ],
        "#00f",
      ),
    ]);
    const style = routeOverlapStyle(overlap);
    expect(
      validateStyleMin({
        version: 8,
        sources: style.sources,
        layers: style.layers,
      }),
    ).toEqual([]);
    expect(overlap.patterns[0].id).toBe(
      overlap.geometry.features[0].properties.patternKey,
    );
    expect(overlap.patterns[0].colors).toEqual(["#ff0000", "#0000ff"]);
  });
});
