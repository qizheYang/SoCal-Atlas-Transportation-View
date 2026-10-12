import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  Building2,
  Check,
  Crosshair,
  Database,
  ExternalLink,
  Layers3,
  MapPin,
  Mountain,
  MousePointer2,
  Route,
  TrainFront,
  TramFront,
  Type,
  Waypoints,
  X,
} from "lucide-react";
import type {
  FeatureInfo,
  LayerSettings,
  TransitAgency,
  TransitManifest,
} from "../types";
import "./panels.css";

const layerOptions = [
  {
    key: "buildings",
    label: "城市建筑",
    hint: "建筑轮廓与体块",
    Icon: Building2,
  },
  {
    key: "roads",
    label: "街道网络",
    hint: "主干道 · 街道 · 步道",
    Icon: Route,
  },
  {
    key: "highways",
    label: "高速公路",
    hint: "高速干线与连接匝道",
    Icon: Waypoints,
  },
  {
    key: "pois",
    label: "兴趣地点",
    hint: "生活 · 文化 · 公共服务",
    Icon: MapPin,
  },
  {
    key: "transit",
    label: "公共交通",
    hint: "公交与轨道交通线路",
    Icon: TramFront,
  },
  {
    key: "rail",
    label: "铁路设施",
    hint: "实际铁路基础设施",
    Icon: TrainFront,
  },
  { key: "labels", label: "地图标注", hint: "地点名称与道路名称", Icon: Type },
  {
    key: "terrain",
    label: "地形阴影",
    hint: "山脉与地势的明暗",
    Icon: Mountain,
  },
] as const;

export function LayerPanel({
  layers,
  onChange,
}: {
  layers: LayerSettings;
  onChange: (key: keyof LayerSettings, value: boolean) => void;
}) {
  const enabledCount = Object.values(layers).filter(Boolean).length;
  return (
    <section className="layer-panel" aria-labelledby="layer-panel-title">
      <header className="layer-panel__header">
        <div className="layer-panel__title">
          <Layers3 size={17} aria-hidden="true" />
          <h2 id="layer-panel-title">地图图层</h2>
        </div>
        <span className="layer-panel__count">
          {enabledCount} / {layerOptions.length}
        </span>
      </header>
      <div className="layer-panel__list">
        {layerOptions.map(({ key, label, hint, Icon }) => (
          <button
            className={`layer-panel__row${layers[key] ? " is-enabled" : ""}`}
            type="button"
            role="switch"
            aria-checked={layers[key]}
            aria-label={label}
            key={key}
            onClick={() => onChange(key, !layers[key])}
          >
            <span className="layer-panel__icon">
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className="layer-panel__copy">
              <span className="layer-panel__label">{label}</span>
              <span className="layer-panel__hint">{hint}</span>
            </span>
            <span className="layer-panel__switch" aria-hidden="true">
              <span>{layers[key] && <Check size={9} strokeWidth={3} />}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="layer-panel__footnote">
        <MousePointer2 size={13} aria-hidden="true" />
        放大地图，探索街区的更多细节
      </p>
    </section>
  );
}

const featureKinds = {
  road: { label: "道路", english: "ROAD NETWORK", Icon: Route },
  building: { label: "建筑", english: "CITY BUILDING", Icon: Building2 },
  poi: { label: "兴趣地点", english: "POINT OF INTEREST", Icon: MapPin },
  "transit-route": {
    label: "交通线路",
    english: "TRANSIT LINE",
    Icon: TramFront,
  },
  "transit-stop": {
    label: "交通站点",
    english: "TRANSIT STOP",
    Icon: TrainFront,
  },
  land: { label: "地理要素", english: "LANDSCAPE", Icon: Mountain },
};

function attribute(
  properties: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return null;
}

function sourceFacts(feature: FeatureInfo): [string, string][] {
  const p = feature.properties;
  const facts: [string, string][] = [];
  const add = (
    label: string,
    keys: string[],
    format: (value: string) => string = (value) => value,
  ) => {
    const value = attribute(p, keys);
    if (value !== null) facts.push([label, format(value)]);
  };
  if (feature.kind === "road") {
    add("道路编号", ["ref", "network_ref", "route_ref", "Reference"]);
    add("道路类型", [
      "kind_detail",
      "class",
      "highway",
      "kind",
      "Road / rail class",
    ]);
    add("道路等级", ["subclass", "Subtype"]);
    add("所属路网", ["network", "Network"]);
    add("车道数量", ["lanes"]);
    add("限速标记", ["maxspeed"]);
    add("道路表面", ["surface", "Surface"]);
    add(
      "道路结构",
      ["brunnel", "Structure"],
      (value) =>
        (({ bridge: "桥梁", tunnel: "隧道" }) as Record<string, string>)[
          value
        ] ?? value,
    );
    const oneway = attribute(p, ["oneway", "One-way"]);
    if (oneway !== null)
      facts.push([
        "单向通行",
        (
          {
            yes: "是",
            no: "否",
            "1": "是",
            "0": "否",
            "-1": "反向",
            "Along source geometry": "沿地图方向",
            "Against source geometry": "逆地图方向",
            No: "否",
          } as Record<string, string>
        )[oneway] ?? oneway,
      ]);
    add("收费道路", ["Toll"], (value) =>
      value === "Yes" ? "是" : value === "No" ? "否" : value,
    );
    add("连接匝道", ["Ramp"], (value) =>
      value === "Yes" ? "是" : value === "No" ? "否" : value,
    );
    if (p.bridge === true || p.bridge === "yes")
      facts.push(["道路结构", "桥梁"]);
    if (p.tunnel === true || p.tunnel === "yes")
      facts.push(["道路结构", "隧道"]);
  } else if (feature.kind === "building") {
    add("建筑用途", ["kind_detail", "building", "class"]);
    if (attribute(p, ["Estimated render height", "render_height"]) !== null)
      add("示意高度", ["Estimated render height", "render_height"], (value) =>
        /[a-z]/i.test(value) ? value : `${value} m`,
      );
    else
      add("地图高度", ["height"], (value) =>
        /[a-z]/i.test(value) ? value : `${value} m`,
      );
    if (p.Height === "Not available · display uses a visual extrusion")
      facts.push(["高度信息", "未提供 · 使用示意体块"]);
    add("楼层记录", ["building:levels", "levels"]);
    add("建筑地址", ["addr:full", "address"]);
  } else if (feature.kind === "transit-route") {
    add("线路编号", ["route_short_name", "shortName", "short_name", "Route"]);
    add("运营机构", [
      "agency_name",
      "agencyName",
      "agency",
      "agency_id",
      "agencyId",
      "Agency",
    ]);
    add("线路名称", [
      "route_long_name",
      "longName",
      "long_name",
      "Description",
    ]);
    add(
      "交通方式",
      ["route_type", "type", "GTFS route type"],
      (value) =>
        (
          ({
            "0": "有轨电车 / 轻轨",
            "1": "地铁",
            "2": "铁路",
            "3": "公交",
            "4": "渡轮",
            "11": "无轨电车",
            "12": "单轨",
          }) as Record<string, string>
        )[value] ?? value,
    );
    add("站点数量", ["stop_count", "stopCount"]);
  } else if (feature.kind === "transit-stop") {
    add("站点编号", ["stop_code", "stop_id", "id"]);
    add("运营机构", [
      "agency_name",
      "agencyName",
      "agency",
      "agency_id",
      "agencyId",
      "Agency",
    ]);
    add("站点说明", ["stop_desc", "description"]);
    add(
      "无障碍信息",
      ["wheelchair_boarding"],
      (value) =>
        (
          ({
            "0": "未提供",
            "1": "可无障碍乘车",
            "2": "不支持无障碍乘车",
          }) as Record<string, string>
        )[value] ?? value,
    );
    const routeIds = p["Routes at stop"];
    const routeCount = Array.isArray(routeIds)
      ? routeIds.length
      : typeof routeIds === "string" && routeIds.trim()
        ? routeIds.split(",").length
        : null;
    if (routeCount !== null) facts.push(["收录线路", `${routeCount} 条`]);
  } else {
    add("地点类型", [
      "kind_detail",
      "class",
      "kind",
      "amenity",
      "leisure",
      "Category",
    ]);
    add("细分类别", ["Type"]);
    add("地点地址", ["addr:full", "address"]);
    add("开放时间", ["opening_hours"]);
    add("运营方", ["operator", "brand"]);
  }
  return facts;
}

export function FeatureInspector({
  feature,
  onClose,
}: {
  feature: FeatureInfo | null;
  onClose: () => void;
}) {
  if (!feature) {
    return (
      <aside className="inspector inspector--empty" aria-label="地图要素详情">
        <div className="inspector__empty-icon">
          <Crosshair size={25} strokeWidth={1.2} aria-hidden="true" />
        </div>
        <div className="inspector__eyebrow">EXPLORE THE DETAILS</div>
        <h2>每个街区，都值得探索</h2>
        <p>
          点击建筑、道路或交通线路，
          <br />
          查看这个地方的地图信息。
        </p>
        <span className="inspector__empty-key">
          <MousePointer2 size={12} aria-hidden="true" />
          点击地图以选中
        </span>
      </aside>
    );
  }
  const { label, english, Icon } = featureKinds[feature.kind];
  const facts = sourceFacts(feature);
  const isTransit = feature.kind.startsWith("transit");
  return (
    <aside
      className="inspector"
      aria-labelledby="inspector-title"
      key={feature.id}
    >
      <header className="inspector__header">
        <span className="inspector__kind">
          <Icon size={15} aria-hidden="true" />
          {label}
        </span>
        <button
          className="inspector__close"
          type="button"
          aria-label="清除所选要素"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="inspector__body">
        <div className="inspector__eyebrow">{english}</div>
        <h2 id="inspector-title">{feature.name || "未命名地图要素"}</h2>
        {feature.coordinates && (
          <p className="inspector__coordinates">
            <Crosshair size={12} aria-hidden="true" />
            {Math.abs(feature.coordinates[1]).toFixed(5)}°{" "}
            {feature.coordinates[1] >= 0 ? "N" : "S"} ·{" "}
            {Math.abs(feature.coordinates[0]).toFixed(5)}°{" "}
            {feature.coordinates[0] >= 0 ? "E" : "W"}
          </p>
        )}
        {facts.length > 0 ? (
          <dl className="inspector__facts">
            {facts.map(([name, value], index) => (
              <div key={`${name}-${index}`}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="inspector__note">此地图要素暂未提供更多属性。</p>
        )}
        {feature.kind === "building" && (
          <p className="inspector__note">
            建筑体块用于帮助理解城市空间。地图高度可能包含估算，不能视为实测建筑高度。
          </p>
        )}
        {feature.kind === "road" && (
          <p className="inspector__note">
            显示地图中的道路属性。道路颜色表示分类；不代表实时车流或拥堵程度。
          </p>
        )}
        {isTransit && (
          <p className="inspector__note">
            线路与站点来自公开时刻表数据，展示计划服务，不代表车辆实时位置。
          </p>
        )}
      </div>
      <footer className="inspector__source">
        <Database size={12} aria-hidden="true" />
        <span>{feature.source}</span>
        {feature.sourceUrl && (
          <a
            href={feature.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`查看 ${feature.source} 数据来源`}
          >
            <ArrowUpRight size={15} />
          </a>
        )}
      </footer>
    </aside>
  );
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "America/Los_Angeles",
      });
}

interface AgencyCoverage extends TransitAgency {
  sourceUrl?: string;
  termsUrl?: string;
  skippedRoutes?: {
    id: string;
    shortName: string;
    longName: string;
    reason: string;
  }[];
  skippedShapeIds?: string[];
}

function AgencySourceCard({ agency }: { agency: AgencyCoverage }) {
  const omitted = Array.isArray(agency.skippedRoutes)
    ? agency.skippedRoutes
    : [];
  const skippedShapeCount = Array.isArray(agency.skippedShapeIds)
    ? agency.skippedShapeIds.length
    : 0;
  return (
    <article className="sources-modal__agency">
      <div>
        <a href={agency.url} target="_blank" rel="noreferrer">
          {agency.name}
          <ArrowUpRight size={14} />
        </a>
        <span>
          已收录 {agency.routeCount.toLocaleString()} 条线路 ·{" "}
          {agency.stopCount.toLocaleString()} 个站点
        </span>
      </div>
      <div className="sources-modal__agency-links">
        <a
          className="sources-modal__feed"
          href={agency.sourceUrl || agency.feedUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${agency.name} GTFS 数据源`}
        >
          数据源
          <ExternalLink size={11} />
        </a>
        {agency.termsUrl && (
          <a
            className="sources-modal__feed"
            href={agency.termsUrl}
            target="_blank"
            rel="noreferrer"
          >
            使用条款
            <ExternalLink size={11} />
          </a>
        )}
      </div>
      <small>
        获取于 {displayDate(agency.fetchedAt)} ·{" "}
        {agency.status === "ready" ? "已加载" : agency.status}
      </small>
      {agency.archiveDate && (
        <p className="sources-modal__coverage-note">
          官方 GTFS 归档日期：{agency.archiveDate}
          。当前机构入口不可用；此数据不是本次重新发布的排班。
          {agency.downloadUrl && (
            <a href={agency.downloadUrl} target="_blank" rel="noreferrer">
              查看实际归档来源
            </a>
          )}
        </p>
      )}
      {omitted.length > 0 && (
        <p className="sources-modal__coverage-note">
          未显示线路：
          {omitted.map((route) => route.shortName || route.id).join("、")}
          。源数据未提供可用的线路形状。
        </p>
      )}
      {skippedShapeCount > 0 && (
        <p className="sources-modal__coverage-note">
          另有 {skippedShapeCount}{" "}
          个无效线路形状未显示；相关线路的其他有效形状仍予保留。
        </p>
      )}
    </article>
  );
}

export function SourcesDialog({
  onClose,
  manifest,
}: {
  onClose: () => void;
  manifest: TransitManifest | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      // App keyboard shortcuts must not steal focus from the open dialog.
      if (event.key === "/") {
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex="0"]',
      );
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus();
    };
  }, []);
  return (
    <div
      className="sources-modal__backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sources-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sources-modal-title"
      >
        <header className="sources-modal__header">
          <div>
            <span className="sources-modal__eyebrow">
              OPEN DATA, REAL PLACES
            </span>
            <h2 id="sources-modal-title">这张地图从哪里来</h2>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="sources-modal__close"
            onClick={onClose}
            aria-label="关闭数据来源"
          >
            <X size={20} />
          </button>
        </header>
        <div className="sources-modal__body">
          <p className="sources-modal__intro">
            真实城市的开放数据，构成这片可探索的城市。地图内容与公开数据同步可能存在时间差。
          </p>
          <section className="sources-modal__section">
            <div className="sources-modal__section-title">
              <Layers3 size={17} />
              <h3>道路、建筑与兴趣地点</h3>
              <span>OSM</span>
            </div>
            <p>
              OpenFreeMap 提供基于 OpenMapTiles 的底图，使用 OpenStreetMap
              社区地图数据。道路、普通建筑与兴趣地点的覆盖取决于当地贡献；未标注的名称、高度和其他属性不会被当作已知事实。
            </p>
            <div className="sources-modal__links">
              <a
                href="https://openfreemap.org/"
                target="_blank"
                rel="noreferrer"
              >
                OpenFreeMap <ExternalLink size={12} />
              </a>
              <a
                href="https://openmaptiles.org/"
                target="_blank"
                rel="noreferrer"
              >
                © OpenMapTiles <ExternalLink size={12} />
              </a>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap contributors · ODbL <ExternalLink size={12} />
              </a>
            </div>
          </section>
          <section className="sources-modal__section">
            <div className="sources-modal__section-title">
              <Route size={17} />
              <h3>道路目录与城市边界</h3>
              <span>CENSUS</span>
            </div>
            <p>
              完整道路搜索使用 U.S. Census TIGER/Line 2025 SoCal
              道路快照；城市归属依据 TIGERweb 2026 的实际边界。包含建制城市、CDP
              与非建制地区，跨城道路保留 SoCal
              范围内全部路段。同名普通道路按几何连通性分组，20
              米容差吸收小间隙；道路长度包含分隔车道。背景 OSM
              与目录可能存在版本差异。
            </p>
            <div className="sources-modal__links">
              <a
                href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html"
                target="_blank"
                rel="noreferrer"
              >
                Census TIGER/Line <ExternalLink size={12} />
              </a>
              <a
                href="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"
                target="_blank"
                rel="noreferrer"
              >
                TIGERweb 边界 <ExternalLink size={12} />
              </a>
            </div>
          </section>
          <section className="sources-modal__section">
            <div className="sources-modal__section-title">
              <TramFront size={17} />
              <h3>公共交通网络</h3>
              <span>GTFS</span>
            </div>
            <p>
              公开 GTFS
              数据提供运营机构、计划线路和站点，按各运营机构的使用条款提供。不是实时到站信息；不同线路、运营机构和数据版本的覆盖可能不同。
            </p>
            {manifest?.agencies.length ? (
              <div className="sources-modal__agencies">
                {manifest.agencies.map((agency) => (
                  <AgencySourceCard agency={agency} key={agency.id} />
                ))}
              </div>
            ) : (
              <p className="sources-modal__unavailable">
                交通数据清单尚未加载。地图中的交通数据状态以当前加载结果为准。
              </p>
            )}
            {manifest?.generatedAt && (
              <p className="sources-modal__timestamp">
                交通数据集生成日期：{displayDate(manifest.generatedAt)}
              </p>
            )}
            {!!manifest?.coverageGaps?.length && (
              <div className="sources-modal__coverage-note">
                <h4>尚未覆盖</h4>
                {manifest.coverageGaps.map((gap) => (
                  <p key={gap.id}>
                    <strong>{gap.name}</strong>
                    <br />
                    {gap.reason}
                  </p>
                ))}
              </div>
            )}
          </section>
          <section className="sources-modal__section">
            <div className="sources-modal__section-title">
              <Mountain size={17} />
              <h3>地形与山脉</h3>
              <span>DEM</span>
            </div>
            <p>
              Mapterhorn
              汇集开放高程数据，为山脉与地势提供阴影。数据分辨率因地区而异，地形效果不等同于测绘精度。
            </p>
            <a
              href="https://mapterhorn.com/attribution"
              target="_blank"
              rel="noreferrer"
            >
              Mapterhorn · 高程数据来源 <ExternalLink size={12} />
            </a>
          </section>
          <section className="sources-modal__section">
            <div className="sources-modal__section-title">
              <Building2 size={17} />
              <h3>城市模型与覆盖范围</h3>
            </div>
            <p>
              覆盖 SoCal 的 10 县：Los Angeles、Orange、San
              Diego、Imperial、Riverside、San Bernardino、Ventura、Santa
              Barbara、San Luis
              Obispo、Kern。建筑体块是地图几何的可视化；未提供真实高度时使用示意高度。
            </p>
            <p>
              铁路设施表示铁路基础设施，不等同于客运线路。公交图层显示已收录运营机构的计划服务，不代表
              SoCal 全部公交服务。
            </p>
          </section>
          <div className="sources-modal__credit">
            <span className="sources-modal__credit-mark">S</span>
            <p>
              受 Cities: Skylines II 的地图编辑器与信息视图启发。
              <br />
              <span>独立地图查看器，与游戏发行方无关联。</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
