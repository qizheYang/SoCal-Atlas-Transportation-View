import { useMemo, useState, useDeferredValue } from "react";
import { Check, Crosshair, Route, Search, X } from "lucide-react";
import { createRoadSearch, roadCityLabel } from "../data/roads";
import type {
  Coordinates,
  RoadEndpoint,
  RoadCatalog,
  RoadCity,
  RoadDisplayMode,
  RoadRecord,
} from "../types";
import "./roads.css";

export function RoadsPanel({
  catalog,
  selectedIds,
  loadingIds,
  error,
  onRetry,
  onSelect,
  onClear,
  query,
  onQuery,
}: {
  catalog: RoadCatalog | null;
  selectedIds: string[];
  loadingIds: string[];
  error: string;
  onRetry: () => void;
  onSelect: (road: RoadRecord) => void;
  onClear: () => void;
  query: string;
  onQuery: (query: string) => void;
}) {
  const setQuery = onQuery;
  const [kind, setKind] = useState<"all" | RoadRecord["kind"]>("all");
  const [cityId, setCityId] = useState("all");
  const [limit, setLimit] = useState(40);
  const deferredQuery = useDeferredValue(query);
  const search = useMemo(
    () => (catalog ? createRoadSearch(catalog) : null),
    [catalog],
  );
  const cities = useMemo(
    () => new Map(catalog?.cities.map((c) => [c.id, c]) || []),
    [catalog],
  );
  const results = useMemo(
    () => search?.(deferredQuery, kind, cityId) || [],
    [search, deferredQuery, kind, cityId],
  );
  const cityOptions = useMemo(
    () => [...cities.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [cities],
  );
  return (
    <section className="road-browser" aria-label="道路目录">
      <div className="section-caption">
        <span>道路目录 · SoCal</span>
        <span>
          {catalog ? `${catalog.roads.length.toLocaleString()} 条` : "加载中"}
        </span>
      </div>
      <label className="road-search">
        <Search size={15} />
        <input
          aria-label="搜索道路名称或编号"
          placeholder="I-405、Main St、Sunset…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(40);
          }}
        />
        {query && (
          <button aria-label="清除道路搜索" onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </label>
      <div className="road-kind" role="group" aria-label="道路类别">
        {(
          [
            ["all", "全部"],
            ["highway", "高速 / 编号公路"],
            ["street", "普通道路"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={kind === id}
            className={kind === id ? "active" : ""}
            onClick={() => {
              setKind(id);
              setLimit(40);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="field-label" htmlFor="road-city">
        按城市 / 地区筛选
      </label>
      <select
        id="road-city"
        value={cityId}
        onChange={(e) => {
          setCityId(e.target.value);
          setLimit(40);
        }}
      >
        <option value="all">全部城市与地区 · 跨城道路完整保留</option>
        {cityOptions.map((city) => (
          <option key={city.id} value={city.id}>
            {roadCityLabel(city)} · {city.county}
          </option>
        ))}
      </select>
      <p className="panel-note">
        同名道路按城市确认；相连的跨城道路合为一项。城市筛选不会截断道路。
      </p>
      {(selectedIds.length > 0 || loadingIds.length > 0) && (
        <button className="clear-route" onClick={onClear}>
          <X size={13} />
          清除道路高亮
        </button>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button className="road-retry" onClick={onRetry}>
            重试加载
          </button>
        </div>
      )}
      {!catalog && !error && (
        <p className="panel-note" role="status">
          正在加载SoCal 道路索引…
        </p>
      )}
      {catalog && (
        <>
          <div className="road-result-count" aria-live="polite">
            {results.length.toLocaleString()} 个匹配项
            {query !== deferredQuery ? " · 正在筛选" : ""}
          </div>
          <div className="road-list">
            {results.slice(0, limit).map((road) => (
              <button
                key={road.id}
                className={`road-item ${selectedIds.includes(road.id) ? "selected" : ""}`}
                onClick={() => onSelect(road)}
                aria-pressed={selectedIds.includes(road.id)}
              >
                <span className={`road-type ${road.kind}`}>
                  <Route size={15} />
                </span>
                <span className="road-item-copy">
                  <strong>{road.name}</strong>
                  <small>
                    {road.cityIds
                      .map((id) => cities.get(id))
                      .filter((c): c is RoadCity => !!c)
                      .map(roadCityLabel)
                      .join(" · ") || "边界匹配待确认"}
                  </small>
                  <em>
                    {road.kind === "highway" ? "编号公路" : "普通道路"} ·{" "}
                    {road.lengthKm.toFixed(1)} km
                    {loadingIds.includes(road.id) ? " · 加载中…" : ""}
                  </em>
                </span>
                {selectedIds.includes(road.id) && <Check size={13} />}
              </button>
            ))}
            {!results.length && (
              <p className="panel-note">
                没有匹配的道路。试试其他英文名称、缩写或城市。
              </p>
            )}
          </div>
          {results.length > limit && (
            <button
              className="road-more"
              onClick={() => setLimit((n) => n + 60)}
            >
              显示更多（已显示 {Math.min(limit, results.length)} /{" "}
              {results.length.toLocaleString()}）
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function RoadDetails({
  road,
  cities,
  displayMode,
  onDisplayMode,
  showBoundaries,
  onBoundaries,
  boundaryError,
  onClose,
  onFit,
  onCity,
  endpoints,
  onEndpoint,
}: {
  road: RoadRecord;
  cities: RoadCity[];
  displayMode: RoadDisplayMode;
  onDisplayMode: (mode: RoadDisplayMode) => void;
  showBoundaries: boolean;
  onBoundaries: (show: boolean) => void;
  boundaryError: string;
  onClose: () => void;
  onFit: () => void;
  onCity: (city: RoadCity) => void;
  endpoints: RoadEndpoint[] | null;
  onEndpoint: (coordinates: Coordinates) => void;
}) {
  const endpointItem = (point: RoadEndpoint, index: number) => (
    <li key={`${point.coordinates.join(",")}-${index}`}>
      <button onClick={() => onEndpoint(point.coordinates)}>
        <span>
          <strong>
            端点 {index + 1} ·{" "}
            {point.cityIds
              .map((id) => cities.find((city) => city.id === id)?.name)
              .filter(Boolean)
              .join(" / ") || "区域边缘"}
          </strong>
          <small>
            {point.coordinates[1].toFixed(5)}° N,{" "}
            {Math.abs(point.coordinates[0]).toFixed(5)}° W
          </small>
        </span>
        <Crosshair size={13} />
      </button>
    </li>
  );
  return (
    <section className="road-detail panel" aria-label="道路详情">
      <header>
        <span className="eyebrow">ROAD CORRIDOR</span>
        <button aria-label="关闭道路详情" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="road-detail-title">
        <Route size={23} />
        <h2>{road.name}</h2>
      </div>
      <p className="road-detail-sub">
        {road.kind === "highway" ? "高速 / 编号公路" : "普通道路"} · SoCal
        范围内
      </p>
      <button className="road-fit" onClick={onFit}>
        <Crosshair size={14} />
        查看整条道路
      </button>
      <div className="road-kind" role="group" aria-label="道路显示方式">
        <button
          aria-pressed={displayMode === "context"}
          className={displayMode === "context" ? "active" : ""}
          onClick={() => onDisplayMode("context")}
        >
          保留道路网络
        </button>
        <button
          aria-pressed={displayMode === "isolated"}
          className={displayMode === "isolated" ? "active" : ""}
          onClick={() => onDisplayMode("isolated")}
        >
          只看选中道路
        </button>
      </div>
      <label className="road-boundaries">
        <input
          type="checkbox"
          checked={showBoundaries}
          onChange={(e) => onBoundaries(e.target.checked)}
        />
        <span>显示已选道路的城市边界与名称</span>
      </label>
      {boundaryError && (
        <p className="inline-error" role="alert">
          {boundaryError}
        </p>
      )}
      <div className="road-stats">
        <span>
          <strong>{road.lengthKm.toFixed(1)}</strong>
          <small>km · 路段几何总长</small>
        </span>
        <span>
          <strong>{cities.length}</strong>
          <small>个城市 / 地区</small>
        </span>
      </div>
      <h3>
        起终点位置{" "}
        <span>
          {endpoints === null ? "未加载" : `${endpoints.length} 个地理端点`}
        </span>
      </h3>
      <p className="road-detail-note">
        未指定行驶方向。以下为 SoCal
        数据范围内的开放端点；分支、断续段及双向车道可能有多个端点，点击可定位。
      </p>
      {endpoints === null ? (
        <p className="road-detail-note">该道路的端点信息暂不可用。</p>
      ) : endpoints.length === 0 ? (
        <p className="road-detail-note">源几何没有开放端点（例如闭合环路）。</p>
      ) : (
        <>
          <ol className="road-cities road-endpoints">
            {endpoints.slice(0, 4).map(endpointItem)}
          </ol>
          {endpoints.length > 4 && (
            <details className="road-aliases">
              <summary>查看其余 {endpoints.length - 4} 个端点</summary>
              <ol className="road-cities road-endpoints">
                {endpoints
                  .slice(4)
                  .map((point, index) => endpointItem(point, index + 4))}
              </ol>
            </details>
          )}
        </>
      )}
      <h3>
        沿线城市与地区 <span>全部 {cities.length}</span>
      </h3>
      <p className="road-detail-note">
        按名称排列，非行驶顺序；沿边界的道路可能属于两侧城市。
      </p>
      <ol className="road-cities">
        {cities.map((city) => (
          <li key={city.id}>
            <button onClick={() => onCity(city)} disabled={!city.bounds}>
              <span>
                <strong>{roadCityLabel(city)}</strong>
                <small>{city.county}</small>
              </span>
              {city.bounds && <Crosshair size={13} />}
            </button>
          </li>
        ))}
      </ol>
      {road.aliases.filter((name) => name !== road.name).length > 0 && (
        <details className="road-aliases">
          <summary>其他名称与编号</summary>
          <p>{road.aliases.filter((name) => name !== road.name).join(" · ")}</p>
        </details>
      )}
      <p className="road-detail-note">
        范围限当前 SoCal
        数据覆盖区。长度包含独立车道及分支，非单向行驶里程；同名但不相连的普通道路分别列出。
      </p>
      <a
        className="road-source"
        href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html"
        target="_blank"
        rel="noreferrer"
      >
        U.S. Census · TIGER/Line 2025 ↗
      </a>
    </section>
  );
}
