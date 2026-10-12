import { useEffect, useMemo, useState } from "react";
import type { MapViewProps } from "../types";
import {
  visibleOverlapTransitIds,
  type RouteOverlapResult,
} from "./routeOverlap";
import { startRouteOverlapJob } from "./overlapJobs";

export const EMPTY_OVERLAPS: RouteOverlapResult = {
  geometry: { type: "FeatureCollection", features: [] },
  patterns: [],
  stats: { segmentCount: 0, candidateChecks: 0 },
};

export function useRouteOverlaps(props: MapViewProps): {
  result: RouteOverlapResult;
  error: string | null;
} {
  const idsKey = JSON.stringify(
    visibleOverlapTransitIds(props.transitFilter, props.layers.transit),
  );
  const colorsKey = JSON.stringify(props.transitFilter.routeColors ?? {});
  const request = useMemo(
    () => ({
      roads:
        props.roadSelections ??
        (props.roadSelection ? [props.roadSelection] : []),
      transitIds: JSON.parse(idsKey) as string[],
      transitColors: JSON.parse(colorsKey) as Record<string, string>,
    }),
    [props.roadSelection, props.roadSelections, idsKey, colorsKey],
  );
  const [completed, setCompleted] = useState<{
    request: typeof request;
    result: RouteOverlapResult;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (
      new Set([...request.roads.map((road) => road.id), ...request.transitIds])
        .size < 2
    )
      return;
    return startRouteOverlapJob({
      ...request,
      onResult: (result) => setCompleted({ request, result, error: null }),
      onError: () =>
        setCompleted({
          request,
          result: EMPTY_OVERLAPS,
          error:
            "重合线路纹理暂不可用；已选线路仍可单独查看。请重新选择后重试。",
        }),
    });
  }, [request]);
  // A removal changes the request synchronously, before the previous worker's
  // cleanup or the next calculation: never display stale members meanwhile.
  return completed?.request === request
    ? completed
    : { result: EMPTY_OVERLAPS, error: null };
}
