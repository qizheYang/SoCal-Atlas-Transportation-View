import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import { normalizeOverlapColor, type RouteOverlapResult } from "./routeOverlap";

export const OVERLAP_SOURCE = "selected-route-overlaps";
export const OVERLAP_LAYER = "selected-route-overlap-pattern";

/** MapLibre line-pattern images need a power-of-two width for seamless repeats.
 * N columns are distributed across that width; row two advances by one color.
 * Every member remains visible for two, three, four, or more selected routes.
 */
export function createCheckerboardImage(
  colors: readonly string[],
  cellSize = 8,
): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  if (colors.length < 2)
    throw new Error("A shared route pattern needs at least two colors");
  if (colors.length > 512)
    throw new Error("A shared route pattern supports at most 512 colors");
  const width = Math.min(
    512,
    2 ** Math.ceil(Math.log2(colors.length * Math.max(1, cellSize))),
  );
  const height = Math.max(2, Math.round(cellSize) * 2);
  const rgb = colors.map((color) => {
    const hex = normalizeOverlapColor(color).slice(1);
    return [0, 2, 4].map((start) =>
      Number.parseInt(hex.slice(start, start + 2), 16),
    );
  });
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const column = Math.floor((x * colors.length) / width);
      const row = y < height / 2 ? 0 : 1;
      const color = rgb[(column + row) % colors.length];
      const offset = (y * width + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  return { width, height, data };
}

/** Insert these layers after the solid road/transit highlights and before labels.
 * Register result.patterns via map.addImage(id, createCheckerboardImage(colors))
 * on style.load (and styleimagemissing) because setStyle may discard images.
 */
export function routeOverlapStyle(result?: RouteOverlapResult | null): {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
} {
  const data = result?.geometry ?? {
    type: "FeatureCollection" as const,
    features: [],
  };
  return {
    sources: { [OVERLAP_SOURCE]: { type: "geojson", data, tolerance: 0 } },
    layers: [
      {
        id: OVERLAP_LAYER,
        type: "line",
        source: OVERLAP_SOURCE,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-pattern": ["get", "patternKey"],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            5,
            12,
            7,
            17,
            10,
          ],
          "line-opacity": 1,
        },
      },
    ],
  };
}
