import type { MapGeoJSONFeature } from "maplibre-gl";
import type { Coordinates, FeatureInfo } from "../types";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function describeFeature(
  feature: Pick<
    MapGeoJSONFeature,
    "properties" | "source" | "sourceLayer" | "id"
  >,
  coordinates: Coordinates,
): FeatureInfo {
  const p = feature.properties ?? {};
  const common = {
    id: `${feature.source}:${feature.sourceLayer ?? ""}:${feature.id ?? p.id ?? coordinates.join(",")}`,
    coordinates,
  };
  const sourceName = feature.sourceLayer ?? "";
  const label = text(p["name:en"]) ?? text(p.name_en) ?? text(p.name);
  if (feature.source === "selected-road") {
    return {
      ...common,
      id: String(p.roadId ?? p.id ?? common.id),
      name: label ?? "Selected road",
      kind: "road",
      source: "U.S. Census Bureau · TIGER/Line 2025",
      sourceUrl:
        "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html",
      properties: {
        ...(p.ref ? { Reference: p.ref } : {}),
        ...(p.mtfcc ? { "Census road class": p.mtfcc } : {}),
        Geometry: "Complete selected road within LA + Orange County",
        Data: "Census road centerlines; separate source segments are preserved",
      },
    };
  }
  if (
    feature.source === "transit-routes" ||
    feature.source === "transit-stops"
  ) {
    const route = feature.source === "transit-routes";
    return {
      ...common,
      id: String(p.id ?? common.id),
      name: label ?? text(p.longName) ?? text(p.shortName) ?? "Transit feature",
      kind: route ? "transit-route" : "transit-stop",
      source: text(p.source) ?? "Official agency GTFS snapshot",
      sourceUrl: text(p.feedUrl),
      properties: {
        ...(p.agencyId ? { Agency: p.agencyId } : {}),
        ...(p.shortName ? { Route: p.shortName } : {}),
        ...(p.longName ? { Description: p.longName } : {}),
        ...(p.type !== undefined ? { "GTFS route type": p.type } : {}),
        ...(p.routeIds
          ? {
              "Routes at stop":
                typeof p.routeIds === "string"
                  ? safeArray(p.routeIds).join(", ")
                  : p.routeIds,
            }
          : {}),
        Data: "Static GTFS snapshot · no live arrivals",
      },
    };
  }
  if (sourceName === "building") {
    const height = Number(p.render_height);
    return {
      ...common,
      name: label ?? "Building footprint",
      kind: "building",
      source: "OpenStreetMap · OpenFreeMap / OpenMapTiles",
      sourceUrl: "https://openmaptiles.org/docs/schema/#building",
      properties: {
        Geometry: "Mapped building footprint",
        ...(Number.isFinite(height) && height > 0
          ? {
              "Estimated render height": `${height.toFixed(1)} m`,
              "Height basis":
                "Derived by OpenMapTiles; not a measured height guarantee",
            }
          : { Height: "Not available · display uses a visual extrusion" }),
      },
    };
  }
  if (sourceName === "transportation" || sourceName === "transportation_name") {
    const fields: Record<string, unknown> = {};
    const mappings: Record<string, string> = {
      class: "Road / rail class",
      subclass: "Subtype",
      ref: "Reference",
      network: "Network",
      brunnel: "Structure",
      surface: "Surface",
    };
    for (const [key, title] of Object.entries(mappings))
      if (p[key] !== undefined && p[key] !== "") fields[title] = p[key];
    if (p.oneway !== undefined)
      fields["One-way"] =
        Number(p.oneway) === 1
          ? "Along source geometry"
          : Number(p.oneway) === -1
            ? "Against source geometry"
            : "No";
    if (p.toll !== undefined) fields.Toll = Number(p.toll) === 1 ? "Yes" : "No";
    if (p.ramp !== undefined) fields.Ramp = Number(p.ramp) === 1 ? "Yes" : "No";
    if (!label && !p.ref) fields.Name = "Not included on this tile geometry";
    return {
      ...common,
      name: label ?? text(p.ref) ?? `${text(p.class) ?? "Road"} segment`,
      kind: "road",
      source: "OpenStreetMap · OpenFreeMap / OpenMapTiles",
      sourceUrl: "https://openmaptiles.org/docs/schema/#transportation",
      properties: fields,
    };
  }
  const poi = sourceName === "poi";
  return {
    ...common,
    name: label ?? (poi ? "Point of interest" : "Mapped land feature"),
    kind: poi ? "poi" : "land",
    source: "OpenStreetMap · OpenFreeMap / OpenMapTiles",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    properties: {
      ...(p.class ? { Category: p.class } : {}),
      ...(p.subclass ? { Type: p.subclass } : {}),
      Data: "Attributes available in the rendered vector tile",
    },
  };
}

function safeArray(value: string): string[] {
  try {
    const result: unknown = JSON.parse(value);
    return Array.isArray(result) ? result.map(String) : [value];
  } catch {
    return [value];
  }
}

export function selectionPriority(
  feature: Pick<MapGeoJSONFeature, "source" | "sourceLayer" | "layer">,
  mode: string,
): number {
  if (feature.source === "selected-road") return mode === "transit" ? 90 : 110;
  if (feature.source === "transit-stops") return mode === "transit" ? 100 : 85;
  if (feature.source === "transit-routes") return mode === "transit" ? 95 : 40;
  if (feature.sourceLayer === "poi") return mode === "roads" ? 50 : 90;
  if (feature.sourceLayer === "transportation_name")
    return mode === "roads" ? 100 : 80;
  if (feature.sourceLayer === "transportation")
    return mode === "roads" ? 95 : 65;
  if (feature.sourceLayer === "building") return 70;
  return 10;
}
