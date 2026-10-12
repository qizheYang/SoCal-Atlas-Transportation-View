import type {
  FeatureCollection,
  LineString,
  MultiLineString,
  Polygon,
  MultiPolygon,
} from "geojson";

export type ViewMode = "city" | "roads" | "transit" | "terrain";
export type RegionId = string;
export type Coordinates = [number, number];
export type NavigationMode = "trackpad" | "mouse";
export interface Region {
  id: RegionId;
  name: string;
  shortName: string;
  subtitle: string;
  center: Coordinates;
  zoom: number;
  bearing: number;
  bounds: [Coordinates, Coordinates];
}
export interface Place {
  id: string;
  name: string;
  description: string;
  regionId: RegionId;
  center: Coordinates;
  zoom: number;
  category: string;
}
export interface LayerSettings {
  buildings: boolean;
  roads: boolean;
  highways: boolean;
  pois: boolean;
  transit: boolean;
  rail: boolean;
  labels: boolean;
  terrain: boolean;
}
export interface FeatureInfo {
  id: string;
  name: string;
  kind: "road" | "building" | "poi" | "transit-route" | "transit-stop" | "land";
  coordinates?: Coordinates;
  properties: Record<string, unknown>;
  source: string;
  sourceUrl?: string;
}
export interface CameraState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}
export interface MapStatus {
  state: "loading" | "ready" | "error" | "degraded";
  message: string;
}
export interface TransitFilter {
  agencyIds: string[];
  routeId: string | null;
  routeIds?: string[];
  routeColors?: Record<string, string>;
}
export interface MapHandle {
  clearSelection: () => void;
  flyTo: (center: Coordinates, zoom?: number) => void;
  fitRegion: (regionId: RegionId) => void;
  fitBounds: (bounds: [Coordinates, Coordinates]) => void;
  zoomBy: (delta: number) => void;
  resetBearing: () => void;
  rotateBy: (delta: number) => void;
}
export interface MapViewProps {
  regionId: RegionId;
  viewMode: ViewMode;
  layers: LayerSettings;
  is3D: boolean;
  navigationMode?: NavigationMode;
  transitFilter: TransitFilter;
  roadSelection?: RoadSelection | null;
  roadSelections?: RoadSelection[];
  focusedRoadId?: string | null;
  roadDisplayMode?: RoadDisplayMode;
  showCityBoundaries?: boolean;
  cityBoundaries?: FeatureCollection<Polygon | MultiPolygon> | null;
  onFeatureSelect: (feature: FeatureInfo | null) => void;
  onCameraChange: (camera: CameraState) => void;
  onStatus: (status: MapStatus) => void;
}
export interface TransitRoute {
  id: string;
  agencyId: string;
  shortName: string;
  longName: string;
  color: string;
  /** Comparison display color; `color` remains the original GTFS agency color. */
  highlightColor?: string;
  type: number;
  bounds: [Coordinates, Coordinates];
  operatorName?: string;
}
export interface TransitAgency {
  id: string;
  name: string;
  url: string;
  feedUrl: string;
  fetchedAt: string;
  routeCount: number;
  stopCount: number;
  status: string;
  archiveDate?: string;
  retrievalNote?: string;
  downloadUrl?: string;
}
export interface TransitManifest {
  generatedAt: string;
  agencies: TransitAgency[];
  routes: TransitRoute[];
  coverageNote?: string;
  coverageGaps?: {
    id: string;
    name: string;
    reason: string;
    evidenceUrl?: string;
  }[];
}

export type RoadDisplayMode = "context" | "isolated";
export interface RoadCity {
  id: string;
  name: string;
  label?: string;
  kind: "city" | "cdp" | "unincorporated";
  county: string;
  countyFips: string;
  bounds?: [Coordinates, Coordinates];
}
export interface RoadRecord {
  id: string;
  name: string;
  aliases: string[];
  kind: "highway" | "street";
  cityIds: string[];
  counties: string[];
  bounds: [Coordinates, Coordinates];
  lengthKm: number;
  segmentCount: number;
  geometryUrl: string;
  geometryCompressedUrl?: string;
  refs?: string[];
}
export interface RoadCatalog {
  generatedAt: string;
  vintage: string;
  source: string;
  sources: { label?: string; url: string; vintage?: string }[];
  cities: RoadCity[];
  roads: RoadRecord[];
  stats: Record<string, unknown>;
}
export interface RoadSelection {
  id: string;
  name: string;
  bounds: [Coordinates, Coordinates];
  geometry: FeatureCollection<LineString | MultiLineString>;
  cityIds: string[];
  highlightColor?: string;
}
export interface TransitRouteDetails {
  id: string;
  patternCount: number;
  lengthKm: { min: number; max: number };
  endpoints: Array<{
    from: { id: string; name: string; coordinates: Coordinates };
    to: { id: string; name: string; coordinates: Coordinates };
    tripCount: number;
  }>;
  source: string;
  sourceUrl: string;
  fetchedAt?: string;
  lengthMethod?: string;
}
export interface RoadEndpoint {
  coordinates: Coordinates;
  cityIds: string[];
}
