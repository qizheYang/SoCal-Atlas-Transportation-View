import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import type { RoadSelection } from "../types";
import { publicAssetUrl } from "../data/publicAssetUrl";
import { selectedOverlapRoutes, type RouteOverlapResult } from "./routeOverlap";
import type { OverlapWorkerResponse } from "./routeOverlap.worker";

export type TransitGeometry = FeatureCollection<LineString | MultiLineString>;
export interface OverlapWorker {
  onmessage: ((event: MessageEvent<OverlapWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
}
let transitCache: Promise<TransitGeometry> | undefined;

/** Static snapshot shared across selection changes; a failed download may retry. */
function loadTransitGeometry(): Promise<TransitGeometry> {
  if (!transitCache) {
    transitCache = fetch(publicAssetUrl("/data/transit-routes.geojson"))
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Transit geometry: HTTP ${response.status}`);
        const data = (await response.json()) as TransitGeometry;
        if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
          throw new Error("Invalid transit geometry");
        return data;
      })
      .catch((error) => {
        transitCache = undefined;
        throw error;
      });
  }
  return transitCache;
}

/** One cancellable worker per selection keeps geometry work off the UI thread.
 * Cancel during fetch prevents worker creation. Cancel during computation kills
 * the worker; queued messages are also guarded so old colors never return.
 */
export function startRouteOverlapJob({
  roads,
  transitIds,
  transitColors = {},
  onResult,
  onError,
  loadTransit = loadTransitGeometry,
  createWorker = () =>
    new Worker(new URL("./routeOverlap.worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as OverlapWorker,
}: {
  roads: readonly RoadSelection[];
  transitIds: readonly string[];
  transitColors?: Readonly<Record<string, string>>;
  onResult: (result: RouteOverlapResult) => void;
  onError: (message: string) => void;
  loadTransit?: () => Promise<TransitGeometry>;
  createWorker?: () => OverlapWorker;
}): () => void {
  let cancelled = false;
  let settled = false;
  let worker: OverlapWorker | undefined;
  const stop = () => {
    worker?.terminate();
    worker = undefined;
  };
  const fail = (message: string) => {
    if (cancelled || settled) return;
    settled = true;
    stop();
    onError(message);
  };
  void (async () => {
    try {
      const transit = transitIds.length ? await loadTransit() : null;
      if (cancelled) return;
      const selected = selectedOverlapRoutes(
        roads,
        transit,
        [...transitIds],
        transitColors,
      );
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        if (cancelled || settled) return;
        if (data.error !== undefined) {
          fail(data.error);
          return;
        }
        settled = true;
        stop();
        onResult(data.result);
      };
      worker.onerror = (event) =>
        fail(event.message || "Overlap worker failed");
      worker.postMessage(selected);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "Overlap calculation failed",
      );
    }
  })();
  return () => {
    cancelled = true;
    stop();
  };
}
