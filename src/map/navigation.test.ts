import { describe, expect, it, vi } from "vitest";
import { installMapNavigation, wheelPixels } from "./navigation";

class CanvasSurface extends EventTarget {
  clientWidth = 1000;
  clientHeight = 700;
  getBoundingClientRect() {
    return { left: 20, top: 30 };
  }
}

function setup(mode: "trackpad" | "mouse" = "trackpad") {
  const surface = new CanvasSurface();
  const frames = new Map<number, () => void>();
  let sequence = 0;
  let now = 1000;
  let zoom = 8;
  const driver = {
    panBy: vi.fn(),
    zoomTo: vi.fn((next: number) => {
      zoom = next;
    }),
    getZoom: () => zoom,
    setScrollZoom: vi.fn(),
  };
  const navigation = installMapNavigation(surface, driver, mode, {
    request: (callback) => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    cancel: (id) => {
      frames.delete(id);
    },
    now: () => now,
  });
  const send = (type: string, fields: object = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    surface.dispatchEvent(event);
    return event;
  };
  return {
    navigation,
    driver,
    wheel: (fields: object = {}) =>
      send("wheel", {
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
        clientX: 300,
        clientY: 250,
        ...fields,
      }),
    send,
    tick: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("map trackpad navigation", () => {
  it("normalizes pixel, line, and page delta units on both axes", () => {
    expect(
      wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 0 }, 1000, 700),
    ).toEqual([2, -3]);
    expect(
      wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 1 }, 1000, 700),
    ).toEqual([32, -48]);
    expect(
      wheelPixels({ deltaX: 1, deltaY: -1, deltaMode: 2 }, 1000, 700),
    ).toEqual([1000, -700]);
  });

  it("batches diagonal two-finger scrolling into panning without changing zoom", () => {
    const app = setup();
    expect(app.driver.setScrollZoom).toHaveBeenCalledWith(false);
    expect(app.wheel({ deltaX: 8, deltaY: 12 }).defaultPrevented).toBe(true);
    app.wheel({ deltaX: 2, deltaY: -3 });
    expect(app.driver.panBy).not.toHaveBeenCalled();
    app.tick();
    expect(app.driver.panBy).toHaveBeenCalledExactlyOnceWith([10, 9]);
    expect(app.driver.zoomTo).not.toHaveBeenCalled();
  });

  it("pinches around the cursor and bounds abrupt wheel zoom deltas", () => {
    const app = setup();
    app.wheel({ deltaY: -25, ctrlKey: true });
    app.tick();
    expect(app.driver.zoomTo).toHaveBeenLastCalledWith(8.25, [280, 220]);
    expect(app.driver.panBy).not.toHaveBeenCalled();
    app.wheel({ deltaY: -10000, ctrlKey: true });
    app.tick();
    expect(app.driver.zoomTo).toHaveBeenLastCalledWith(9.25, [280, 220]);
  });

  it("uses absolute Safari gesture scale once even when WebKit also emits wheel", () => {
    const app = setup();
    app.send("gesturestart", { scale: 1 });
    app.send("gesturechange", { scale: 2, clientX: 300, clientY: 250 });
    expect(app.wheel({ deltaY: -40, ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    app.tick();
    expect(app.driver.zoomTo).toHaveBeenCalledExactlyOnceWith(9, [280, 220]);
    app.send("gesturechange", { scale: 2, clientX: 300, clientY: 250 });
    app.tick();
    expect(app.driver.zoomTo).toHaveBeenLastCalledWith(9, [280, 220]);
    app.send("gestureend");
    app.wheel({ deltaY: -40, ctrlKey: true });
    app.tick();
    expect(app.driver.zoomTo).toHaveBeenCalledTimes(2);
    app.advance(101);
    app.wheel({ deltaY: 20 });
    app.tick();
    expect(app.driver.panBy).toHaveBeenCalledWith([0, 20]);
  });

  it("keeps a wheel pinch as the sole source when that stream arrives first", () => {
    const app = setup();
    app.wheel({ deltaY: -20, ctrlKey: true });
    app.send("gesturestart", { scale: 1 });
    app.send("gesturechange", { scale: 2 });
    app.wheel({ deltaY: -20, ctrlKey: true });
    app.tick();
    expect(app.driver.zoomTo.mock.lastCall?.[0]).toBeCloseTo(8.4);
    expect(app.driver.zoomTo).toHaveBeenCalledTimes(2);
  });

  it("leaves physical touchscreen pinch to MapLibre rather than handling it twice", () => {
    const app = setup();
    app.send("touchstart", { touches: [{}, {}] });
    expect(app.send("gesturestart", { scale: 1 }).defaultPrevented).toBe(false);
    app.send("gesturechange", { scale: 2 });
    app.tick();
    expect(app.driver.zoomTo).not.toHaveBeenCalled();
    app.send("touchend", { touches: [] });
    expect(app.send("gesturestart", { scale: 1 }).defaultPrevented).toBe(true);
  });

  it("delegates mouse wheel to MapLibre and discards pending input on mode switch", () => {
    const app = setup();
    app.wheel({ deltaY: 20 });
    app.navigation.setMode("mouse");
    app.tick();
    expect(app.driver.panBy).not.toHaveBeenCalled();
    expect(app.driver.setScrollZoom).toHaveBeenLastCalledWith(true);
    expect(app.wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
    app.tick();
    expect(app.driver.zoomTo).not.toHaveBeenCalled();
    app.navigation.setMode("trackpad");
    expect(app.wheel({ deltaY: 10 }).defaultPrevented).toBe(true);
    app.tick();
    expect(app.driver.panBy).toHaveBeenCalledWith([0, 10]);
  });

  it("removes listeners and cancels pending camera work on unmount", () => {
    const app = setup();
    app.wheel({ deltaY: 25 });
    app.navigation.dispose();
    app.tick();
    expect(app.driver.panBy).not.toHaveBeenCalled();
    expect(app.wheel({ deltaY: 10 }).defaultPrevented).toBe(false);
    app.send("gesturestart");
    app.send("gesturechange", { scale: 2 });
    app.tick();
    expect(app.driver.zoomTo).not.toHaveBeenCalled();
  });
});
