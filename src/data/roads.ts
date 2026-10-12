import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import { readLocalJson } from "./readLocalJson";
import type {
  RoadCatalog,
  RoadCity,
  RoadRecord,
  RoadSelection,
  RoadEndpoint,
} from "../types";

export function roadEndpoints(
  selection?: RoadSelection,
): RoadEndpoint[] | null {
  if (
    !selection ||
    !selection.geometry.features.some((feature) =>
      Array.isArray(feature.properties?.endpoints),
    )
  )
    return null;
  return selection.geometry.features.flatMap((feature) => {
    const endpoints = feature.properties?.endpoints;
    if (!Array.isArray(endpoints)) return [];
    return endpoints.filter(
      (point): point is RoadEndpoint =>
        Array.isArray(point?.coordinates) &&
        point.coordinates.length === 2 &&
        point.coordinates.every(Number.isFinite) &&
        Array.isArray(point.cityIds),
    );
  });
}

export function normalizeRoadQuery(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\b(interstate)\s*/g, "i ")
    .replace(/\b(state route|state highway|sr|ca)\s*/g, "ca ")
    .replace(/\b(us highway|u s highway|us route)\s*/g, "us ")
    .replace(
      /\b(street|avenue|boulevard|highway|road|drive|lane|court|place|parkway|terrace|circle)\b/g,
      (word) =>
        ({
          street: "st",
          avenue: "ave",
          boulevard: "blvd",
          highway: "hwy",
          road: "rd",
          drive: "dr",
          lane: "ln",
          court: "ct",
          place: "pl",
          parkway: "pkwy",
          terrace: "ter",
          circle: "cir",
        })[word] || word,
    )
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function roadCityLabel(city: RoadCity): string {
  const kind =
    city.kind === "cdp"
      ? " · CDP"
      : city.kind === "unincorporated"
        ? " · 非建制地区"
        : "";
  return `${city.name}${kind}`;
}

type RoadSearch = (
  query: string,
  kind?: "all" | RoadRecord["kind"],
  cityId?: string,
) => RoadRecord[];
const searchCache = new WeakMap<RoadCatalog, RoadSearch>();

export function createRoadSearch(catalog: RoadCatalog): RoadSearch {
  const cached = searchCache.get(catalog);
  if (cached) return cached;
  const cities = new Map(catalog.cities.map((city) => [city.id, city]));
  const entries = catalog.roads.map((road) => {
    const names = [road.name, ...road.aliases, ...(road.refs || [])].map(
      normalizeRoadQuery,
    );
    return {
      road,
      names,
      compact: names.map((n) => n.replaceAll(" ", "")),
      words: `${names.join(" ")} ${road.cityIds
        .map((id) => cities.get(id)?.name || "")
        .join(" ")
        .toLowerCase()}`.split(/\s+/),
    };
  });
  const search: RoadSearch = (
    query: string,
    kind: "all" | RoadRecord["kind"] = "all",
    cityId = "all",
  ): RoadRecord[] => {
    const q = normalizeRoadQuery(query);
    const compact = q.replaceAll(" ", "");
    const words = q.split(" ").filter(Boolean);
    const numbered = compact.match(/^(i|ca|us)(\d+)$/);
    return entries
      .filter(
        (e) =>
          (kind === "all" || e.road.kind === kind) &&
          (cityId === "all" || e.road.cityIds.includes(cityId)) &&
          (!q ||
            (numbered
              ? e.compact.includes(compact)
              : e.compact.some((n) => n.includes(compact)) ||
                words.every((w) =>
                  e.words.some((word) => word.startsWith(w)),
                ))),
      )
      .map((e) => ({
        road: e.road,
        score: !q
          ? 0
          : e.compact.includes(compact)
            ? 4
            : e.names.some((n) => n === q)
              ? 4
              : e.names.some((n) => n.startsWith(q))
                ? 3
                : e.compact.some((n) => n.endsWith(compact))
                  ? 2
                  : 1,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (q
            ? 0
            : Number(b.road.kind === "highway") -
              Number(a.road.kind === "highway")) ||
          a.road.name.localeCompare(b.road.name, "en", { numeric: true }) ||
          b.road.lengthKm - a.road.lengthKm ||
          a.road.id.localeCompare(b.road.id),
      )
      .map((e) => e.road);
  };
  searchCache.set(catalog, search);
  return search;
}

const geometryCache = new Map<
  string,
  FeatureCollection<LineString | MultiLineString>
>();
export async function loadRoadSelection(
  road: RoadRecord,
  signal?: AbortSignal,
): Promise<RoadSelection> {
  let data = geometryCache.get(road.geometryUrl);
  if (!data) {
    data = (await readLocalJson(
      road.geometryUrl,
      road.geometryCompressedUrl,
      signal,
    )) as FeatureCollection<LineString | MultiLineString>;
    if (!Array.isArray(data.features)) throw new Error("道路形状格式无效。");
    geometryCache.set(road.geometryUrl, data);
    if (geometryCache.size > 8)
      geometryCache.delete(geometryCache.keys().next().value!);
  }
  const features = data.features.filter(
    (f) =>
      f.id === road.id ||
      f.properties?.roadId === road.id ||
      f.properties?.id === road.id,
  );
  if (!features.length) throw new Error("未找到这条道路的完整形状。");
  return {
    id: road.id,
    name: road.name,
    bounds: road.bounds,
    cityIds: road.cityIds,
    geometry: { type: "FeatureCollection", features },
  };
}
