import type { NavigationMode } from "../types";

interface NavigationSurface extends EventTarget {
  clientWidth: number;
  clientHeight: number;
  getBoundingClientRect(): { left: number; top: number };
}

export interface NavigationDriver {
  panBy(offset: [number, number]): void;
  zoomTo(zoom: number, point: [number, number]): void;
  getZoom(): number;
  setScrollZoom(enabled: boolean): void;
}

interface FrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
  now(): number;
}

interface SafariGesture extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** Wheel delta modes are units, not a reliable mouse/trackpad detector. */
export function wheelPixels(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  width: number,
  height: number,
): [number, number] {
  const xUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
  const yUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  return [event.deltaX * xUnit, event.deltaY * yUnit];
}

/**
 * Own trackpad wheel events before MapLibre's bubbling wheel listener. Mouse
 * mode delegates wheel zoom to MapLibre. Listeners only cover the map canvas,
 * so scrolling a search list or inspector never moves the map beneath it.
 */
export function installMapNavigation(
  surface: NavigationSurface,
  driver: NavigationDriver,
  initialMode: NavigationMode = "trackpad",
  frames: FrameScheduler = browserFrames,
) {
  let mode = initialMode;
  let disposed = false;
  let frame: number | undefined;
  let panX = 0;
  let panY = 0;
  let zoomDelta = 0;
  let absoluteZoom: number | undefined;
  let zoomPoint: [number, number] = [0, 0];
  let touchCount = 0;
  let gestureActive = false;
  let gestureUsesWheel = false;
  let gestureBaseZoom = 0;
  let lastPinchWheelAt = -Infinity;
  let suppressWheelUntil = -Infinity;

  const flush = () => {
    frame = undefined;
    if (disposed) return;
    if (panX || panY) driver.panBy([panX, panY]);
    if (absoluteZoom !== undefined || zoomDelta) {
      // One frame cannot jump more than one zoom level on a malformed wheel.
      const zoom =
        absoluteZoom ?? driver.getZoom() + Math.max(-1, Math.min(1, zoomDelta));
      driver.zoomTo(zoom, zoomPoint);
    }
    panX = panY = zoomDelta = 0;
    absoluteZoom = undefined;
  };
  const schedule = () => {
    if (frame === undefined) frame = frames.request(flush);
  };
  const localPoint = (event: {
    clientX: number;
    clientY: number;
  }): [number, number] => {
    const rect = surface.getBoundingClientRect();
    return [
      Number.isFinite(event.clientX)
        ? event.clientX - rect.left
        : surface.clientWidth / 2,
      Number.isFinite(event.clientY)
        ? event.clientY - rect.top
        : surface.clientHeight / 2,
    ];
  };
  const consume = (event: Event) => {
    event.preventDefault();
    // Capture phase stops MapLibre from processing this same wheel event.
    event.stopPropagation();
  };
  const wheel = (raw: Event) => {
    const event = raw as WheelEvent;
    const now = frames.now();
    if ((gestureActive && !gestureUsesWheel) || now < suppressWheelUntil) {
      consume(event);
      return;
    }
    if (event.ctrlKey) lastPinchWheelAt = now;
    if (mode === "mouse") return;
    consume(event);
    const [x, y] = wheelPixels(
      event,
      surface.clientWidth,
      surface.clientHeight,
    );
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (event.ctrlKey) {
      zoomDelta -= y / 100;
      zoomPoint = localPoint(event);
    } else {
      panX += x;
      panY += y;
    }
    schedule();
  };
  const gestureStart = (raw: Event) => {
    // iOS touch gestures are already handled by MapLibre's touchZoomRotate.
    if (touchCount) return;
    consume(raw);
    if (frame !== undefined) {
      frames.cancel(frame);
      flush();
    }
    gestureActive = true;
    // WebKit versions may emit both streams. Use whichever arrived first.
    gestureUsesWheel = frames.now() - lastPinchWheelAt < 100;
    gestureBaseZoom = driver.getZoom();
  };
  const gestureChange = (raw: Event) => {
    if (!gestureActive) return;
    consume(raw);
    const event = raw as SafariGesture;
    if (gestureUsesWheel || !Number.isFinite(event.scale) || event.scale <= 0)
      return;
    absoluteZoom = gestureBaseZoom + Math.log2(event.scale);
    zoomPoint = localPoint(event);
    schedule();
  };
  const gestureEnd = (event: Event) => {
    if (!gestureActive) return;
    consume(event);
    if (!gestureUsesWheel) suppressWheelUntil = frames.now() + 100;
    gestureActive = false;
  };
  const touches = (event: Event) => {
    touchCount = (event as TouchEvent).touches.length;
  };
  const reset = () => {
    if (frame !== undefined) frames.cancel(frame);
    frame = undefined;
    panX = panY = zoomDelta = 0;
    absoluteZoom = undefined;
    gestureActive = false;
    lastPinchWheelAt = suppressWheelUntil = -Infinity;
  };
  const listeners: [string, EventListener, boolean][] = [
    ["wheel", wheel, false],
    ["gesturestart", gestureStart, false],
    ["gesturechange", gestureChange, false],
    ["gestureend", gestureEnd, false],
    ["touchstart", touches, true],
    ["touchend", touches, true],
    ["touchcancel", touches, true],
  ];
  for (const [name, listener, passive] of listeners)
    surface.addEventListener(name, listener, { capture: true, passive });
  driver.setScrollZoom(mode === "mouse");
  return {
    setMode(next: NavigationMode) {
      if (next === mode || disposed) return;
      reset();
      mode = next;
      driver.setScrollZoom(mode === "mouse");
    },
    dispose() {
      disposed = true;
      reset();
      for (const [name, listener] of listeners)
        surface.removeEventListener(name, listener, { capture: true });
    },
  };
}
