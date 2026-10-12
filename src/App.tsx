import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Bus,
  Check,
  ChevronDown,
  Compass,
  Crosshair,
  Globe2,
  Info,
  Layers3,
  MapPin,
  Maximize,
  Minus,
  Mountain,
  Plus,
  Route,
  Search,
  TrainFront,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import MapView from "./map/MapView";
import { RoadsPanel, RoadDetails } from "./components/RoadsPanel";
import { HighlightsTray } from "./components/HighlightsTray";
import { TransitDetails } from "./components/TransitDetails";
import { useRoadData } from "./data/useRoadData";
import {
  createRoadSearch,
  roadEndpoints,
  loadRoadSelection,
  roadCityLabel,
} from "./data/roads";
import {
  FeatureInspector,
  LayerPanel,
  SourcesDialog,
} from "./components/Panels";
import { PLACES, REGIONS, VIEW_MODES } from "./data/regions";
import { startupSettings } from "./data/settings";
import {
  createHighlightColorAllocator,
  HIGHLIGHT_COLORS,
} from "./data/highlightColors";
import {
  routeCamera,
  searchCatalog,
  type SearchResult,
  type StopRecord,
} from "./data/catalog";
import type {
  CameraState,
  FeatureInfo,
  LayerSettings,
  MapHandle,
  MapStatus,
  TransitManifest,
  TransitRoute,
  ViewMode,
  RoadRecord,
  RoadSelection,
  RoadDisplayMode,
  RoadCity,
  TransitRouteDetails,
} from "./types";

const ICONS = {
  city: Building2,
  roads: Route,
  transit: TrainFront,
  terrain: Mountain,
};
const LEGENDS: Record<ViewMode, [string, string][]> = {
  city: [
    ["#cfbda0", "普通建筑"],
    ["#8fa780", "绿地"],
    ["#90b8c2", "水域"],
  ],
  roads: [
    ["#d19b52", "高速公路"],
    ["#e0bb71", "主要道路"],
    ["#fafaf5", "本地街道"],
  ],
  transit: [
    ["#7ecbb7", "公交 / 轨道线路"],
    ["#f5f7f2", "停靠站点"],
    ["#7e8b91", "铁路基础设施"],
  ],
  terrain: [
    ["#91a37a", "自然地表"],
    ["#607860", "地形阴影"],
    ["#90b8c2", "海岸与水域"],
  ],
};
function initialSettings() {
  try {
    return startupSettings(localStorage.getItem("southland-settings"));
  } catch {
    return startupSettings(null);
  }
}

export default function App() {
  const [initial] = useState(initialSettings);
  const [regionId, setRegionId] = useState(initial.regionId);
  const [mode, setMode] = useState<ViewMode>(initial.mode);
  const [is3D, setIs3D] = useState(initial.is3D);
  const [navigationMode, setNavigationMode] = useState(initial.navigationMode);
  const [layers, setLayers] = useState<LayerSettings>(initial.layers);
  const [feature, setFeature] = useState<FeatureInfo | null>(null);
  const [status, setStatus] = useState<MapStatus>({
    state: "loading",
    message: "正在加载开放地图…",
  });
  const [camera, setCamera] = useState<CameraState>({
    longitude: REGIONS[0].center[0],
    latitude: REGIONS[0].center[1],
    zoom: REGIONS[0].zoom,
    bearing: 0,
    pitch: 0,
  });
  const [manifest, setManifest] = useState<TransitManifest | null>(null);
  const [transitDetails, setTransitDetails] = useState<
    Record<string, TransitRouteDetails>
  >({});
  const [transitDetailsError, setTransitDetailsError] = useState("");
  const [stops, setStops] = useState<StopRecord[]>([]);
  const [transitError, setTransitError] = useState("");
  const [agencyId, setAgencyId] = useState("all");
  const [routeId, setRouteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tab, setTab] = useState<"explore" | "layers">("explore");
  const [mapGeneration, setMapGeneration] = useState(0);
  const [roads, setRoads] = useState<RoadRecord[]>([]);
  const [roadSelections, setRoadSelections] = useState<RoadSelection[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<TransitRoute[]>([]);
  const [focusedRoadId, setFocusedRoadId] = useState<string | null>(null);
  const road = roads.find((item) => item.id === focusedRoadId) || null;
  const [roadDisplayMode, setRoadDisplayMode] =
    useState<RoadDisplayMode>("context");
  const [showCityBoundaries, setShowCityBoundaries] = useState(true);
  const [pendingRoads, setPendingRoads] = useState<RoadRecord[]>([]);
  const [roadError, setRoadError] = useState("");
  const [roadQuery, setRoadQuery] = useState("");
  const roadRequests = useRef(new Map<string, AbortController>());
  const highlightColors = useRef(createHighlightColorAllocator());
  const roadColors = useMemo(
    () =>
      Object.fromEntries([
        ...roadSelections.map((selection) => [
          selection.id,
          selection.highlightColor || HIGHLIGHT_COLORS[0],
        ]),
        ...pendingRoads.map((record) => [
          record.id,
          highlightColors.current.get(`road:${record.id}`) ||
            HIGHLIGHT_COLORS[0],
        ]),
      ]),
    [roadSelections, pendingRoads],
  );
  const roadData = useRoadData(mode === "roads" || searchOpen);
  const roadSearch = useMemo(
    () => (roadData.catalog ? createRoadSearch(roadData.catalog) : null),
    [roadData.catalog],
  );
  const roadCities = useMemo(
    () =>
      new Map(roadData.catalog?.cities.map((city) => [city.id, city]) || []),
    [roadData.catalog],
  );
  const globalRoadMatches = useMemo(
    () => (query.trim() ? roadSearch?.(query) || [] : []),
    [query, roadSearch],
  );
  const mapRef = useRef<MapHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const region = REGIONS.find((r) => r.id === regionId) || REGIONS[0];
  const currentMode = VIEW_MODES.find((m) => m.id === mode)!;
  const inspectedRoute =
    feature?.kind === "transit-route"
      ? (selectedRoutes.find((route) => route.id === feature.id) ??
        manifest?.routes.find(
          (route) =>
            route.id === feature.id ||
            route.id === feature.properties["Route ID"] ||
            route.id === feature.properties.id,
        ))
      : undefined;
  const transitFilter = useMemo(
    () => ({
      agencyIds: agencyId === "all" ? [] : [agencyId],
      routeId: null,
      routeIds: selectedRoutes.map((route) => route.id),
      routeColors: Object.fromEntries(
        selectedRoutes.map((route) => [
          route.id,
          route.highlightColor || route.color,
        ]),
      ),
    }),
    [agencyId, selectedRoutes],
  );
  const searchResults = useMemo(
    () =>
      [
        ...globalRoadMatches.slice(0, 5).map(
          (r): SearchResult => ({
            id: r.id,
            name: r.name,
            kind: "road",
            road: r,
            detail: r.cityIds
              .map((id) => roadCities.get(id))
              .filter((c): c is RoadCity => !!c)
              .map(roadCityLabel)
              .join(" · "),
            coordinates: r.bounds[0],
            zoom: 13,
          }),
        ),
        ...searchCatalog(query, PLACES, manifest?.routes || [], stops),
      ].slice(0, 16),
    [query, manifest, stops, globalRoadMatches, roadCities],
  );
  const routeList = useMemo(
    () =>
      (manifest?.routes || []).filter(
        (r) => agencyId === "all" || r.agencyId === agencyId,
      ),
    [manifest, agencyId],
  );
  const clearRoad = useCallback(() => {
    highlightColors.current.releasePrefix("road:");
    roadRequests.current.forEach((controller) => controller.abort());
    roadRequests.current.clear();
    setPendingRoads([]);
    setRoads([]);
    setRoadSelections([]);
    setFocusedRoadId(null);
    setFeature(null);
    setRoadError("");
    mapRef.current?.clearSelection();
  }, []);
  const removeRoad = (id: string) => {
    highlightColors.current.release(`road:${id}`);
    roadRequests.current.get(id)?.abort();
    roadRequests.current.delete(id);
    setPendingRoads((items) => items.filter((item) => item.id !== id));
    setRoads((items) => items.filter((item) => item.id !== id));
    setRoadSelections((items) => items.filter((item) => item.id !== id));
    if (focusedRoadId === id) setFocusedRoadId(null);
    setFeature((value) => (value?.id === id ? null : value));
  };
  const removeRoute = (id: string) => {
    highlightColors.current.release(`transit:${id}`);
    setSelectedRoutes((items) => items.filter((item) => item.id !== id));
    if (routeId === id) setRouteId(null);
    setFeature((value) => (value?.id === id ? null : value));
    if (selectedRoutes.length === 1)
      setLayers((value) => ({
        ...value,
        transit: roads.length === 0 && mode === "transit",
      }));
  };
  const clearHighlights = () => {
    highlightColors.current.clear();
    clearRoad();
    setSelectedRoutes([]);
    setRouteId(null);
    setLayers((value) => ({ ...value, transit: mode === "transit" }));
  };
  const fitHighlights = () => {
    const bounds = [...roads, ...selectedRoutes].map((item) => item.bounds);
    if (bounds.length)
      mapRef.current?.fitBounds([
        [
          Math.min(...bounds.map((b) => b[0][0])),
          Math.min(...bounds.map((b) => b[0][1])),
        ],
        [
          Math.max(...bounds.map((b) => b[1][0])),
          Math.max(...bounds.map((b) => b[1][1])),
        ],
      ]);
  };
  const chooseRoad = async (record: RoadRecord) => {
    setMode("roads");
    setTab("explore");
    setSidebarOpen(true);
    setFeature(null);
    setFocusedRoadId(record.id);
    setRoadError("");
    setLayers((p) => ({
      ...p,
      roads: true,
      highways: true,
      transit: selectedRoutes.length > 0,
    }));
    mapRef.current?.clearSelection();
    if (roads.some((item) => item.id === record.id)) {
      mapRef.current?.fitBounds(record.bounds);
      return;
    }
    if (roadRequests.current.has(record.id)) return;
    const controller = new AbortController();
    roadRequests.current.set(record.id, controller);
    setPendingRoads((items) => [...items, record]);
    const highlightColor = highlightColors.current.reserve(`road:${record.id}`);
    try {
      const selection = await loadRoadSelection(record, controller.signal);
      if (controller.signal.aborted) return;
      setRoads((items) =>
        items.some((item) => item.id === record.id)
          ? items
          : [...items, record],
      );
      setRoadSelections((items) =>
        items.some((item) => item.id === record.id)
          ? items
          : [
              ...items,
              {
                ...selection,
                highlightColor,
              },
            ],
      );
    } catch {
      if (
        !controller.signal.aborted &&
        roadRequests.current.get(record.id) === controller
      ) {
        highlightColors.current.release(`road:${record.id}`);
        setRoadError(`无法加载 ${record.name}，请重新选择这条道路。`);
      }
    } finally {
      if (roadRequests.current.get(record.id) === controller) {
        roadRequests.current.delete(record.id);
        setPendingRoads((items) =>
          items.filter((item) => item.id !== record.id),
        );
      }
    }
  };
  useEffect(
    () => () => {
      roadRequests.current.forEach((controller) => controller.abort());
      roadRequests.current.clear();
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/data/transit-details.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("details unavailable");
        const data = await response.json();
        if (!data.routes || typeof data.routes !== "object")
          throw new Error("invalid details");
        if (!controller.signal.aborted) setTransitDetails(data.routes);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setTransitDetailsError("线路详情加载失败，请重新加载页面。");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "southland-settings",
        JSON.stringify({ layers, navigationMode }),
      );
    } catch {
      /* Private browsing can disable persistence. */
    }
  }, [layers, navigationMode]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const results = await Promise.allSettled([
        fetch("/data/transit-manifest.json", {
          signal: controller.signal,
        }).then(async (r) => {
          if (!r.ok) throw new Error("线路目录暂不可用");
          return r.json();
        }),
        fetch("/data/transit-stops.geojson", {
          signal: controller.signal,
        }).then(async (r) => {
          if (!r.ok) throw new Error("站点目录暂不可用");
          return r.json();
        }),
      ]);
      if (controller.signal.aborted) return;
      if (
        results[0].status === "fulfilled" &&
        Array.isArray(results[0].value.routes)
      )
        setManifest(results[0].value);
      else setTransitError("公共交通目录加载失败，请重新加载页面。");
      if (
        results[1].status === "fulfilled" &&
        Array.isArray(results[1].value.features)
      ) {
        setStops(
          results[1].value.features
            .filter(
              (f: { geometry?: { type: string } }) =>
                f.geometry?.type === "Point",
            )
            .map(
              (f: {
                properties: Record<string, unknown>;
                geometry: { coordinates: [number, number] };
              }) => ({
                id: String(f.properties.id),
                name: String(f.properties.name || "未命名站点"),
                agencyId: String(f.properties.agencyId),
                coordinates: f.geometry.coordinates,
                routeIds: Array.isArray(f.properties.routeIds)
                  ? (f.properties.routeIds as string[])
                  : [],
              }),
            ),
        );
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSourcesOpen(false);
        setFeature(null);
        setFocusedRoadId(null);
        mapRef.current?.clearSelection();
      }
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const selectFeature = useCallback(
    (value: FeatureInfo | null) => {
      if (
        value?.kind === "road" &&
        roads.some((item) => item.id === value.id)
      ) {
        setFocusedRoadId(value.id);
        setFeature(null);
      } else {
        setFeature(value);
        if (value) setFocusedRoadId(null);
      }
    },
    [roads],
  );
  useEffect(() => {
    if (!road && !feature) return;
    const narrow = window.matchMedia("(max-width: 1099px)");
    const keepMapVisible = () => {
      if (narrow.matches) setSidebarOpen(false);
    };
    keepMapVisible();
    narrow.addEventListener("change", keepMapVisible);
    return () => narrow.removeEventListener("change", keepMapVisible);
  }, [road?.id, feature?.id]);
  const updateLayer = useCallback(
    (key: keyof LayerSettings, value: boolean) => {
      setLayers((current) => ({ ...current, [key]: value }));
      setFeature(null);
    },
    [],
  );
  const chooseRegion = (id: string) => {
    setFocusedRoadId(null);
    setRegionId(id);
    setFeature(null);
    setRouteId(null);
    setAgencyId("all");
    mapRef.current?.clearSelection();
    setIs3D(false);
    mapRef.current?.fitRegion(id);
  };
  const chooseRoute = (route: TransitRoute) => {
    const highlightColor = highlightColors.current.reserve(
      `transit:${route.id}`,
      route.color,
    );
    const highlightedRoute = { ...route, highlightColor };
    setFocusedRoadId(null);
    setSelectedRoutes((items) =>
      items.some((item) => item.id === route.id)
        ? items
        : [...items, highlightedRoute],
    );
    setMode("transit");
    setRouteId(route.id);
    setAgencyId(route.agencyId);
    setLayers((p) => ({ ...p, transit: true }));
    const view = routeCamera(route);
    mapRef.current?.flyTo(view.coordinates, view.zoom);
    const agency = manifest?.agencies.find((a) => a.id === route.agencyId);
    setFeature({
      id: route.id,
      name: `${route.shortName} · ${route.longName}`,
      kind: "transit-route",
      properties: {
        ...highlightedRoute,
        dataType: "GTFS 静态线路",
        fetchedAt: agency?.fetchedAt,
      },
      source: agency?.name || route.agencyId,
      sourceUrl: agency?.url,
    });
  };
  const chooseSearch = (item: SearchResult) => {
    setQuery("");
    setSearchOpen(false);
    if (item.road) {
      void chooseRoad(item.road);
      return;
    }
    setFocusedRoadId(null);
    if (item.route) {
      chooseRoute(item.route);
      return;
    }
    if (item.regionId) setRegionId(item.regionId);
    mapRef.current?.flyTo(item.coordinates, item.zoom);
    if (item.kind === "stop") {
      setMode("transit");
      setRouteId(null);
      setAgencyId("all");
      setLayers((p) => ({ ...p, transit: true }));
    }
    setFeature(
      item.kind === "stop"
        ? {
            id: item.id,
            name: item.name,
            kind: "transit-stop",
            coordinates: item.coordinates,
            properties: { agency: item.detail },
            source: "官方 GTFS 站点",
          }
        : null,
    );
  };
  const switchMode = (value: ViewMode) => {
    setMode(value);
    setFeature(null);
    setFocusedRoadId(null);
    setTab("explore");
    if (value === "transit") setLayers((p) => ({ ...p, transit: true }));
    if (value === "terrain") setLayers((p) => ({ ...p, terrain: true }));
  };

  return (
    <main
      className={`studio ${sidebarOpen ? "" : "sidebar-hidden"} ${road || feature ? "has-inspector" : ""} ${roads.length + selectedRoutes.length + pendingRoads.length ? "has-highlights" : ""}`}
    >
      <MapView
        key={mapGeneration}
        ref={mapRef}
        regionId={regionId}
        viewMode={mode}
        layers={layers}
        is3D={is3D}
        navigationMode={navigationMode}
        transitFilter={transitFilter}
        roadSelections={roadSelections}
        focusedRoadId={focusedRoadId}
        roadDisplayMode={roadDisplayMode}
        showCityBoundaries={roads.length > 0 && showCityBoundaries}
        cityBoundaries={roadData.boundaries}
        onFeatureSelect={selectFeature}
        onCameraChange={setCamera}
        onStatus={setStatus}
      />
      <div className="map-vignette" />
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            chooseRegion("socal");
          }}
          aria-label="回到 SoCal 全览"
        >
          <span className="brand-symbol">
            <Building2 size={25} strokeWidth={1.6} />
          </span>
          <span>
            <strong>
              SOCAL ATLAS<span className="brand-period">.</span>
            </strong>
            <small>TRANSPORTATION VIEW</small>
          </span>
        </a>
        <div className="topbar-middle">
          <div className="region-picker">
            <Globe2 size={16} />
            <select
              aria-label="选择区域"
              value={regionId}
              onChange={(e) => chooseRegion(e.target.value)}
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.shortName}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
          <div className="search-box">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchResults.length === 1)
                  chooseSearch(searchResults[0]);
              }}
              placeholder="搜索道路、地点、线路、车站"
              aria-label="搜索道路、地点、线路、车站"
            />
            <kbd>/</kbd>
            {searchOpen && (
              <div className="search-results">
                <div className="search-results-heading">
                  {query ? "道路、地点与公共交通目录" : "从这里开始探索"}
                  <button
                    aria-label="关闭搜索"
                    onClick={() => setSearchOpen(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                {query ? (
                  searchResults.length ? (
                    searchResults.map((r) => (
                      <button
                        key={`${r.kind}-${r.id}`}
                        onClick={() => chooseSearch(r)}
                      >
                        <span className="search-result-icon">
                          {r.kind === "route" || r.kind === "road" ? (
                            <Route size={16} />
                          ) : r.kind === "stop" ? (
                            <TrainFront size={16} />
                          ) : (
                            <MapPin size={16} />
                          )}
                        </span>
                        <span>
                          <strong>{r.name}</strong>
                          <small>{r.detail}</small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))
                  ) : (
                    <p className="search-empty">
                      未找到匹配项。可搜索 I-405、Main
                      St、Irvine、线路编号或英文站名。
                    </p>
                  )
                ) : (
                  PLACES.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        chooseSearch({
                          id: p.id,
                          name: p.name,
                          detail: p.description,
                          kind: "place",
                          coordinates: p.center,
                          zoom: p.zoom,
                          regionId: p.regionId,
                        })
                      }
                    >
                      <MapPin size={16} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.category}</small>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                )}
                <div className="search-footnote">
                  {roadData.error ||
                    (!roadData.catalog
                      ? "正在加载道路目录…"
                      : "同名道路请按城市选择 · 普通 POI 可在地图点选")}
                </div>
                {globalRoadMatches.length > 5 && (
                  <button
                    className="road-global-more"
                    onClick={() => {
                      setRoadQuery(query);
                      setMode("roads");
                      setTab("explore");
                      setSidebarOpen(true);
                      setSearchOpen(false);
                    }}
                  >
                    共有 {globalRoadMatches.length} 条匹配道路 ·
                    打开道路目录继续筛选
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <span className="version-tag">
            OPEN DATA <span>V0.2</span>
          </span>
          <button
            className="icon-button source-button"
            onClick={() => setSourcesOpen(true)}
            aria-label="数据来源与说明"
            title="数据来源与说明"
          >
            <Info size={19} />
          </button>
        </div>
      </header>

      <button
        className="workspace-toggle icon-button"
        onClick={() => {
          if (!sidebarOpen && window.innerWidth < 1100) {
            setFeature(null);
            setFocusedRoadId(null);
          }
          setSidebarOpen((p) => !p);
        }}
        aria-label={sidebarOpen ? "收起工作区" : "展开工作区"}
        aria-expanded={sidebarOpen}
      >
        <Layers3 size={19} />
      </button>
      {sidebarOpen && (
        <aside className="workspace panel">
          <div className="workspace-title">
            <span className="eyebrow">REGIONAL WORKSPACE</span>
            <span className="live-dot" />
          </div>
          <div className="region-title">
            <h1>{region.shortName}</h1>
            <span>{region.subtitle}</span>
          </div>
          <div className="workspace-tabs">
            <button
              className={tab === "explore" ? "active" : ""}
              onClick={() => setTab("explore")}
            >
              <Compass size={14} />
              探索区域
            </button>
            <button
              className={tab === "layers" ? "active" : ""}
              onClick={() => setTab("layers")}
            >
              <Layers3 size={14} />
              地图图层
            </button>
          </div>
          <div className="workspace-content">
            {tab === "layers" ? (
              <LayerPanel layers={layers} onChange={updateLayer} />
            ) : mode === "roads" ? (
              <RoadsPanel
                catalog={roadData.catalog}
                selectedIds={roads.map((item) => item.id)}
                loadingIds={pendingRoads.map((item) => item.id)}
                error={roadData.error}
                onRetry={roadData.retry}
                onSelect={chooseRoad}
                onClear={clearRoad}
                query={roadQuery}
                onQuery={setRoadQuery}
              />
            ) : mode === "transit" ? (
              <div className="transit-browser">
                <div className="section-caption">
                  <span>公共交通网络</span>
                  <span>
                    {manifest ? `${manifest.routes.length} 条线路` : "加载中"}
                  </span>
                </div>
                <label className="field-label" htmlFor="agency">
                  交通运营机构
                </label>
                <select
                  id="agency"
                  value={agencyId}
                  onChange={(e) => {
                    setAgencyId(e.target.value);
                    setRouteId(null);
                  }}
                >
                  <option value="all">全部运营机构</option>
                  {manifest?.agencies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {selectedRoutes.length > 0 && (
                  <button
                    className="clear-route"
                    onClick={() => {
                      setRouteId(null);
                      highlightColors.current.releasePrefix("transit:");
                      setSelectedRoutes([]);
                      if (roads.length > 0)
                        setLayers((value) => ({ ...value, transit: false }));
                      setFeature(null);
                    }}
                  >
                    <X size={13} />
                    清除公共交通高亮
                  </button>
                )}
                {transitError && <p className="inline-error">{transitError}</p>}
                <div className="route-list">
                  {routeList.map((route) => (
                    <button
                      className={`route-item ${selectedRoutes.some((item) => item.id === route.id) ? "selected" : ""}`}
                      key={route.id}
                      onClick={() => chooseRoute(route)}
                    >
                      <span
                        className="route-badge"
                        style={{
                          borderColor:
                            transitFilter.routeColors[route.id] || route.color,
                          color:
                            transitFilter.routeColors[route.id] || route.color,
                        }}
                      >
                        {route.shortName || (route.type === 3 ? "BUS" : "RAIL")}
                      </span>
                      <span>
                        <strong>{route.longName || route.shortName}</strong>
                        <small>
                          {route.operatorName ||
                            manifest?.agencies.find(
                              (agency) => agency.id === route.agencyId,
                            )?.name ||
                            route.agencyId}{" "}
                          · {route.type === 3 ? "公交" : "轨道"}
                        </small>
                      </span>
                      {selectedRoutes.some((item) => item.id === route.id) && (
                        <Check size={14} />
                      )}
                    </button>
                  ))}
                </div>
                <p className="panel-note">
                  官方 GTFS
                  静态网络。线路可能包含分支及非每日运行服务；不显示实时到站。
                </p>
                <button
                  className="coverage-link"
                  onClick={() => setSourcesOpen(true)}
                >
                  已收录 {manifest?.agencies.length || 0} 个数据源 ·
                  查看覆盖与缺口
                </button>
              </div>
            ) : (
              <>
                <div className="section-caption">
                  <span>精选目的地</span>
                  <span>
                    {regionId === "socal"
                      ? "SOUTHERN CALIFORNIA"
                      : regionId === "southland"
                        ? "LA + OC"
                        : regionId.toUpperCase()}
                  </span>
                </div>
                <div className="place-list">
                  {PLACES.filter(
                    (p) =>
                      regionId === "socal" ||
                      (regionId === "southland" &&
                        ["la", "oc"].includes(p.regionId)) ||
                      p.regionId === regionId,
                  ).map((place, index) => (
                    <button
                      key={place.id}
                      className="place-item"
                      onClick={() => {
                        setRegionId(place.regionId);
                        mapRef.current?.flyTo(place.center, place.zoom);
                        setFeature(null);
                      }}
                    >
                      <span className="place-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>{place.name}</strong>
                        <small>{place.category}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
                <div className="exploration-note">
                  <span className="tiny-rule" />
                  <p>
                    从海岸到街区，
                    <br />
                    换一个尺度看城市。
                  </p>
                  <small>真实地理数据 · 自由探索</small>
                </div>
              </>
            )}
          </div>
          <button
            className="region-overview"
            onClick={() => {
              chooseRegion(regionId);
            }}
          >
            <Maximize size={14} />
            查看区域全貌
            <ArrowDownRight size={14} />
          </button>
        </aside>
      )}

      {road && (
        <div className="inspector-container">
          <RoadDetails
            road={road}
            endpoints={roadEndpoints(
              roadSelections.find((selection) => selection.id === road.id),
            )}
            onEndpoint={(coordinates) => mapRef.current?.flyTo(coordinates, 16)}
            cities={road.cityIds
              .map((id) => roadCities.get(id))
              .filter((c): c is RoadCity => !!c)
              .sort((a, b) => a.name.localeCompare(b.name))}
            displayMode={roadDisplayMode}
            onDisplayMode={setRoadDisplayMode}
            showBoundaries={showCityBoundaries}
            onBoundaries={setShowCityBoundaries}
            boundaryError={roadData.boundaryError}
            onClose={() => setFocusedRoadId(null)}
            onFit={() => mapRef.current?.fitBounds(road.bounds)}
            onCity={(city) => {
              if (city.bounds) mapRef.current?.fitBounds(city.bounds);
            }}
          />
        </div>
      )}
      {roadError && (
        <div className="road-load-error" role="alert">
          {roadError}
          <button
            aria-label="关闭道路加载错误"
            onClick={() => setRoadError("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {feature && !road && (
        <div className="inspector-container">
          {inspectedRoute ? (
            <TransitDetails
              route={inspectedRoute}
              agency={manifest?.agencies.find(
                (agency) => agency.id === inspectedRoute.agencyId,
              )}
              details={transitDetails[inspectedRoute.id] || null}
              error={transitDetailsError}
              onClose={() => {
                setFeature(null);
                mapRef.current?.clearSelection();
              }}
              onFit={() => mapRef.current?.fitBounds(inspectedRoute.bounds)}
              onEndpoint={(coordinates) =>
                mapRef.current?.flyTo(coordinates, 16)
              }
            />
          ) : (
            <FeatureInspector
              feature={feature}
              onClose={() => {
                setFeature(null);
                mapRef.current?.clearSelection();
              }}
            />
          )}
        </div>
      )}
      {!feature && !road && (
        <div className="context-label">
          <span>{currentMode.english} VIEW</span>
          <p>{currentMode.description}</p>
        </div>
      )}
      <div className="map-tools interaction-controls" aria-label="地图导航">
        <div className="interaction-mode" role="group" aria-label="输入设备">
          <button
            aria-pressed={navigationMode === "trackpad"}
            onClick={() => setNavigationMode("trackpad")}
          >
            触摸板
          </button>
          <button
            aria-pressed={navigationMode === "mouse"}
            onClick={() => setNavigationMode("mouse")}
          >
            鼠标
          </button>
        </div>
        <p className="interaction-controls__hint">
          {navigationMode === "trackpad"
            ? "双指平移 · 捏合缩放"
            : "拖动平移 · 滚轮缩放"}
        </p>
        <div className="interaction-controls__row">
          <button
            onClick={() => mapRef.current?.zoomBy(-1)}
            aria-label="缩小"
            title="缩小"
          >
            <Minus size={18} />
          </button>
          <span
            className="zoom-level"
            aria-label={`缩放级别 ${camera.zoom.toFixed(1)}`}
          >
            Z {camera.zoom.toFixed(1)}
          </span>
          <button
            onClick={() => mapRef.current?.zoomBy(1)}
            aria-label="放大"
            title="放大"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="interaction-controls__row">
          <button
            onClick={() => mapRef.current?.rotateBy(-15)}
            aria-label="向左旋转 15 度"
            title="向左旋转 15°"
          >
            <RotateCcw size={17} />
          </button>
          <button
            className="compass-button"
            onClick={() => mapRef.current?.resetBearing()}
            aria-label="朝向正北"
            title="恢复北朝上"
          >
            <span>N</span>
            <Compass
              size={19}
              style={{ transform: `rotate(${-camera.bearing}deg)` }}
            />
          </button>
          <button
            onClick={() => mapRef.current?.rotateBy(15)}
            aria-label="向右旋转 15 度"
            title="向右旋转 15°"
          >
            <RotateCw size={17} />
          </button>
        </div>
        <div className="interaction-controls__row">
          <button
            className={`dimension-button ${is3D ? "active" : ""}`}
            onClick={() => setIs3D((p) => !p)}
            aria-label={is3D ? "切换到二维地图" : "切换到三维地图"}
            title="切换平面 / 倾斜视图"
          >
            {is3D ? "3D" : "2D"}
          </button>
          <button
            className="overview-button"
            onClick={() => chooseRegion("socal")}
            aria-label="回到 SoCal 全览"
            title="SoCal 全览 · 北朝上"
          >
            <Crosshair size={16} /> SoCal
          </button>
        </div>
      </div>
      <details className="map-legend panel">
        <summary className="eyebrow">{currentMode.name}图例</summary>
        {(roads.length > 0
          ? [
              [roadColors[roads[0].id], "道路颜色见高亮列表"],
              ...(showCityBoundaries ? [["#735581", "城市边界 / 交界点"]] : []),
              ...(roadDisplayMode === "context"
                ? [["#d19b52", "周边道路网络"]]
                : []),
            ]
          : LEGENDS[mode]
        ).map(([color, label]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
        {roads.length + selectedRoutes.length > 1 && (
          <span>
            <i className="overlap-key" />
            棋盘色表示共线路段
          </span>
        )}
        {mode === "roads" && (
          <small>{road ? "完整道路 · SoCal 范围内" : "颜色表示道路等级"}</small>
        )}
        {mode === "transit" && (
          <small>
            {selectedRoutes.length
              ? "已选线路使用独立高亮色 · 重合处为棋盘"
              : "浏览线路使用机构原色"}
          </small>
        )}
      </details>
      <HighlightsTray
        roads={roads}
        routes={selectedRoutes}
        pendingRoads={pendingRoads}
        roadColors={roadColors}
        onFocusRoad={chooseRoad}
        onFocusRoute={chooseRoute}
        onRemoveRoad={removeRoad}
        onRemoveRoute={removeRoute}
        onClear={clearHighlights}
        onFitAll={fitHighlights}
      />
      <nav className="mode-dock panel" aria-label="地图视图">
        {VIEW_MODES.map((view) => {
          const Icon = ICONS[view.id];
          return (
            <button
              key={view.id}
              className={mode === view.id ? "active" : ""}
              onClick={() => switchMode(view.id)}
              aria-pressed={mode === view.id}
            >
              <Icon size={22} strokeWidth={1.65} />
              <span>
                {view.name}
                <small>{view.english}</small>
              </span>
              {mode === view.id && <i />}
            </button>
          );
        })}
      </nav>
      <div className={`load-status ${status.state}`} role="status">
        <span />
        {status.state === "ready" ? "地图已连接" : status.message}
        {(status.state === "error" || status.state === "degraded") && (
          <button onClick={() => setMapGeneration((v) => v + 1)}>重试</button>
        )}
      </div>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          SOUTHERN CALIFORNIA <b> / </b> {region.shortName}
        </span>
        <span className="camera-coordinates">
          {Math.abs(camera.latitude).toFixed(4)}°{" "}
          {camera.latitude >= 0 ? "N" : "S"} &nbsp;{" "}
          {Math.abs(camera.longitude).toFixed(4)}°{" "}
          {camera.longitude >= 0 ? "E" : "W"} <b> / </b> Z{" "}
          {camera.zoom.toFixed(1)} <b> / </b>{" "}
          {is3D ? "PERSPECTIVE" : "ORTHOGRAPHIC"}
        </span>
        <span className="gesture-hint">
          {navigationMode === "trackpad"
            ? "双指平移 · 捏合缩放"
            : "拖动平移 · 滚轮缩放"}{" "}
          · 点击 N 恢复北向
        </span>
      </footer>
      {sourcesOpen && (
        <SourcesDialog
          onClose={() => setSourcesOpen(false)}
          manifest={manifest}
        />
      )}
    </main>
  );
}
