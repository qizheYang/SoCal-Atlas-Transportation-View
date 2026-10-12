import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from "geojson";
import type { RoadCatalog, RoadRecord } from "../types";
import {
  createRoadSearch,
  loadRoadSelection,
  normalizeRoadQuery,
} from "./roads";

function road(id: string, overrides: Partial<RoadRecord> = {}): RoadRecord {
  return {
    id,
    name: "Main St",
    aliases: ["Main Street"],
    kind: "street",
    cityIds: ["la", "culver"],
    counties: ["Los Angeles"],
    bounds: [
      [-118.4, 34],
      [-118.2, 34.1],
    ],
    lengthKm: 12,
    segmentCount: 3,
    geometryUrl: `/data/roads/test-${id}.geojson`,
    ...overrides,
  };
}

const laMain = road("main-la");
const irvineMain = road("main-irvine", {
  cityIds: ["irvine"],
  counties: ["Orange"],
});
const freeway = road("i405", {
  name: "San Diego Fwy",
  aliases: ["Interstate 405"],
  refs: ["I-405"],
  kind: "highway",
  cityIds: ["la", "culver", "irvine"],
});
const coast = road("ca1", {
  name: "Pacific Coast Hwy",
  aliases: ["Pacific Coast Highway"],
  refs: ["CA-1"],
  kind: "highway",
  cityIds: ["la"],
});
const catalog: RoadCatalog = {
  generatedAt: "2026-10-12T00:00:00Z",
  vintage: "2025",
  source: "Test fixtures",
  sources: [],
  cities: [
    {
      id: "la",
      name: "Los Angeles",
      kind: "city",
      county: "Los Angeles",
      countyFips: "06037",
    },
    {
      id: "culver",
      name: "Culver City",
      kind: "city",
      county: "Los Angeles",
      countyFips: "06037",
    },
    {
      id: "irvine",
      name: "Irvine",
      kind: "city",
      county: "Orange",
      countyFips: "06059",
    },
  ],
  roads: [laMain, irvineMain, freeway, coast],
  stats: {},
};

function lineFeature(id: string): Feature<MultiLineString> {
  return {
    type: "Feature",
    id,
    properties: { roadId: id, name: "Main St", cityIds: ["la", "culver"] },
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [-118.4, 34],
          [-118.3, 34.05],
        ],
        [
          [-118.39, 34.001],
          [-118.29, 34.051],
        ],
        [
          [-118.25, 34.07],
          [-118.2, 34.1],
        ],
      ],
    },
  };
}

function mockShard(features: Feature<LineString | MultiLineString>[]) {
  const data: FeatureCollection<LineString | MultiLineString> = {
    type: "FeatureCollection",
    features,
  };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return { data, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("road catalog search", () => {
  it("keeps a complete highway number distinct from longer numbers and city word matches", () => {
    const search = createRoadSearch({
      ...catalog,
      roads: [
        road("i10", { name: "I-10", aliases: [], kind: "highway" }),
        road("i105", { name: "I-105", aliases: [], kind: "highway" }),
        road("tenth", { name: "10th Ave", aliases: [], cityIds: ["irvine"] }),
      ],
    });
    expect(search("I-10").map((item) => item.id)).toEqual(["i10"]);
  });
  it("does not treat short query words as arbitrary characters in road or city names", () => {
    const search = createRoadSearch({
      ...catalog,
      roads: [
        road("adeline", { name: "Adeline Ave", aliases: [] }),
        road("aline", { name: "Aline Way", aliases: [] }),
      ],
    });
    expect(search("A-Line").map((item) => item.id)).toEqual(["aline"]);
  });
  it("normalizes case, punctuation, and familiar street suffix spellings", () => {
    expect(normalizeRoadQuery("  MAIN Street. ")).toBe(
      normalizeRoadQuery("Main St"),
    );
    expect(normalizeRoadQuery("Sunset Boulevard")).toBe(
      normalizeRoadQuery("SUNSET BLVD"),
    );
    expect(normalizeRoadQuery("Harbor Avenue / Ocean Drive")).toBe(
      "harbor ave ocean dr",
    );
    expect(normalizeRoadQuery("Pacific Coast Highway")).toBe(
      normalizeRoadQuery("Pacific Coast Hwy"),
    );
  });

  it("finds highway references with compact, expanded, and number-only queries", () => {
    const search = createRoadSearch(catalog);
    for (const query of ["I405", "I-405", "Interstate 405", "405"])
      expect(search(query, "highway").map((item) => item.id)).toEqual(["i405"]);
    for (const query of [
      "SR1",
      "SR 1",
      "CA-1",
      "State Route 1",
      "State Highway 1",
    ])
      expect(search(query, "highway").map((item) => item.id)).toEqual(["ca1"]);
    expect(search("Pacific Coast Highway", "highway")[0]).toBe(coast);
  });

  it("keeps same-name roads as separate candidates and accepts their city names in search", () => {
    const search = createRoadSearch(catalog);
    const matches = search("Main Street");
    expect(matches.map((item) => item.id).sort()).toEqual([
      "main-irvine",
      "main-la",
    ]);
    expect(search("Main Street Irvine")).toEqual([irvineMain]);
    expect(search("Main St Culver City")).toEqual([laMain]);
    expect(matches.map((item) => item.cityIds)).toEqual(
      expect.arrayContaining([["irvine"], ["la", "culver"]]),
    );
  });

  it("uses a city filter to select the whole cross-city road without clipping its city list or geometry", async () => {
    const record = road("city-filter-full-road");
    const fixture = lineFeature(record.id);
    const original = JSON.stringify(fixture);
    mockShard([fixture]);
    const search = createRoadSearch({ ...catalog, roads: [record] });
    const candidate = search("Main", "street", "culver")[0];
    expect(candidate).toBe(record);
    expect(candidate.cityIds).toEqual(["la", "culver"]);
    const selection = await loadRoadSelection(candidate);
    expect(selection.cityIds).toEqual(["la", "culver"]);
    expect(selection.bounds).toEqual(record.bounds);
    expect(selection.geometry.features).toEqual([fixture]);
    expect(JSON.stringify(fixture)).toBe(original);
  });

  it("combines highway/street and city filters without losing cross-city highways", () => {
    const search = createRoadSearch(catalog);
    expect(search("", "highway", "irvine")).toEqual([freeway]);
    expect(search("", "street", "irvine")).toEqual([irvineMain]);
    expect(search("", "street", "unknown-city")).toEqual([]);
    expect(search("", "all", "irvine")[0]).toBe(freeway);
  });
});

describe("road geometry shard loading", () => {
  it("selects only matching road features and preserves disconnected segments and both carriageways", async () => {
    const record = road("correct-shard-road");
    const selected = lineFeature(record.id);
    const extraSegment: Feature<LineString> = {
      type: "Feature",
      properties: { roadId: record.id },
      geometry: {
        type: "LineString",
        coordinates: [
          [-118.22, 34.08],
          [-118.2, 34.1],
        ],
      },
    };
    const { fetchMock } = mockShard([
      lineFeature("unrelated-road"),
      selected,
      extraSegment,
    ]);
    const controller = new AbortController();
    const result = await loadRoadSelection(record, controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(record.geometryUrl, {
      signal: controller.signal,
    });
    expect(result.geometry.features).toEqual([selected, extraSegment]);
    expect(result.id).toBe(record.id);
    expect(result.geometry.features[0].geometry).toEqual(selected.geometry);
  });

  it("rejects an absent road ID instead of showing unrelated roads from the same shard", async () => {
    mockShard([lineFeature("different-road")]);
    await expect(loadRoadSelection(road("absent-shard-road"))).rejects.toThrow(
      "未找到这条道路的完整形状",
    );
  });

  it("reuses a downloaded shard while selecting each road independently", async () => {
    const first = road("cached-first", {
      geometryUrl: "/data/roads/test-shared-cache.geojson",
    });
    const second = road("cached-second", { geometryUrl: first.geometryUrl });
    const firstFeature = lineFeature(first.id);
    const secondFeature = lineFeature(second.id);
    const { fetchMock } = mockShard([firstFeature, secondFeature]);
    expect((await loadRoadSelection(first)).geometry.features).toEqual([
      firstFeature,
    ]);
    expect((await loadRoadSelection(second)).geometry.features).toEqual([
      secondFeature,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
