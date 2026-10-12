import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalJson } from "./readLocalJson";

afterEach(() => vi.unstubAllGlobals());
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
});
