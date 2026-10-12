import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  Map,
  ScaleControl,
  AttributionControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature } from "geojson";
import { REGIONS } from "../data/regions";
import type { Coordinates, MapHandle, MapViewProps } from "../types";
import { createMapStyle, EMPTY_COLLECTION } from "./style";
import { describeFeature, selectionPriority } from "./inspect";
import {
  focusedRoadSelection,
  roadFitPadding,
  roadGeometryBounds,
} from "./roadGeometry";
import { activeRoadSelections } from "./roadStyle";
import { installMapNavigation } from "./navigation";
import { useRouteOverlaps } from "./useRouteOverlaps";
import { createCheckerboardImage } from "./overlapStyle";

setWorkerUrl(workerUrl);

const MapView = forwardRef<MapHandle, MapViewProps>(
  function MapView(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<Map | null>(null);
    const current = useRef(props);
    const loaded = useRef(false);
    const selection = useRef<Feature | null>(null);
    const fittedRoadId = useRef<string | null>(null);
    const navigation = useRef<ReturnType<typeof installMapNavigation> | null>(
      null,
    );
    const overlaps = useRouteOverlaps(props);
    const currentOverlaps = useRef(overlaps);
    currentOverlaps.current = overlaps;
    current.current = props;

    useImperativeHandle(
      ref,
      () => ({
        clearSelection() {
          selection.current = null;
          mapRef.current
            ?.getSource<GeoJSONSource>("selection")
            ?.setData(EMPTY_COLLECTION);
        },
        flyTo(center, zoom = 14) {
          mapRef.current?.flyTo({
            center,
            zoom,
            duration: motionDuration(1400),
          });
        },
        fitRegion(regionId) {
          const region = REGIONS.find((r) => r.id === regionId);
          if (region && mapRef.current)
            fitMapBounds(mapRef.current, region.bounds, { pitch: 0 });
        },
        fitBounds(bounds) {
          if (mapRef.current) fitMapBounds(mapRef.current, bounds);
        },
        zoomBy(delta) {
          const map = mapRef.current;
          if (map)
            map.easeTo({
              zoom: map.getZoom() + delta,
              duration: motionDuration(300),
            });
        },
        resetBearing() {
          mapRef.current?.easeTo({ bearing: 0, duration: motionDuration(600) });
        },
        rotateBy(delta) {
          const map = mapRef.current;
          if (map)
            map.easeTo({
              bearing: map.getBearing() + delta,
              duration: motionDuration(300),
            });
        },
      }),
      [],
    );

    useEffect(() => {
      if (!container.current) return;
      const region =
        REGIONS.find((r) => r.id === current.current.regionId) ??
        REGIONS.find((r) => r.id === "socal") ??
        REGIONS[0];
      let disposed = false;
      let readyOnce = false;
      let sourceError = false;
      let lastErrorAt = 0;
      let mouseFrame = 0;
      let initializationTimeout: ReturnType<typeof setTimeout> | undefined;
      let map: Map;
      current.current.onStatus({
        state: "loading",
        message: "正在加载开放地图…",
      });
      try {
        map = new Map({
          container: container.current,
          style: createMapStyle(
            current.current.viewMode,
            current.current.layers,
            current.current.is3D,
            current.current.transitFilter,
            roadStyleOptions(current.current),
            currentOverlaps.current.result,
          ),
          center: region.center,
          zoom: region.zoom,
          bounds: region.bounds,
          fitBoundsOptions: {
            padding: mapOverlayPadding(container.current),
            bearing: 0,
          },
          bearing: 0,
          pitch: current.current.is3D ? 48 : 0,
          maxPitch: 65,
          minZoom: 5,
          maxZoom: 19,
          attributionControl: false,
          renderWorldCopies: false,
          keyboard: true,
          scrollZoom: current.current.navigationMode === "mouse",
          canvasContextAttributes: { antialias: true },
        });
      } catch {
        current.current.onStatus({
          state: "error",
          message: "地图无法启动。请启用 WebGL / 硬件加速，然后重新加载。",
        });
        return;
      }
      mapRef.current = map;
      const registerOverlapImages = (onlyId?: string) => {
        for (const pattern of currentOverlaps.current.result.patterns) {
          if ((!onlyId || pattern.id === onlyId) && !map.hasImage(pattern.id)) {
            map.addImage(pattern.id, createCheckerboardImage(pattern.colors));
          }
        }
      };
      map.on("style.load", () => registerOverlapImages());
      map.on("styleimagemissing", (event) => registerOverlapImages(event.id));
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
      navigation.current = installMapNavigation(
        map.getCanvasContainer(),
        {
          panBy: (offset) => {
            map.panBy(offset, { duration: 0 });
          },
          zoomTo: (zoom, point) => {
            map.easeTo({ zoom, around: map.unproject(point), duration: 0 });
          },
          getZoom: () => map.getZoom(),
          setScrollZoom: (enabled) => {
            if (enabled) map.scrollZoom.enable();
            else map.scrollZoom.disable();
          },
        },
        current.current.navigationMode,
      );
      map.addControl(
        new ScaleControl({ maxWidth: 100, unit: "imperial" }),
        "bottom-left",
      );
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");

      const reportCamera = () => {
        if (disposed) return;
        const center = map.getCenter();
        current.current.onCameraChange({
          longitude: center.lng,
          latitude: center.lat,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
      };
      map.on("moveend", reportCamera);
      map.on("load", () => {
        loaded.current = true;
        reportCamera();
        // React controls may have changed while initial source data was loading.
        const latest = current.current;
        map.setStyle(
          createMapStyle(
            latest.viewMode,
            latest.layers,
            latest.is3D,
            latest.transitFilter,
            roadStyleOptions(latest),
            currentOverlaps.current.result,
          ),
        );
        const focusedRoad = focusedRoadSelection(
          activeRoadSelections(roadStyleOptions(latest)),
          latest.focusedRoadId,
        );
        if (focusedRoad) {
          const bounds = roadGeometryBounds(focusedRoad.geometry);
          if (bounds) {
            fittedRoadId.current = focusedRoad.id;
            fitMapBounds(map, bounds);
          }
        }
      });
      map.on("idle", () => {
        if (disposed) return;
        if (initializationTimeout) clearTimeout(initializationTimeout);
        readyOnce = true;
        // Idle also fires after failed requests. Only a remount/retry can establish
        // that every failed resource was fetched again, so preserve the warning.
        if (!sourceError && !currentOverlaps.current.error)
          current.current.onStatus({
            state: "ready",
            message: "开放地图 · 在线图块 + GTFS 静态快照",
          });
      });
      map.on("error", (event) => {
        if (disposed) return;
        sourceError = true;
        const now = Date.now();
        if (now - lastErrorAt < 1500) return;
        lastErrorAt = now;
        const details = event.error?.message ?? "";
        const dataset = /transit|geojson/i.test(details)
          ? "公共交通快照"
          : /mapterhorn|terrain|hillshade/i.test(details)
            ? "地形图块"
            : "部分地图数据";
        current.current.onStatus({
          state: readyOnce ? "degraded" : "error",
          message: `${dataset}加载失败。请检查网络，重新加载后重试。`,
        });
      });
      initializationTimeout = setTimeout(() => {
        if (!readyOnce && !sourceError && !disposed)
          current.current.onStatus({
            state: "degraded",
            message: "地图加载时间较长。请检查网络或重新加载。",
          });
      }, 18000);

      const selectableLayers = () =>
        (map.getStyle()?.layers ?? [])
          .filter((layer) => {
            if (
              layer.id.startsWith("selection-") ||
              layer.id.startsWith("road-city-") ||
              layer.layout?.visibility === "none"
            )
              return false;
            if (layer.id.endsWith("-casing")) return false;
            return (
              layer.id.startsWith("road-") ||
              [
                "highway-labels",
                "selected-road-line",
                "selected-road-labels",
                "buildings",
                "buildings-3d",
                "poi",
                "poi-labels",
                "rail",
                "transit-routes",
                "transit-stops",
                "transit-stop-labels",
              ].includes(layer.id)
            );
          })
          .map((layer) => layer.id);

      map.on("click", (event) => {
        if (!loaded.current) return;
        const hits = map.queryRenderedFeatures(
          [
            [event.point.x - 4, event.point.y - 4],
            [event.point.x + 4, event.point.y + 4],
          ],
          { layers: selectableLayers() },
        );
        const picked = hits.sort(
          (a, b) =>
            selectionPriority(b, current.current.viewMode) -
            selectionPriority(a, current.current.viewMode),
        )[0];
        if (!picked) {
          selection.current = null;
          map.getSource<GeoJSONSource>("selection")?.setData(EMPTY_COLLECTION);
          current.current.onFeatureSelect(null);
          return;
        }
        // Inspect the selected full road without replacing its geometry with
        // a clipped, currently visible vector-tile fragment.
        const selectedTransitIds =
          current.current.transitFilter.routeIds ??
          (current.current.transitFilter.routeId
            ? [current.current.transitFilter.routeId]
            : []);
        if (
          picked.source === "selected-road" ||
          (picked.source === "transit-routes" &&
            selectedTransitIds.includes(String(picked.properties?.id)))
        ) {
          selection.current = null;
          map.getSource<GeoJSONSource>("selection")?.setData(EMPTY_COLLECTION);
          current.current.onFeatureSelect(
            describeFeature(picked, [event.lngLat.lng, event.lngLat.lat]),
          );
          return;
        }
        selection.current = {
          type: "Feature",
          properties: {},
          geometry: picked.geometry,
        };
        map.getSource<GeoJSONSource>("selection")?.setData(selection.current);
        current.current.onFeatureSelect(
          describeFeature(picked, [event.lngLat.lng, event.lngLat.lat]),
        );
      });
      map.on("mousemove", (event) => {
        cancelAnimationFrame(mouseFrame);
        mouseFrame = requestAnimationFrame(() => {
          if (!loaded.current || disposed) return;
          const hits: MapGeoJSONFeature[] = map.queryRenderedFeatures(
            event.point,
            { layers: selectableLayers() },
          );
          map.getCanvas().style.cursor = hits.length ? "pointer" : "grab";
        });
      });
      const observer = new ResizeObserver(() => map.resize());
      observer.observe(container.current);
      return () => {
        disposed = true;
        loaded.current = false;
        observer.disconnect();
        cancelAnimationFrame(mouseFrame);
        if (initializationTimeout) clearTimeout(initializationTimeout);
        navigation.current?.dispose();
        navigation.current = null;
        map.remove();
        mapRef.current = null;
      };
    }, []);

    useEffect(() => {
      navigation.current?.setMode(props.navigationMode ?? "trackpad");
    }, [props.navigationMode]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !loaded.current) return;
      selection.current = null;
      map.setStyle(
        createMapStyle(
          props.viewMode,
          props.layers,
          props.is3D,
          props.transitFilter,
          roadStyleOptions(props),
          overlaps.result,
        ),
        { diff: true },
      );
    }, [
      props.viewMode,
      props.layers,
      props.transitFilter,
      props.is3D,
      props.roadSelection,
      props.roadSelections,
      props.roadDisplayMode,
      props.showCityBoundaries,
      props.cityBoundaries,
      overlaps.result,
    ]);

    useEffect(() => {
      if (overlaps.error) {
        props.onStatus({ state: "degraded", message: overlaps.error });
      }
    }, [overlaps.error, props.onStatus]);

    useEffect(() => {
      const map = mapRef.current;
      const road = focusedRoadSelection(
        activeRoadSelections(roadStyleOptions(props)),
        props.focusedRoadId,
      );
      if (!road) {
        fittedRoadId.current = null;
        return;
      }
      if (!map || !loaded.current || fittedRoadId.current === road.id) return;
      const bounds = roadGeometryBounds(road.geometry);
      if (!bounds) return;
      fittedRoadId.current = road.id;
      fitMapBounds(map, bounds);
    }, [props.roadSelection, props.roadSelections, props.focusedRoadId]);

    useEffect(() => {
      mapRef.current?.easeTo({
        pitch: props.is3D ? 48 : 0,
        duration: motionDuration(800),
      });
    }, [props.is3D]);

    return (
      <div
        ref={container}
        className="map-canvas"
        aria-label="Interactive Southern California transportation map"
        style={{ position: "absolute", inset: 0 }}
      />
    );
  },
);

function motionDuration(duration: number): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : duration;
}

function roadStyleOptions(props: MapViewProps) {
  return {
    selection: props.roadSelection,
    selections: props.roadSelections,
    isolated: props.roadDisplayMode === "isolated",
    showCityBoundaries: props.showCityBoundaries,
    boundaries: props.cityBoundaries,
  };
}

function mapOverlayPadding(container: HTMLElement) {
  const canvas = container.getBoundingClientRect();
  const panels = Array.from(
    container.parentElement?.querySelectorAll<HTMLElement>(
      ".workspace, .inspector-container, .map-legend, .highlights-tray, .map-tools, .mode-dock, .topbar",
    ) ?? [],
  ).flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    return [
      {
        left: rect.left - canvas.left,
        right: rect.right - canvas.left,
        top: rect.top - canvas.top,
        bottom: rect.bottom - canvas.top,
      },
    ];
  });
  return roadFitPadding(canvas.width, canvas.height, panels);
}

function fitMapBounds(
  map: Map,
  bounds: [Coordinates, Coordinates],
  options: { pitch?: number } = {},
) {
  map.fitBounds(bounds, {
    padding: mapOverlayPadding(map.getContainer()),
    bearing: 0,
    maxZoom: 16,
    duration: motionDuration(1200),
    ...options,
  });
}

export default MapView;
