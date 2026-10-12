import type { CSSProperties } from "react";
import {
  Bus,
  LoaderCircle,
  Maximize2,
  Route,
  TrainFront,
  X,
} from "lucide-react";
import type { RoadRecord, TransitRoute } from "../types";
import "./highlights.css";

export interface HighlightsTrayProps {
  roads: RoadRecord[];
  routes: TransitRoute[];
  pendingRoads: RoadRecord[];
  roadColors: Record<string, string>;
  onFocusRoad: (road: RoadRecord) => void;
  onFocusRoute: (route: TransitRoute) => void;
  onRemoveRoad: (id: string) => void;
  onRemoveRoute: (id: string) => void;
  onClear: () => void;
  onFitAll: () => void;
}

function colorStyle(color: string): CSSProperties {
  return { "--highlight-color": color } as CSSProperties;
}

function routeLabel(route: TransitRoute): string {
  return route.shortName && route.shortName !== route.longName
    ? `${route.shortName} · ${route.longName}`
    : route.longName || route.shortName;
}

export function HighlightsTray({
  roads,
  routes,
  pendingRoads,
  roadColors,
  onFocusRoad,
  onFocusRoute,
  onRemoveRoad,
  onRemoveRoute,
  onClear,
  onFitAll,
}: HighlightsTrayProps) {
  const loadedIds = new Set(roads.map((road) => road.id));
  const pending = pendingRoads.filter((road) => !loadedIds.has(road.id));
  const resolvedCount = roads.length + routes.length;
  const count = resolvedCount + pending.length;
  if (!count) return null;

  return (
    <section className="highlights-tray panel" aria-label="地图高亮">
      <header className="highlights-tray__header">
        <h2 aria-live="polite">
          已高亮 <span>· {count}</span>
          {pending.length > 0 && <small>{pending.length} 条加载中</small>}
        </h2>
        <div className="highlights-tray__actions">
          <button
            type="button"
            onClick={onFitAll}
            disabled={!resolvedCount}
            aria-label="查看全部高亮道路与线路"
          >
            <Maximize2 size={12} aria-hidden="true" />
            查看全部
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="清空全部高亮与加载中的道路"
          >
            清空
          </button>
        </div>
      </header>

      <ul className="highlights-tray__list" aria-label="已选择的道路与线路">
        {roads.map((road) => (
          <li
            className="highlights-chip"
            key={`road-${road.id}`}
            style={colorStyle(roadColors[road.id] || "#8bdcc3")}
          >
            <button
              type="button"
              className="highlights-chip__focus"
              onClick={() => onFocusRoad(road)}
              aria-label={`聚焦 ${road.name}`}
              title={`${road.kind === "highway" ? "高速 / 编号公路" : "道路"} · ${road.name}`}
            >
              <i className="highlights-chip__color" aria-hidden="true" />
              <Route size={12} aria-hidden="true" />
              <span>{road.name}</span>
            </button>
            <button
              type="button"
              className="highlights-chip__remove"
              onClick={() => onRemoveRoad(road.id)}
              aria-label={`移除 ${road.name} 高亮`}
              title={`移除 ${road.name} 高亮`}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}

        {routes.map((route) => {
          const label = routeLabel(route);
          const TransitIcon = [0, 1, 2].includes(route.type) ? TrainFront : Bus;
          return (
            <li
              className="highlights-chip"
              key={`route-${route.id}`}
              style={colorStyle(
                route.highlightColor || route.color || "#8bdcc3",
              )}
            >
              <button
                type="button"
                className="highlights-chip__focus"
                onClick={() => onFocusRoute(route)}
                aria-label={`聚焦 ${label}`}
                title={`${route.agencyId} · ${label}`}
              >
                <i className="highlights-chip__color" aria-hidden="true" />
                <TransitIcon size={12} aria-hidden="true" />
                <span>{label}</span>
              </button>
              <button
                type="button"
                className="highlights-chip__remove"
                onClick={() => onRemoveRoute(route.id)}
                aria-label={`移除 ${label} 高亮`}
                title={`移除 ${label} 高亮`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          );
        })}

        {pending.map((road) => (
          <li
            className="highlights-chip highlights-chip--pending"
            key={`pending-${road.id}`}
            style={colorStyle(roadColors[road.id] || "#8bdcc3")}
          >
            <button
              type="button"
              className="highlights-chip__focus"
              disabled
              aria-label={`${road.name} 加载中`}
            >
              <LoaderCircle
                className="highlights-chip__spinner"
                size={12}
                aria-hidden="true"
              />
              <span>{road.name}</span>
              <small>加载中</small>
            </button>
            <button
              type="button"
              className="highlights-chip__remove"
              onClick={() => onRemoveRoad(road.id)}
              aria-label={`取消 ${road.name} 加载`}
              title={`取消 ${road.name} 加载`}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
