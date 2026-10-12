import { useState } from "react";
import { ArrowDown, Bus, Crosshair, MapPin, TrainFront, X } from "lucide-react";
import type {
  Coordinates,
  TransitAgency,
  TransitRoute,
  TransitRouteDetails,
} from "../types";
import "./roads.css";
import "./transitDetails.css";

export function TransitDetails({
  route,
  agency,
  details,
  error,
  onClose,
  onFit,
  onEndpoint,
}: {
  route: TransitRoute;
  agency?: TransitAgency;
  details: TransitRouteDetails | null;
  error?: string;
  onClose: () => void;
  onFit: () => void;
  onEndpoint: (coordinates: Coordinates) => void;
}) {
  // Key expansion by route so another selected line starts with its primary
  // patterns instead of inheriting a previous long expanded list.
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const expanded = expandedRoute === route.id;
  const endpoints = details?.endpoints || [];
  const minimum = details?.lengthKm.min.toFixed(1);
  const maximum = details?.lengthKm.max.toFixed(1);
  const length = minimum === maximum ? maximum : `${minimum}–${maximum}`;
  const Icon = route.type === 3 ? Bus : TrainFront;
  return (
    <section
      className="road-detail panel transit-detail"
      aria-label="公共交通线路详情"
    >
      <header>
        <span className="eyebrow">TRANSIT LINE</span>
        <button aria-label="关闭线路详情" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="road-detail-title">
        <Icon size={23} />
        <h2>{route.longName || route.shortName}</h2>
      </div>
      <p className="road-detail-sub">
        {route.operatorName || agency?.name || route.agencyId} ·{" "}
        {route.type === 3 ? "公交线路" : "轨道交通"} · {route.shortName}
      </p>
      {route.highlightColor &&
        route.highlightColor.toLowerCase() !== route.color.toLowerCase() && (
          <p className="road-detail-note">
            原色已被其他高亮使用，已分配独立对比色。
          </p>
        )}
      {agency?.archiveDate && (
        <p className="road-detail-note">
          归档快照：{agency.archiveDate}
          。当前机构下载入口不可用，展示有日期记录的官方 GTFS 归档。
        </p>
      )}
      <button className="road-fit" onClick={onFit}>
        <Crosshair size={14} />
        查看整条线路
      </button>
      {!details ? (
        <p className="road-detail-note" role="status">
          {error || "正在读取线路长度与首末站…"}
        </p>
      ) : (
        <>
          <div className="road-stats transit-stats">
            <span>
              <strong>{length}</strong>
              <small>
                km · 已映射线路长度{minimum !== maximum ? "范围" : ""}
              </small>
            </span>
            <span>
              <strong>{details.patternCount}</strong>
              <small>种线路形状</small>
            </span>
          </div>
          <p className="road-detail-note">
            源线路形状分别计量，不把不同方向与分支相加。短线班次可能共用整线形状，因此长度与每组首末站不一一对应。
          </p>
          <h3>
            首末站 <span>{endpoints.length} 组方向 / 区间</span>
          </h3>
          <p className="road-detail-note">
            来自排班班次的第一站与最后一站，按源班次数量排列。点击站名定位。
          </p>
          <ol className="transit-endpoints">
            {endpoints.slice(0, expanded ? endpoints.length : 4).map((pair) => (
              <li key={`${pair.from.id}|${pair.to.id}`}>
                <button
                  onClick={() => onEndpoint(pair.from.coordinates)}
                  aria-label={`定位起点 ${pair.from.name}`}
                >
                  <MapPin size={13} />
                  <span>
                    <small>起点</small>
                    <strong>{pair.from.name}</strong>
                  </span>
                  <Crosshair size={12} />
                </button>
                <ArrowDown className="transit-endpoint-arrow" size={13} />
                <button
                  onClick={() => onEndpoint(pair.to.coordinates)}
                  aria-label={`定位终点 ${pair.to.name}`}
                >
                  <MapPin size={13} />
                  <span>
                    <small>终点</small>
                    <strong>{pair.to.name}</strong>
                  </span>
                  <Crosshair size={12} />
                </button>
              </li>
            ))}
          </ol>
          {endpoints.length > 4 && (
            <button
              className="road-more"
              onClick={() => setExpandedRoute(expanded ? null : route.id)}
            >
              {expanded
                ? "收起首末站列表"
                : `显示全部 ${endpoints.length} 组首末站`}
            </button>
          )}
          {route.agencyId === "metrolink" && (
            <p className="road-detail-note">
              Metrolink
              长度来自官方整线形状；部分班次短线折返，以上长度与每组首末站不一一对应。
            </p>
          )}
          <p className="road-detail-note">
            GTFS 静态排班快照，不代表实时运营或今日发车。
            {details.fetchedAt
              ? `数据获取：${details.fetchedAt.slice(0, 10)}。`
              : ""}
          </p>
          <a
            className="road-source"
            href={details.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            {details.source} ↗
          </a>
        </>
      )}
    </section>
  );
}
