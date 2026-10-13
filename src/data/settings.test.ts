import { describe, expect, it } from "vitest";
import { startupSettings } from "./settings";
import { DEFAULT_LAYERS } from "./regions";

describe("regional entry", () => {
  it("opens a north-up flat city overview despite old neighborhood preferences", () => {
    const settings = startupSettings(
      JSON.stringify({
        regionId: "la",
        mode: "terrain",
        is3D: true,
        layers: { terrain: true, pois: false },
        navigationMode: "mouse",
      }),
    );
    expect(settings).toMatchObject({
      regionId: "socal",
      mode: "city",
      is3D: false,
      keyboardEnabled: true,
      navigationMode: "mouse",
      layers: { terrain: false, pois: false, roads: true },
    });
  });
  it("remembers an explicit keyboard opt-out, without trusting malformed values", () => {
    expect(startupSettings('{"keyboardEnabled":false}').keyboardEnabled).toBe(
      false,
    );
    for (const value of [true, null, "false", 0]) {
      expect(
        startupSettings(JSON.stringify({ keyboardEnabled: value }))
          .keyboardEnabled,
      ).toBe(true);
    }
  });
  it.each([
    null,
    "bad JSON",
    "null",
    "[]",
    '{"layers":null,"navigationMode":"bad"}',
  ])("recovers from missing or malformed settings: %s", (raw) => {
    expect(startupSettings(raw)).toMatchObject({
      regionId: "socal",
      is3D: false,
      navigationMode: "trackpad",
      layers: DEFAULT_LAYERS,
    });
  });
});
