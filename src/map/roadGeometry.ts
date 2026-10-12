import type {
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Point,
} from "geojson";
import type { Coordinates } from "../types";

/** Explicit null suppresses auto-fit, such as when a transit route has focus. */
export function focusedRoadSelection<T extends { id: string }>(
  selections: T[],
  focusedRoadId?: string | null,
): T | null {
  if (focusedRoadId === null) return null;
  if (focusedRoadId !== undefined)
    return selections.find((road) => road.id === focusedRoadId) ?? null;
  return selections.at(-1) ?? null;
}

/** Read every segment, including divided carriageways, without joining gaps. */
export function roadGeometryBounds(
  collection: FeatureCollection<LineString | MultiLineString>,
): [Coordinates, Coordinates] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of collection.features) {
    const lines =
      feature.geometry.type === "LineString"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const line of lines) {
      for (const [lng, lat] of line) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        west = Math.min(west, lng);
        south = Math.min(south, lat);
        east = Math.max(east, lng);
        north = Math.max(north, lat);
      }
    }
  }
  return Number.isFinite(west)
    ? [
        [west, south],
        [east, north],
      ]
    : null;
}

/** Label locations come from the boundary importer, not a guessed bbox center. */
export function cityLabelPoints(
  boundaries: FeatureCollection<Geometry> | null | undefined,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features:
      boundaries?.features.flatMap((feature) => {
        const properties = feature.properties ?? {};
        const lng = properties.labelLng;
        const lat = properties.labelLat;
        if (typeof lng !== "number" || typeof lat !== "number") return [];
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
        return [
          {
            type: "Feature" as const,
            properties,
            geometry: { type: "Point" as const, coordinates: [lng, lat] },
          },
        ];
      }) ?? [],
  };
}

/** Import-time road/polygon intersections, not proximity guesses. */
export function roadBoundaryCrossings(
  roads: FeatureCollection<LineString | MultiLineString> | null | undefined,
  boundaries: FeatureCollection<Geometry> | null | undefined,
): FeatureCollection<Point> {
  const names = new Map(
    boundaries?.features.map((feature) => [
      feature.properties?.id,
      feature.properties?.label ?? feature.properties?.name,
    ]) ?? [],
  );
  return {
    type: "FeatureCollection",
    features:
      roads?.features.flatMap((feature) => {
        const crossings: unknown = feature.properties?.crossings;
        if (!Array.isArray(crossings)) return [];
        return crossings.flatMap((crossing: unknown) => {
          if (!crossing || typeof crossing !== "object") return [];
          const point = crossing as {
            coordinates?: unknown;
            cityIds?: unknown;
          };
          if (
            !Array.isArray(point.coordinates) ||
            !Array.isArray(point.cityIds)
          )
            return [];
          const [lng, lat] = point.coordinates;
          if (
            typeof lng !== "number" ||
            typeof lat !== "number" ||
            !Number.isFinite(lng) ||
            !Number.isFinite(lat)
          )
            return [];
          const cityIds = point.cityIds.filter(
            (id): id is string => typeof id === "string",
          );
          const cityNames = cityIds
            .map((id) => names.get(id))
            .filter((name): name is string => typeof name === "string");
          return [
            {
              type: "Feature" as const,
              properties: {
                cityIds,
                label: cityNames.join(" / ") || "City boundary",
              },
              geometry: { type: "Point" as const, coordinates: [lng, lat] },
            },
          ];
        });
      }) ?? [],
  };
}

export interface MapOverlayRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Keep a usable central viewport even when mobile panels overlap. */
export function roadFitPadding(
  width: number,
  height: number,
  panels: MapOverlayRect[] = [],
): { top: number; bottom: number; left: number; right: number } {
  let left = 28;
  let right = 28;
  let top = Math.min(116, height * 0.23);
  let bottom = Math.min(155, height * 0.23);
  for (const panel of panels) {
    if (panel.bottom <= 0 || panel.top >= height) continue;
    if (
      panel.top > height * 0.55 &&
      (panel.right - panel.left > width * 0.35 ||
        (panel.left > width * 0.2 && panel.right < width * 0.8))
    ) {
      bottom = Math.max(
        bottom,
        Math.min(height - panel.top + 24, height * 0.45),
      );
      continue;
    }
    // Wide mobile cards cannot be avoided by squeezing both horizontal edges.
    if (panel.right - panel.left > width * 0.6) {
      top = Math.max(top, Math.min(panel.bottom + 20, height * 0.45));
    } else if (panel.left < width / 2 && panel.right < width * 0.7) {
      left = Math.max(left, panel.right + 24);
    } else if (panel.right > width / 2 && panel.left > width * 0.3) {
      right = Math.max(right, width - panel.left + 24);
    }
  }
  // Never hand MapLibre padding larger than its canvas dimensions.
  const available = Math.max(0, width - Math.min(180, width * 0.5));
  const scale = Math.min(1, available / (left + right));
  return {
    top: Math.round(top),
    bottom: Math.round(bottom),
    left: Math.round(left * scale),
    right: Math.round(right * scale),
  };
}
