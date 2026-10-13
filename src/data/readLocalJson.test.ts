import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalJson } from "./readLocalJson";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("compressed regional snapshots", () => {
  it("decodes a gzip snapshot without requesting the large raw export", async () => {
    const data = { features: [{ id: "test-road" }] };
    const compressed = new Blob([JSON.stringify(data)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const fetcher = vi.fn().mockResolvedValue(new Response(compressed));
    vi.stubGlobal("fetch", fetcher);
    expect(await readLocalJson("/raw.json", "/raw.json.gz")).toEqual(data);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/raw.json.gz", {
      signal: undefined,
    });
  });
  it("falls back when a compressed asset is missing", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ roads: [] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await readLocalJson("/raw.json", "/raw.json.gz")).toEqual({
      roads: [],
    });
    expect(fetcher).toHaveBeenLastCalledWith("/raw.json", {
      signal: undefined,
    });
  });
  it("does not issue a fallback request after cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      readLocalJson("/raw.json", "/raw.json.gz", controller.signal),
    ).rejects.toThrow("Aborted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fetches gzipped catalog geometry from the deployment subpath", async () => {
    vi.stubEnv("BASE_URL", "/socalmap/");
    const data = { type: "FeatureCollection", features: [] };
    const compressed = new Blob([JSON.stringify(data)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const fetcher = vi.fn().mockResolvedValue(new Response(compressed));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await readLocalJson(
        "/data/roads/01.geojson",
        "/data/roads/01.geojson.gz",
      ),
    ).toEqual(data);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/socalmap/data/roads/01.geojson.gz",
      { signal: undefined },
    );
  });
  it("keeps raw fallback under the deployment subpath if gzip is unavailable", async () => {
    vi.stubEnv("BASE_URL", "/socalmap/");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ roads: [] }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await readLocalJson(
        "/data/roads-index.json",
        "/data/roads-index.json.gz",
      ),
    ).toEqual({ roads: [] });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/socalmap/data/roads-index.json.gz",
      "/socalmap/data/roads-index.json",
    ]);
  });
  it("loads raw exports from the subpath when browser decompression is absent", async () => {
    vi.stubEnv("BASE_URL", "/socalmap/");
    vi.stubGlobal("DecompressionStream", undefined);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ roads: [] }));
    vi.stubGlobal("fetch", fetcher);
    await readLocalJson("/data/roads-index.json", "/data/roads-index.json.gz");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/socalmap/data/roads-index.json",
      { signal: undefined },
    );
  });
});
