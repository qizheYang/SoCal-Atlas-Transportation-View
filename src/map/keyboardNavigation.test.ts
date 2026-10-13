import { describe, expect, it, vi } from "vitest";
import {
  installKeyboardNavigation,
  keyboardEventIsFromControl,
  type KeyboardMotion,
} from "./keyboardNavigation";

class FakeDocument extends EventTarget {
  activeElement: unknown = undefined;
  visibilityState = "visible";
}

function control(selector = "input") {
  return { closest: (query: string) => (query.includes(selector) ? {} : null) };
}

function setup(enabled = true) {
  const documentTarget = new FakeDocument();
  const windowTarget = new EventTarget();
  const frames = new Map<number, () => void>();
  let sequence = 0;
  let now = 1000;
  const driver = { applyMotion: vi.fn<(motion: KeyboardMotion) => void>() };
  const navigation = installKeyboardNavigation(
    documentTarget,
    windowTarget,
    driver,
    enabled,
    {
      request: (callback) => {
        frames.set(++sequence, callback);
        return sequence;
      },
      cancel: (id) => {
        frames.delete(id);
      },
      now: () => now,
    },
  );
  const send = (
    type: string,
    fields: object = {},
    target: EventTarget = documentTarget,
  ) => {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    target.dispatchEvent(event);
    return event;
  };
  const key = (type: "keydown" | "keyup", code: string, fields: object = {}) =>
    send(type, {
      code,
      key: "",
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      isComposing: false,
      keyCode: 0,
      ...fields,
    });
  return {
    documentTarget,
    windowTarget,
    navigation,
    driver,
    frames,
    send,
    down: (code: string, fields: object = {}) => key("keydown", code, fields),
    up: (code: string, fields: object = {}) => key("keyup", code, fields),
    tick(milliseconds = 16) {
      now += milliseconds;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

describe("held keyboard camera navigation", () => {
  it("starts on the first frame and continues smoothly without OS key repeat", () => {
    const app = setup();
    expect(app.down("KeyW").defaultPrevented).toBe(true);
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenLastCalledWith({
      pan: [0, -7.68],
      bearingDelta: 0,
      zoomDelta: 0,
      pitchDelta: 0,
    });
    app.tick();
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(3);
    expect(app.up("KeyW").defaultPrevented).toBe(true);
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(3);
    expect(app.frames.size).toBe(0);
  });

  it("keeps speed independent of refresh rate and caps stalled-frame movement", () => {
    for (const frameDuration of [10, 20]) {
      const app = setup();
      app.down("KeyD");
      for (let time = 0; time < 1000; time += frameDuration)
        app.tick(frameDuration);
      expect(
        app.driver.applyMotion.mock.calls.reduce(
          (distance, [motion]) => distance + motion.pan[0],
          0,
        ),
      ).toBeCloseTo(480);
      app.tick(5000);
      expect(app.driver.applyMotion.mock.lastCall?.[0].pan).toEqual([24, 0]);
      app.navigation.dispose();
    }
  });

  it("normalizes diagonal movement and does not double-count WASD plus arrows", () => {
    const app = setup();
    app.down("KeyW");
    app.down("ArrowUp");
    app.down("KeyD");
    app.tick();
    const [x, y] = app.driver.applyMotion.mock.lastCall![0].pan;
    expect(x).toBeCloseTo(7.68 / Math.SQRT2);
    expect(y).toBeCloseTo(-7.68 / Math.SQRT2);
    expect(Math.hypot(x, y)).toBeCloseTo(7.68);
    app.up("KeyW");
    app.tick();
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([x, y]);
    app.up("ArrowUp");
    app.tick();
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([7.68, 0]);
  });

  it("cancels opposite keys independently on every camera axis", () => {
    const app = setup();
    for (const code of [
      "KeyW",
      "KeyS",
      "KeyA",
      "KeyD",
      "KeyQ",
      "KeyE",
      "KeyR",
      "KeyF",
      "KeyT",
      "KeyG",
    ])
      app.down(code);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    app.up("KeyS");
    app.up("KeyA");
    app.up("KeyQ");
    app.up("KeyF");
    app.up("KeyG");
    app.tick(50);
    expect(app.driver.applyMotion).toHaveBeenCalledExactlyOnceWith({
      pan: [24 / Math.SQRT2, -24 / Math.SQRT2],
      bearingDelta: 3,
      zoomDelta: 0.07500000000000001,
      pitchDelta: 2,
    });
  });

  it("combines all motion into one driver update per frame", () => {
    const app = setup();
    for (const code of ["KeyA", "KeyQ", "KeyF", "KeyG"]) app.down(code);
    app.tick(20);
    expect(app.driver.applyMotion).toHaveBeenCalledExactlyOnceWith({
      pan: [-9.6, 0],
      bearingDelta: -1.2,
      zoomDelta: -0.03,
      pitchDelta: -0.8,
    });
  });

  it("updates Shift acceleration during a hold without consuming Shift", () => {
    const app = setup();
    app.down("KeyD");
    app.tick(20);
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([9.6, 0]);
    expect(app.down("ShiftLeft", { shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    app.tick(20);
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([19.2, 0]);
    expect(app.up("ShiftLeft").defaultPrevented).toBe(false);
    app.tick(20);
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([9.6, 0]);
  });

  it("ignores OS repetition as a timing source or restart after reset", () => {
    const app = setup();
    app.down("KeyW");
    for (let repeat = 0; repeat < 5; repeat++)
      app.down("KeyW", { repeat: true });
    expect(app.frames.size).toBe(1);
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(1);
    app.navigation.reset();
    expect(app.down("KeyW", { repeat: true }).defaultPrevented).toBe(false);
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(1);
    app.up("KeyW");
    app.down("KeyW");
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(2);
  });

  it("prefers physical key positions and falls back when code is unavailable", () => {
    const app = setup();
    app.down("KeyW", { key: "z" });
    app.tick();
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([0, -7.68]);
    app.up("KeyW", { key: "Z", shiftKey: true });
    app.down("Unidentified", { key: "D" });
    app.tick();
    expect(app.driver.applyMotion.mock.lastCall![0].pan).toEqual([7.68, 0]);
    app.up("Unidentified", { key: "d" });
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(2);
  });

  it.each(["Equal", "NumpadAdd", "Minus", "NumpadSubtract"])(
    "supports the %s zoom key",
    (code) => {
      const app = setup();
      app.down(code);
      app.tick(20);
      expect(app.driver.applyMotion.mock.lastCall![0].zoomDelta).toBe(
        code === "Equal" || code === "NumpadAdd" ? 0.03 : -0.03,
      );
    },
  );

  it.each(["+", "=", "-"])("supports %s without a physical code", (key) => {
    const app = setup();
    app.down("", { key });
    app.tick(20);
    expect(app.driver.applyMotion.mock.lastCall![0].zoomDelta).toBe(
      key === "-" ? -0.03 : 0.03,
    );
  });

  it.each(["ctrlKey", "metaKey", "altKey"])(
    "leaves %s shortcuts untouched and cancels a pre-existing hold",
    (modifier) => {
      const app = setup();
      app.down("KeyW");
      expect(app.down("KeyR", { [modifier]: true }).defaultPrevented).toBe(
        false,
      );
      app.tick();
      expect(app.driver.applyMotion).not.toHaveBeenCalled();
      app.up("KeyW", { [modifier]: true });
      expect(app.frames.size).toBe(0);
    },
  );

  it("clears a key released after modifiers or focus have changed", () => {
    const app = setup();
    app.down("KeyW");
    app.up("KeyW", { ctrlKey: true });
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    app.down("KeyW");
    app.documentTarget.activeElement = control();
    app.up("KeyW");
    app.documentTarget.activeElement = undefined;
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
  });

  it("preserves events already consumed elsewhere", () => {
    const app = setup();
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      code: "KeyW",
      key: "w",
    });
    event.preventDefault();
    app.documentTarget.dispatchEvent(event);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "ignores IME keyboard events (%j)",
    (fields) => {
      const app = setup();
      expect(app.down("KeyW", fields).defaultPrevented).toBe(false);
      app.tick();
      expect(app.driver.applyMotion).not.toHaveBeenCalled();
    },
  );

  it.each([
    "input",
    "textarea",
    "select",
    "button",
    "a[href]",
    "summary",
    "dialog",
    '[role="textbox"]',
    '[role="menu"]',
    '[role="slider"]',
    '[role="tab"]',
    "[data-map-keyboard-ignore]",
  ])("does not hijack keyboard interaction with %s", (selector) => {
    const app = setup();
    expect(
      app.down("KeyW", { composedPath: () => [control(selector)] })
        .defaultPrevented,
    ).toBe(false);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
  });

  it("recognizes editing descendants across shadow roots and text nodes", () => {
    const textNode = { parentElement: { isContentEditable: true } };
    expect(
      keyboardEventIsFromControl({
        target: null,
        composedPath: () => [textNode as unknown as EventTarget],
      }),
    ).toBe(true);
    const app = setup();
    app.documentTarget.activeElement = {
      shadowRoot: { activeElement: control("input") },
    };
    expect(app.down("KeyW").defaultPrevented).toBe(false);
  });

  it("rechecks focus each frame even when no focusin event is received", () => {
    const app = setup();
    app.down("KeyW");
    app.documentTarget.activeElement = control("button");
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    app.documentTarget.activeElement = undefined;
    app.tick();
    expect(app.frames.size).toBe(0);
  });

  it("stops immediately when focus enters a UI control", () => {
    const app = setup();
    app.down("KeyW");
    app.send("focusin", { composedPath: () => [control("textarea")] });
    expect(app.frames.size).toBe(0);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
  });

  it.each([
    "pointerdown",
    "pointercancel",
    "touchstart",
    "wheel",
    "compositionstart",
  ])("cancels held movement on %s", (type) => {
    const app = setup();
    app.down("KeyW");
    expect(app.send(type).defaultPrevented).toBe(false);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    expect(app.frames.size).toBe(0);
  });

  it.each(["blur", "pagehide"])("stops on window %s", (type) => {
    const app = setup();
    app.down("KeyW");
    app.send(type, {}, app.windowTarget);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    expect(app.frames.size).toBe(0);
  });

  it("stops when hidden and does not resume old held keys after returning", () => {
    const app = setup();
    app.down("KeyW");
    app.documentTarget.visibilityState = "hidden";
    app.send("visibilitychange");
    expect(app.frames.size).toBe(0);
    expect(app.down("KeyD").defaultPrevented).toBe(false);
    app.documentTarget.visibilityState = "visible";
    app.send("visibilitychange");
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
  });

  it("can be disabled and enabled without replaying old input", () => {
    const app = setup(false);
    expect(app.down("KeyW").defaultPrevented).toBe(false);
    app.navigation.setEnabled(true);
    app.down("KeyW");
    app.navigation.setEnabled(false);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    app.navigation.setEnabled(true);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    app.down("KeyD");
    app.tick();
    expect(app.driver.applyMotion).toHaveBeenCalledTimes(1);
  });

  it("does not consume App-owned actions or unrelated keys", () => {
    const app = setup();
    for (const code of ["KeyN", "Digit0", "Slash", "Escape", "Tab", "Space"])
      expect(app.down(code).defaultPrevented).toBe(false);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
  });

  it("disposes all listeners and cancels scheduled work idempotently", () => {
    const app = setup();
    app.down("KeyW");
    app.navigation.dispose();
    app.navigation.dispose();
    app.navigation.setEnabled(true);
    app.tick();
    expect(app.driver.applyMotion).not.toHaveBeenCalled();
    expect(app.down("KeyW").defaultPrevented).toBe(false);
    expect(app.frames.size).toBe(0);
  });
});
