import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "./publicAssetUrl";

describe("public snapshot URL resolution", () => {
  it.each(["/", "/socalmap/", "/socalmap"])(
    "resolves root-relative and relative catalog URLs under %s",
    (base) => {
      const prefix = base.endsWith("/") ? base : `${base}/`;
      for (const path of [
        "/data/roads/01.geojson.gz",
        "data/roads/01.geojson.gz",
        "./data/roads/01.geojson.gz",
      ]) {
        expect(publicAssetUrl(path, base)).toBe(
          `${prefix}data/roads/01.geojson.gz`,
        );
      }
    },
  );

  it("does not apply a deployment prefix twice or change queries", () => {
    expect(
      publicAssetUrl("/socalmap/data/roads-index.json?v=2", "/socalmap/"),
    ).toBe("/socalmap/data/roads-index.json?v=2");
  });

  it("preserves external tile, source, and object URLs", () => {
    for (const url of [
      "https://tiles.openfreemap.org/planet",
      "//cdn.example.com/data.json",
      "blob:https://example.com/snapshot",
      "data:application/json,{}",
    ]) {
      expect(publicAssetUrl(url, "/socalmap/")).toBe(url);
    }
  });
});
