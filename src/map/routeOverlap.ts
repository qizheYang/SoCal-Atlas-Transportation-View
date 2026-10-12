import type {
  FeatureCollection,
  LineString,
  MultiLineString,
  Position,
} from "geojson";
import type { RoadSelection, TransitFilter } from "../types";

/** A selected logical route. Multiple shapes/directions still count as one member. */
export interface OverlapRoute {
  id: string;
  color: string;
  geometry: FeatureCollection<LineString | MultiLineString>;
}

export interface OverlapProperties {
  memberIds: string[];
  colors: string[];
  memberCount: number;
  patternKey: string;
}

export interface OverlapPattern {
  id: string;
  colors: string[];
}

export interface RouteOverlapResult {
  geometry: FeatureCollection<LineString, OverlapProperties>;
  patterns: OverlapPattern[];
  stats: { segmentCount: number; candidateChecks: number };
}

export interface RouteOverlapOptions {
  /** Deliberately smaller than a traffic lane; nearby parallel roads stay distinct. */
  toleranceMeters?: number;
  maxAngleDegrees?: number;
  minSharedLengthMeters?: number;
}

type XY = [number, number];
interface Segment {
  index: number;
  member: number;
  a: XY;
  b: XY;
  length: number;
  ux: number;
  uy: number;
}
interface Coverage {
  start: number;
  end: number;
  member: number;
  segment: number;
}
interface Piece {
  a: XY;
  b: XY;
  members: number[];
}
const EARTH_RADIUS = 6_371_008.8;
const DEG = Math.PI / 180;
const CELL = 128;
const MAX_SEGMENT = 120;
const EPSILON = 0.001;

/**
 * Detect shared corridors from source geometry, independent of vertex sampling.
 * Local metric projection + a spatial grid avoids comparing every pair. Projected
 * intervals are split wherever membership changes, then joined into polylines.
 * This is intentionally conservative: crossings and parallel roads >2m apart
 * are not overlaps. It does not infer shared infrastructure from proximity.
 */
export function computeRouteOverlaps(
  input: readonly OverlapRoute[],
  options: RouteOverlapOptions = {},
): RouteOverlapResult {
  const routes = mergeMembers(input);
  const result: RouteOverlapResult = {
    geometry: { type: "FeatureCollection", features: [] },
    patterns: [],
    stats: { segmentCount: 0, candidateChecks: 0 },
  };
  if (routes.length < 2) return result;
  const tolerance = Math.max(0.01, options.toleranceMeters ?? 2);
  const angleCos = Math.cos((options.maxAngleDegrees ?? 2) * DEG);
  const minLength = Math.max(0, options.minSharedLengthMeters ?? 3);
  const origin = firstPosition(routes);
  if (!origin) return result;
  const cosLat = Math.cos(origin[1] * DEG);
  const project = ([lng, lat]: Position): XY => [
    (lng - origin[0]) * DEG * EARTH_RADIUS * cosLat,
    (lat - origin[1]) * DEG * EARTH_RADIUS,
  ];
  const unproject = ([x, y]: XY): Position => [
    origin[0] + x / (DEG * EARTH_RADIUS * cosLat),
    origin[1] + y / (DEG * EARTH_RADIUS),
  ];
  const segments: Segment[] = [];
  routes.forEach((route, member) => {
    // Exact duplicate/reversed source edges are common in GTFS directions.
    const seen = new Set<string>();
    for (const feature of route.geometry.features) {
      const lines =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          if (!validPosition(line[i - 1]) || !validPosition(line[i])) continue;
          const a = project(line[i - 1]);
          const b = project(line[i]);
          const length = distance(a, b);
          if (length < EPSILON) continue;
          const key = edgeKey(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          const count = Math.ceil(length / MAX_SEGMENT);
          for (let part = 0; part < count; part++) {
            const start = interpolate(a, b, part / count);
            const end = interpolate(a, b, (part + 1) / count);
            segments.push({
              index: segments.length,
              member,
              a: start,
              b: end,
              length: length / count,
              ux: (b[0] - a[0]) / length,
              uy: (b[1] - a[1]) / length,
            });
          }
        }
      }
    }
  });
  result.stats.segmentCount = segments.length;
  const grid = new Map<string, number[]>();
  for (const segment of segments)
    for (const key of cells(segment, tolerance)) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(segment.index);
      else grid.set(key, [segment.index]);
    }
  const pieces: Piece[] = [];
  for (const segment of segments) {
    const candidates = new Set<number>();
    for (const key of cells(segment, tolerance))
      for (const index of grid.get(key) ?? []) candidates.add(index);
    const intervals: Coverage[] = [
      {
        start: 0,
        end: segment.length,
        member: segment.member,
        segment: segment.index,
      },
    ];
    for (const index of candidates) {
      if (index === segment.index) continue;
      result.stats.candidateChecks++;
      const other = segments[index];
      if (Math.abs(segment.ux * other.ux + segment.uy * other.uy) < angleCos)
        continue;
      const interval = coverage(segment, other, tolerance);
      if (interval) intervals.push(interval);
    }
    if (!intervals.some((interval) => interval.member !== segment.member))
      continue;
    const cuts = [
      ...new Set(intervals.flatMap(({ start, end }) => [start, end])),
    ].sort((a, b) => a - b);
    for (let cut = 1; cut < cuts.length; cut++) {
      const start = cuts[cut - 1];
      const end = cuts[cut];
      if (end - start < EPSILON) continue;
      const midpoint = (start + end) / 2;
      const active = intervals.filter(
        (interval) => interval.start <= midpoint && interval.end >= midpoint,
      );
      const members = [
        ...new Set(active.map((interval) => interval.member)),
      ].sort((a, b) => a - b);
      if (members.length < 2 || members[0] !== segment.member) continue;
      // Only one copy of the owning route draws this interval, even when several
      // different GTFS shapes/directions describe the same corridor.
      const owner = Math.min(
        ...active
          .filter((interval) => interval.member === segment.member)
          .map((interval) => interval.segment),
      );
      if (owner !== segment.index) continue;
      pieces.push({
        a: along(segment, start),
        b: along(segment, end),
        members,
      });
    }
  }
  const patterns = new Map<string, OverlapPattern>();
  for (const { coordinates, members, length } of joinPieces(pieces)) {
    if (length < minLength) continue;
    const memberIds = members.map((member) => routes[member].id);
    const colors = members.map((member) => routes[member].color);
    const patternKey = overlapPatternKey(colors);
    patterns.set(patternKey, { id: patternKey, colors });
    result.geometry.features.push({
      type: "Feature",
      id: `overlap-${result.geometry.features.length}`,
      properties: {
        memberIds,
        colors,
        memberCount: members.length,
        patternKey,
      },
      geometry: { type: "LineString", coordinates: coordinates.map(unproject) },
    });
  }
  result.patterns = [...patterns.values()];
  return result;
}

/** Build the same logical selected set used by the road and GTFS overlays. */
export function selectedOverlapRoutes(
  roads: readonly RoadSelection[],
  transit: FeatureCollection<LineString | MultiLineString> | null | undefined,
  transitIds: readonly string[],
  transitColors: Readonly<Record<string, string>> = {},
): OverlapRoute[] {
  const selected = new Set(transitIds);
  const result: OverlapRoute[] = roads.map((road) => ({
    id: road.id,
    color: road.highlightColor ?? defaultRoadColor(road.id),
    geometry: road.geometry,
  }));
  for (const feature of transit?.features ?? []) {
    const id = String(feature.properties?.id ?? "");
    if (!selected.has(id)) continue;
    result.push({
      id,
      color:
        transitColors[id] ?? String(feature.properties?.color ?? "#268d9c"),
      geometry: { type: "FeatureCollection", features: [feature] },
    });
  }
  return result;
}

/** Layer visibility matters; browsing an entire agency is not a selection. */
export function visibleOverlapTransitIds(
  filter: TransitFilter,
  visible: boolean,
): string[] {
  if (!visible) return [];
  return [
    ...new Set(filter.routeIds ?? (filter.routeId ? [filter.routeId] : [])),
  ];
}

export function normalizeOverlapColor(color: string): string {
  const hex = color.replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((digit) => digit + digit)
      .join("")
      .toLowerCase()}`;
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return "#268d9c";
}

export function overlapPatternKey(colors: readonly string[]): string {
  return `route-checker-${colors.map((color) => normalizeOverlapColor(color).slice(1)).join("-")}`;
}

function mergeMembers(input: readonly OverlapRoute[]): OverlapRoute[] {
  const byId = new Map<string, OverlapRoute>();
  for (const route of input) {
    const existing = byId.get(route.id);
    if (existing) existing.geometry.features.push(...route.geometry.features);
    else
      byId.set(route.id, {
        id: route.id,
        color: normalizeOverlapColor(route.color),
        geometry: {
          type: "FeatureCollection",
          features: [...route.geometry.features],
        },
      });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function firstPosition(routes: OverlapRoute[]): Position | undefined {
  for (const route of routes)
    for (const feature of route.geometry.features) {
      const position =
        feature.geometry.type === "LineString"
          ? feature.geometry.coordinates[0]
          : feature.geometry.coordinates[0]?.[0];
      if (position && validPosition(position)) return position;
    }
}
function validPosition(position: Position): boolean {
  return (
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1]) &&
    Math.abs(position[1]) < 89
  );
}
function distance(a: XY, b: XY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
function interpolate(a: XY, b: XY, t: number): XY {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function along(segment: Segment, t: number): XY {
  return [segment.a[0] + segment.ux * t, segment.a[1] + segment.uy * t];
}
function pointKey([x, y]: XY): string {
  return `${Math.round(x * 50)},${Math.round(y * 50)}`;
}
function edgeKey(a: XY, b: XY): string {
  return [pointKey(a), pointKey(b)].sort().join("/");
}
function* cells(segment: Segment, padding: number): Generator<string> {
  const minX = Math.floor(
    (Math.min(segment.a[0], segment.b[0]) - padding) / CELL,
  );
  const maxX = Math.floor(
    (Math.max(segment.a[0], segment.b[0]) + padding) / CELL,
  );
  const minY = Math.floor(
    (Math.min(segment.a[1], segment.b[1]) - padding) / CELL,
  );
  const maxY = Math.floor(
    (Math.max(segment.a[1], segment.b[1]) + padding) / CELL,
  );
  for (let x = minX; x <= maxX; x++)
    for (let y = minY; y <= maxY; y++) yield `${x}:${y}`;
}
function coverage(
  base: Segment,
  other: Segment,
  tolerance: number,
): Coverage | null {
  const project = (point: XY) =>
    (point[0] - base.a[0]) * base.ux + (point[1] - base.a[1]) * base.uy;
  const normal = (point: XY) =>
    (point[0] - base.a[0]) * -base.uy + (point[1] - base.a[1]) * base.ux;
  const t0 = project(other.a);
  const t1 = project(other.b);
  let start = Math.max(0, Math.min(t0, t1));
  let end = Math.min(base.length, Math.max(t0, t1));
  if (end - start < EPSILON) return null;
  const d0 = normal(other.a);
  const d1 = normal(other.b);
  const slope = (d1 - d0) / (t1 - t0);
  if (Math.abs(slope) < 1e-10) {
    if (Math.abs(d0) > tolerance) return null;
  } else {
    const atLow = t0 + (-tolerance - d0) / slope;
    const atHigh = t0 + (tolerance - d0) / slope;
    start = Math.max(start, Math.min(atLow, atHigh));
    end = Math.min(end, Math.max(atLow, atHigh));
  }
  return end - start >= EPSILON
    ? { start, end, member: other.member, segment: other.index }
    : null;
}

/** Merge adjacent elementary intervals without bridging gaps or junctions. */
function joinPieces(
  pieces: Piece[],
): { coordinates: XY[]; members: number[]; length: number }[] {
  const groups = new Map<string, Piece[]>();
  for (const piece of pieces) {
    const key = piece.members.join(",");
    const group = groups.get(key);
    if (group) group.push(piece);
    else groups.set(key, [piece]);
  }
  const output: { coordinates: XY[]; members: number[]; length: number }[] = [];
  for (const group of groups.values()) {
    const nodes = new Map<string, number[]>();
    group.forEach((piece, index) => {
      for (const key of [pointKey(piece.a), pointKey(piece.b)]) {
        const edges = nodes.get(key);
        if (edges) edges.push(index);
        else nodes.set(key, [index]);
      }
    });
    const visited = new Set<number>();
    const walk = (first: number, startKey: string) => {
      const coordinates: XY[] = [];
      let length = 0;
      let edge: number | undefined = first;
      let key = startKey;
      while (edge !== undefined && !visited.has(edge)) {
        visited.add(edge);
        const piece = group[edge];
        const forward = pointKey(piece.a) === key;
        const start = forward ? piece.a : piece.b;
        const end = forward ? piece.b : piece.a;
        if (!coordinates.length) coordinates.push(start);
        coordinates.push(end);
        length += distance(start, end);
        key = pointKey(end);
        const next = nodes.get(key) ?? [];
        edge =
          next.length === 2
            ? next.find((index) => !visited.has(index))
            : undefined;
      }
      output.push({ coordinates, members: group[first].members, length });
    };
    for (const [key, edges] of nodes)
      if (edges.length !== 2)
        for (const edge of edges) if (!visited.has(edge)) walk(edge, key);
    group.forEach((piece, index) => {
      if (!visited.has(index)) walk(index, pointKey(piece.a));
    });
  }
  return output;
}

function defaultRoadColor(id: string): string {
  const colors = [
    "#098f83",
    "#d47a2c",
    "#8462b4",
    "#c45f86",
    "#5e8e38",
    "#377eae",
  ];
  const hash = Array.from(id).reduce(
    (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
  return colors[hash % colors.length];
}
