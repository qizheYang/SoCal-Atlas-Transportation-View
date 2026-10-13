import { publicAssetUrl } from "./publicAssetUrl";

/** Prefer compact local snapshots while retaining compatibility with raw exports. */
export async function readLocalJson(
  rawUrl: string,
  gzipUrl?: string,
  signal?: AbortSignal,
) {
  if (gzipUrl && typeof DecompressionStream !== "undefined") {
    try {
      const response = await fetch(publicAssetUrl(gzipUrl), { signal });
      if (!response.ok || !response.body)
        throw new Error("Compressed data unavailable");
      return await new Response(
        response.body.pipeThrough(new DecompressionStream("gzip")),
      ).json();
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  const response = await fetch(publicAssetUrl(rawUrl), { signal });
  if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
  return response.json();
}
