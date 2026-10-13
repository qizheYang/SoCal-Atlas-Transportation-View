export interface KeyboardMotion {
  /** Screen-space camera movement in pixels, independent of compass bearing. */
  pan: [number, number];
  bearingDelta: number;
  zoomDelta: number;
  pitchDelta: number;
}

export interface KeyboardNavigationDriver {
  applyMotion(motion: KeyboardMotion): void;
}

export interface KeyboardDocument extends EventTarget {
  readonly activeElement?: unknown;
  readonly visibilityState?: string;
}

export interface KeyboardFrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
  now(): number;
}

const browserFrames: KeyboardFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "rotateLeft"
  | "rotateRight"
  | "zoomIn"
  | "zoomOut"
  | "pitchUp"
  | "pitchDown";

const CODE_ACTIONS: Readonly<Record<string, Action>> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyQ: "rotateLeft",
  KeyE: "rotateRight",
  KeyR: "zoomIn",
  KeyF: "zoomOut",
  Equal: "zoomIn",
  NumpadAdd: "zoomIn",
  Minus: "zoomOut",
  NumpadSubtract: "zoomOut",
  KeyT: "pitchUp",
  KeyG: "pitchDown",
};

const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  q: "rotateLeft",
  e: "rotateRight",
  r: "zoomIn",
  f: "zoomOut",
  "+": "zoomIn",
  "=": "zoomIn",
  "-": "zoomOut",
  t: "pitchUp",
  g: "pitchDown",
};

const CONTROL_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  "button",
  "a[href]",
  "summary",
  "dialog",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  "[data-map-keyboard-ignore]",
].join(",");

function isControl(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as {
    closest?: (selector: string) => unknown;
    parentElement?: unknown;
    isContentEditable?: boolean;
  };
  return Boolean(
    node.isContentEditable ||
      node.closest?.(CONTROL_SELECTOR) ||
      (!node.closest && node.parentElement && isControl(node.parentElement)),
  );
}

/** Includes shadow-DOM descendants, where event.target can be only the host. */
export function keyboardEventIsFromControl(
  event: Pick<Event, "target" | "composedPath">,
): boolean {
  return (
    isControl(event.target) ||
    event.composedPath().some((node) => isControl(node))
  );
}

function focusIsControl(documentTarget: KeyboardDocument): boolean {
  let node = documentTarget.activeElement;
  while (node && typeof node === "object") {
    if (isControl(node)) return true;
    node = (node as { shadowRoot?: { activeElement?: unknown } }).shadowRoot
      ?.activeElement;
  }
  return false;
}

function keyAction(event: KeyboardEvent) {
  // Prefer physical QWERTY positions. Older/virtual keyboards may omit code.
  const coded = CODE_ACTIONS[event.code];
  const action = coded ?? KEY_ACTIONS[event.key?.toLowerCase()];
  if (!action) return undefined;
  return {
    action,
    id: coded ? event.code : `key:${action}`,
  };
}

/**
 * Held keys move every animation frame, without depending on OS key repeat.
 * A single driver call combines pan, rotation, zoom, and tilt for that frame.
 */
export function installKeyboardNavigation(
  documentTarget: KeyboardDocument,
  windowTarget: EventTarget,
  driver: KeyboardNavigationDriver,
  initiallyEnabled = true,
  frames: KeyboardFrameScheduler = browserFrames,
) {
  const held = new Map<string, Action>();
  let enabled = initiallyEnabled;
  let disposed = false;
  let shift = false;
  let frame: number | undefined;
  let previousTime = 0;

  const reset = () => {
    held.clear();
    shift = false;
    if (frame !== undefined) frames.cancel(frame);
    frame = undefined;
  };

  const canMove = () =>
    enabled &&
    !disposed &&
    documentTarget.visibilityState !== "hidden" &&
    !focusIsControl(documentTarget);

  const tick = () => {
    frame = undefined;
    if (!canMove() || !held.size) {
      reset();
      return;
    }
    const now = frames.now();
    // A throttled tab or main-thread stall cannot cause a giant camera jump.
    const elapsed = Math.max(0, Math.min(50, now - previousTime)) / 1000;
    previousTime = now;
    const actions = new Set(held.values());
    const axis = (positive: Action, negative: Action) =>
      Number(actions.has(positive)) - Number(actions.has(negative));
    const x = axis("right", "left");
    const y = axis("down", "up");
    const diagonal = Math.hypot(x, y) || 1;
    const time = elapsed * (shift ? 2 : 1);
    const motion: KeyboardMotion = {
      pan: [(x / diagonal) * 480 * time, (y / diagonal) * 480 * time],
      bearingDelta: axis("rotateRight", "rotateLeft") * 60 * time,
      zoomDelta: axis("zoomIn", "zoomOut") * 1.5 * time,
      pitchDelta: axis("pitchUp", "pitchDown") * 40 * time,
    };
    if (
      motion.pan[0] ||
      motion.pan[1] ||
      motion.bearingDelta ||
      motion.zoomDelta ||
      motion.pitchDelta
    ) {
      driver.applyMotion(motion);
    }
    if (!disposed && held.size) frame = frames.request(tick);
  };

  const keydown = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (
      !canMove() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      keyboardEventIsFromControl(event)
    ) {
      reset();
      return;
    }
    shift = event.shiftKey;
    const key = keyAction(event);
    if (!key) return;
    // After blur/reset, repeats from an old hold must not restart movement.
    if (event.repeat && !held.has(key.id)) return;
    event.preventDefault();
    event.stopPropagation();
    held.set(key.id, key.action);
    if (frame === undefined) {
      previousTime = frames.now();
      frame = frames.request(tick);
    }
  };

  const keyup = (raw: Event) => {
    const event = raw as KeyboardEvent;
    const key = keyAction(event);
    // Release before any modifier/focus check: modifiers can change mid-hold.
    if (key && held.delete(key.id)) {
      event.preventDefault();
      event.stopPropagation();
    }
    shift = event.shiftKey;
    if (
      !held.size ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !canMove() ||
      keyboardEventIsFromControl(event)
    )
      reset();
  };

  const visibility = () => {
    if (documentTarget.visibilityState === "hidden") reset();
  };
  const focus = (event: Event) => {
    if (keyboardEventIsFromControl(event) || focusIsControl(documentTarget))
      reset();
  };
  const documentListeners: [string, EventListener][] = [
    ["keydown", keydown],
    ["keyup", keyup],
    ["visibilitychange", visibility],
    ["focusin", focus],
    ["pointerdown", reset],
    ["pointercancel", reset],
    ["touchstart", reset],
    ["wheel", reset],
    ["compositionstart", reset],
  ];
  for (const [type, listener] of documentListeners)
    documentTarget.addEventListener(type, listener, true);
  windowTarget.addEventListener("blur", reset);
  windowTarget.addEventListener("pagehide", reset);

  return {
    setEnabled(next: boolean) {
      if (disposed || next === enabled) return;
      enabled = next;
      reset();
    },
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      for (const [type, listener] of documentListeners)
        documentTarget.removeEventListener(type, listener, true);
      windowTarget.removeEventListener("blur", reset);
      windowTarget.removeEventListener("pagehide", reset);
    },
  };
}
