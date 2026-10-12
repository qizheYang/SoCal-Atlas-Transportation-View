import { describe, expect, it, vi } from "vitest";
import {
  startRouteOverlapJob,
  type OverlapWorker,
  type TransitGeometry,
} from "./overlapJobs";
import type { RouteOverlapResult } from "./routeOverlap";
import type { OverlapWorkerResponse } from "./routeOverlap.worker";

const EMPTY: RouteOverlapResult = {
  geometry: { type: "FeatureCollection", features: [] },
  patterns: [],
  stats: { segmentCount: 0, candidateChecks: 0 },
};
const TRANSIT: TransitGeometry = { type: "FeatureCollection", features: [] };
function fakeWorker(): OverlapWorker {
  return {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}
function message(result = EMPTY): MessageEvent<OverlapWorkerResponse> {
  return { data: { result } } as MessageEvent<OverlapWorkerResponse>;
}

describe("cancellable overlap worker jobs", () => {
  it("passes per-selection transit colors to worker input without editing the cached snapshot", async () => {
    const worker = fakeWorker();
    const snapshot: TransitGeometry = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "b", color: "#ef7d00" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-118, 34],
              [-117.999, 34],
            ],
          },
        },
      ],
    };
    startRouteOverlapJob({
      roads: [],
      transitIds: ["b"],
      transitColors: { b: "#087e8b" },
      loadTransit: async () => snapshot,
      createWorker: () => worker,
      onResult: vi.fn(),
      onError: vi.fn(),
    });
    await Promise.resolve();
    expect(worker.postMessage).toHaveBeenCalledWith([
      expect.objectContaining({ id: "b", color: "#087e8b" }),
    ]);
    expect(snapshot.features[0].properties?.color).toBe("#ef7d00");
  });
  it("does not fetch transit geometry for road-only jobs and terminates on result", () => {
    const worker = fakeWorker();
    const loadTransit = vi.fn(async () => TRANSIT);
    const onResult = vi.fn();
    startRouteOverlapJob({
      roads: [],
      transitIds: [],
      loadTransit,
      createWorker: () => worker,
      onResult,
      onError: vi.fn(),
    });
    expect(loadTransit).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith([]);
    worker.onmessage?.(message());
    expect(onResult).toHaveBeenCalledExactlyOnceWith(EMPTY);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cancel during fetch prevents worker creation and state updates", async () => {
    let resolve!: (data: TransitGeometry) => void;
    const loadTransit = () =>
      new Promise<TransitGeometry>((done) => {
        resolve = done;
      });
    const createWorker = vi.fn(fakeWorker);
    const onResult = vi.fn();
    const onError = vi.fn();
    const cancel = startRouteOverlapJob({
      roads: [],
      transitIds: ["a", "b"],
      loadTransit,
      createWorker,
      onResult,
      onError,
    });
    cancel();
    resolve(TRANSIT);
    await Promise.resolve();
    expect(createWorker).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancel terminates running computation and ignores already queued results or failures", () => {
    const worker = fakeWorker();
    const onResult = vi.fn();
    const onError = vi.fn();
    const cancel = startRouteOverlapJob({
      roads: [],
      transitIds: [],
      createWorker: () => worker,
      onResult,
      onError,
    });
    cancel();
    worker.onmessage?.(message());
    worker.onerror?.({ message: "old worker" } as ErrorEvent);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports worker and fetch failures once without leaving a worker running", async () => {
    const worker = fakeWorker();
    const onError = vi.fn();
    startRouteOverlapJob({
      roads: [],
      transitIds: [],
      createWorker: () => worker,
      onResult: vi.fn(),
      onError,
    });
    worker.onmessage?.({
      data: { error: "invalid geometry" },
    } as MessageEvent<OverlapWorkerResponse>);
    worker.onerror?.({ message: "again" } as ErrorEvent);
    expect(onError).toHaveBeenCalledExactlyOnceWith("invalid geometry");
    expect(worker.terminate).toHaveBeenCalledOnce();
    const downloadError = vi.fn();
    startRouteOverlapJob({
      roads: [],
      transitIds: ["a"],
      loadTransit: async () => {
        throw new Error("offline");
      },
      onResult: vi.fn(),
      onError: downloadError,
    });
    await Promise.resolve();
    expect(downloadError).toHaveBeenCalledExactlyOnceWith("offline");
  });
});
