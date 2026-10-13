import { DEFAULT_LAYERS } from "./regions";
import type { LayerSettings, ViewMode } from "../types";

/** A new visit always starts at the regional overview, even with old settings. */
export function startupSettings(raw: string | null) {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      saved = parsed as Record<string, unknown>;
  } catch {
    /* Invalid or older preferences are harmless. */
  }
  const storedLayers =
    saved.layers && typeof saved.layers === "object"
      ? (saved.layers as Record<string, unknown>)
      : {};
  return {
    regionId: "socal",
    mode: "city" as ViewMode,
    is3D: false,
    keyboardEnabled: saved.keyboardEnabled !== false,
    navigationMode:
      saved.navigationMode === "mouse"
        ? ("mouse" as const)
        : ("trackpad" as const),
    layers: {
      ...(Object.fromEntries(
        Object.entries(DEFAULT_LAYERS).map(([key, fallback]) => [
          key,
          typeof storedLayers[key] === "boolean" ? storedLayers[key] : fallback,
        ]),
      ) as unknown as LayerSettings),
      terrain: false,
      transit: false,
      labels: true,
    },
  };
}
