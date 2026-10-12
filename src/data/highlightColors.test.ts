import { describe, expect, it } from "vitest";
import {
  createHighlightColorAllocator,
  HIGHLIGHT_COLORS,
} from "./highlightColors";

describe("shared road and transit highlight colors", () => {
  it("prefers agency colors and gives two same-color routes distinct comparison colors", () => {
    const colors = createHighlightColorAllocator();
    expect(colors.reserve("transit:metro:4", "#EF7D00")).toBe("#ef7d00");
    expect(colors.reserve("transit:metro:20", "#ef7d00")).not.toBe("#ef7d00");
    expect(colors.reserve("transit:a", "#0072BC")).toBe("#0072bc");
  });

  it("reserves colors for pending roads and prevents collisions in either selection order", () => {
    const first = createHighlightColorAllocator();
    const roadColor = first.reserve("road:pending");
    expect(first.reserve("transit:bus", roadColor)).not.toBe(roadColor);
    const second = createHighlightColorAllocator();
    const routeColor = second.reserve("transit:bus", HIGHLIGHT_COLORS[0]);
    expect(second.reserve("road:pending")).not.toBe(routeColor);
    expect(second.get("road:pending")).toBe(second.reserve("road:pending"));
  });

  it("never recolors retained selections after removal, clear-by-kind or a reselected route", () => {
    const colors = createHighlightColorAllocator();
    const a = colors.reserve("transit:a", "#f00");
    const b = colors.reserve("transit:b", "#ff0000");
    const road = colors.reserve("road:i5");
    colors.release("transit:a");
    expect(colors.get("transit:b")).toBe(b);
    expect(colors.reserve("transit:a", "#f00")).toBe(a);
    colors.releasePrefix("transit:");
    expect(colors.get("road:i5")).toBe(road);
    expect(colors.get("transit:b")).toBeUndefined();
    expect(colors.reserve("transit:b", "#ff0000")).toBe(b);
  });

  it("keeps retained colors when a reselected route's remembered color was taken", () => {
    const colors = createHighlightColorAllocator();
    const former = colors.reserve("transit:a", "#f00");
    colors.release("transit:a");
    expect(colors.reserve("transit:b", "#ff0000")).toBe(former);
    expect(colors.reserve("transit:a", "#f00")).not.toBe(former);
    expect(colors.get("transit:b")).toBe(former);
  });

  it("extends the palette beyond six or twelve selections without modulo reuse", () => {
    const colors = createHighlightColorAllocator();
    const assigned = Array.from({ length: 100 }, (_, index) =>
      colors.reserve(`route:${index}`, "#ef7d00"),
    );
    expect(new Set(assigned).size).toBe(100);
    expect(assigned.every((color) => /^#[\da-f]{6}$/.test(color))).toBe(true);
    colors.clear();
    expect(colors.get("route:0")).toBeUndefined();
    expect(colors.reserve("route:0", "#ef7d00")).toBe(assigned[0]);
  });
});
