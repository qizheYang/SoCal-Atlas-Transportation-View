import {
  computeRouteOverlaps,
  type OverlapRoute,
  type RouteOverlapResult,
} from "./routeOverlap";

export type OverlapWorkerResponse =
  | { result: RouteOverlapResult; error?: never }
  | { error: string; result?: never };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<OverlapRoute[]>) => void) | null;
  postMessage: (message: OverlapWorkerResponse) => void;
};
scope.onmessage = (event) => {
  try {
    scope.postMessage({ result: computeRouteOverlaps(event.data) });
  } catch (error) {
    scope.postMessage({
      error:
        error instanceof Error ? error.message : "Overlap calculation failed",
    });
  }
};
