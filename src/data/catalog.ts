import type { Coordinates, Place, TransitRoute, RoadRecord } from "../types";
export interface StopRecord {
  id: string;
  name: string;
  agencyId: string;
  coordinates: Coordinates;
  routeIds: string[];
}
export interface SearchResult {
  id: string;
  name: string;
  detail: string;
  kind: "place" | "route" | "stop" | "road";
  coordinates: Coordinates;
  zoom: number;
  regionId?: string;
  route?: TransitRoute;
  road?: RoadRecord;
}
export function routeCamera(route: TransitRoute): {
  coordinates: Coordinates;
  zoom: number;
} {
  const [sw, ne] = route.bounds;
  const span = Math.max(ne[0] - sw[0], (ne[1] - sw[1]) * 1.3, 0.005);
  return {
    coordinates: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2],
    zoom: Math.max(7, Math.min(14.5, Math.log2(220 / span))),
  };
}
export function searchCatalog(
  query: string,
  places: Place[],
  routes: TransitRoute[],
  stops: StopRecord[],
): SearchResult[] {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[-–—]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const q = normalize(query);
  if (!q) return [];
  const matches = (text: string) => normalize(text).includes(q);
  const p: SearchResult[] = places
    .filter((p) => matches(`${p.name} ${p.description} ${p.category}`))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name,
      detail: p.description,
      kind: "place",
      coordinates: p.center,
      zoom: p.zoom,
      regionId: p.regionId,
    }));
  const r: SearchResult[] = routes
    .filter((r) =>
      matches(
        `${r.shortName} ${r.longName} ${r.agencyId} ${r.operatorName || ""}`,
      ),
    )
    .sort(
      (a, b) =>
        Number(b.shortName.toLowerCase() === q) -
        Number(a.shortName.toLowerCase() === q),
    )
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      name: `${r.shortName} · ${r.longName}`,
      detail: r.operatorName || r.agencyId,
      kind: "route",
      ...routeCamera(r),
      route: r,
    }));
  const s: SearchResult[] = stops
    .filter((s) => matches(s.name))
    .slice(0, 7)
    .map((s) => ({
      id: s.id,
      name: s.name,
      detail: `${s.agencyId} · 站点`,
      kind: "stop",
      coordinates: s.coordinates,
      zoom: 16,
    }));
  return [...p, ...r, ...s].slice(0, 14);
}
