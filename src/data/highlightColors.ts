/** Shared by pending roads and transit so asynchronous loads cannot claim the
 * same color. Original agency colors remain on the route's `color` property. */
export const HIGHLIGHT_COLORS = [
  "#087e8b",
  "#b64f22",
  "#9160af",
  "#527c2e",
  "#b58408",
  "#a23b68",
  "#2854b8",
  "#bd3340",
  "#697327",
  "#864c22",
  "#317168",
  "#674699",
];

export function canonicalHighlightColor(color?: string): string | undefined {
  if (!color) return;
  const hex = color.replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((digit) => digit + digit)
      .join("")
      .toLowerCase()}`;
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
}

export function createHighlightColorAllocator() {
  const active = new Map<string, string>();
  const history = new Map<string, string>();
  return {
    reserve(id: string, preferred?: string): string {
      const current = active.get(id);
      if (current) return current;
      const used = new Set(active.values());
      const choices = [
        history.get(id),
        canonicalHighlightColor(preferred),
        ...HIGHLIGHT_COLORS,
      ];
      let color = choices.find(
        (value): value is string => !!value && !used.has(value),
      );
      // Golden-angle hues extend the palette without modulo reuse. A secondary
      // saturation/lightness sequence separates a large set of comparisons.
      for (let index = 0; !color; index++) {
        const candidate = generatedColor(index);
        if (!used.has(candidate)) color = candidate;
      }
      active.set(id, color);
      history.set(id, color);
      return color;
    },
    get: (id: string) => active.get(id),
    release: (id: string) => {
      active.delete(id);
    },
    releasePrefix(prefix: string) {
      for (const id of active.keys())
        if (id.startsWith(prefix)) active.delete(id);
    },
    clear() {
      active.clear();
    },
  };
}

function generatedColor(index: number): string {
  const hue = (17 + index * 137.507764) % 360;
  const saturation = [0.72, 0.56, 0.87][Math.floor(index / 12) % 3];
  const lightness = [0.39, 0.49, 0.32][Math.floor(index / 36) % 3];
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value =
      lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
