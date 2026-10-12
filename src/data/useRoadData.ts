import { useEffect, useState } from "react";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type { RoadCatalog } from "../types";
import { readLocalJson } from "./readLocalJson";

export function useRoadData(enabled: boolean) {
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<RoadCatalog | null>(null);
  const [boundaries, setBoundaries] = useState<FeatureCollection<
    Polygon | MultiPolygon
  > | null>(null);
  const [error, setError] = useState("");
  const [boundaryError, setBoundaryError] = useState("");
  useEffect(() => {
    if (enabled) setRequested(true);
  }, [enabled]);
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    setError("");
    setBoundaryError("");
    const read = async (url: string) => {
      const r = await fetch(url, { signal: controller.signal });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    const readCatalog = () =>
      readLocalJson(
        "/data/roads-index.json",
        "/data/roads-index.json.gz",
        controller.signal,
      );
    void readCatalog()
      .then((data) => {
        if (!Array.isArray(data.roads) || !Array.isArray(data.cities))
          throw new Error("Invalid catalog");
        if (!controller.signal.aborted) setCatalog(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("道路目录加载失败，请重试。");
      });
    void read("/data/city-boundaries.geojson")
      .then((data) => {
        if (!Array.isArray(data.features))
          throw new Error("Invalid boundaries");
        if (!controller.signal.aborted) setBoundaries(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setBoundaryError("城市边界加载失败，仍可查找道路。");
      });
    return () => controller.abort();
  }, [requested, attempt]);
  return {
    catalog,
    boundaries,
    error,
    boundaryError,
    retry: () => setAttempt((a) => a + 1),
  };
}
