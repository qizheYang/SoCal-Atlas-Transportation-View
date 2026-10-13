#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const BASELINE_PATHS = [
  "/",
  "/game/",
  "/guandan/",
  "/tac368/",
  "/api/auth/keys",
];
const BASE = "/socalmap/";
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function originUrl(value) {
  const url = new URL(value);
  check(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "origin must be an HTTP(S) origin without credentials or path",
  );
  return url.origin;
}
async function request(
  origin,
  path,
  { method = "GET", maxBytes = 20 * 1024 * 1024 } = {},
) {
  const url = new URL(path, origin);
  url.searchParams.set(
    "_socalmap_smoke",
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const response = await fetch(url, {
    method,
    redirect: "manual",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30000),
  });
  const headers = Object.fromEntries(response.headers);
  if (method === "HEAD") return { status: response.status, headers };
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length;
      check(bytes <= maxBytes, `Response too large: ${path}`);
      chunks.push(chunk);
    }
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
  return { status: response.status, headers, body: Buffer.concat(chunks) };
}
export async function snapshotBaseline(origin) {
  origin = originUrl(origin);
  const paths = {};
  for (const path of BASELINE_PATHS) {
    const response = await request(origin, path, { method: "HEAD" });
    paths[path] = {
      status: response.status,
      location: response.headers.location ?? null,
    };
  }
  check(
    paths["/api/auth/keys"].status === 404,
    "Existing /api/auth/keys protection must return 404",
  );
  return { origin, paths };
}
function localAsset(path) {
  check(
    typeof path === "string" &&
      /^[a-zA-Z0-9_./-]+$/.test(path) &&
      !path.startsWith("/") &&
      !path
        .split("/")
        .some((part) => part === ".." || part === "." || part === ""),
    `Invalid release asset path: ${path}`,
  );
  return `${BASE}${path}`;
}
function json(response, path) {
  check(
    response.status === 200,
    `${path}: expected HTTP 200, got ${response.status}`,
  );
  check(
    !/text\/html/i.test(response.headers["content-type"] ?? ""),
    `${path}: unexpectedly received HTML`,
  );
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new Error(`${path}: invalid JSON`);
  }
}
export async function smokeDeployment({
  origin = "https://rehydratedwater.com",
  commit,
  baseline,
}) {
  origin = originUrl(origin);
  check(
    /^[a-f0-9]{40}$/.test(commit ?? ""),
    "Expected full commit SHA is required",
  );
  const currentBaseline = await snapshotBaseline(origin);
  if (baseline) {
    check(baseline.origin === origin, "Baseline origin does not match");
    for (const path of BASELINE_PATHS) {
      check(
        JSON.stringify(baseline.paths?.[path]) ===
          JSON.stringify(currentBaseline.paths[path]),
        `Adjacent route changed: ${path}`,
      );
    }
  }
  const redirect = await request(origin, "/socalmap", { method: "HEAD" });
  check(
    [301, 302, 307, 308].includes(redirect.status),
    "/socalmap must redirect to /socalmap/",
  );
  const redirectTarget = new URL(redirect.headers.location ?? "", origin);
  check(
    redirectTarget.origin === origin && redirectTarget.pathname === BASE,
    "Base redirect has the wrong target",
  );
  const version = json(
    await request(origin, `${BASE}version.json`),
    "version.json",
  );
  check(
    version.commit === commit && version.basePath === BASE,
    "Deployed version or basePath does not match",
  );
  check(
    Array.isArray(version.assets) && version.assets.length > 0,
    "version.json must enumerate built assets",
  );
  const htmlResponse = await request(origin, BASE);
  check(
    htmlResponse.status === 200 &&
      /text\/html/i.test(htmlResponse.headers["content-type"] ?? ""),
    "Map HTML is unavailable",
  );
  const html = htmlResponse.body.toString("utf8");
  check(
    html.includes("SoCal") && /id=["']root["']/.test(html),
    "Map HTML has the wrong application root",
  );
  const references = [
    ...html.matchAll(
      /(?:src|href)\s*=\s*["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g,
    ),
  ].map((match) => new URL(match[1], `${origin}${BASE}`));
  check(
    references.some((url) => url.pathname.endsWith(".js")) &&
      references.some((url) => url.pathname.endsWith(".css")),
    "Map HTML must reference JavaScript and CSS",
  );
  for (const url of references) {
    check(
      url.origin === origin && url.pathname.startsWith(`${BASE}assets/`),
      `HTML asset escapes /socalmap/: ${url.pathname}`,
    );
    check(
      version.assets.includes(url.pathname.slice(BASE.length)),
      `HTML references an unlisted asset: ${url.pathname}`,
    );
  }
  for (const asset of version.assets) {
    check(
      /^assets\/.+\.(js|css)$/.test(asset),
      `Unexpected build asset: ${asset}`,
    );
    const path = localAsset(asset);
    const response = await request(origin, path);
    check(
      response.status === 200 &&
        response.body.length > 0 &&
        !/text\/html/i.test(response.headers["content-type"] ?? ""),
      `Built asset is unavailable: ${path}`,
    );
    check(
      asset.endsWith(".css")
        ? /text\/css/i.test(response.headers["content-type"] ?? "")
        : /(?:javascript|ecmascript)/i.test(
            response.headers["content-type"] ?? "",
          ),
      `Built asset has incorrect MIME type: ${path}`,
    );
  }
  const manifest = json(
    await request(origin, `${BASE}data/city-boundaries-manifest.json`),
    "boundary manifest",
  );
  check(
    manifest.scope === "socal-ten" && manifest.countyFips?.length === 10,
    "Expected the ten-county data snapshot",
  );
  const transit = json(
    await request(origin, `${BASE}data/transit-manifest.json`),
    "transit manifest",
  );
  check(
    Array.isArray(transit.routes) && transit.routes.length > 0,
    "Transit manifest has no routes",
  );
  for (const file of [
    "city-boundaries.geojson",
    "transit-routes.geojson",
    "transit-stops.geojson",
  ]) {
    const data = json(await request(origin, `${BASE}data/${file}`), file);
    check(
      data.type === "FeatureCollection" &&
        Array.isArray(data.features) &&
        data.features.length > 0,
      `${file}: empty or invalid geographic features`,
    );
  }
  const details = json(
    await request(origin, `${BASE}data/transit-details.json`),
    "transit details",
  );
  check(
    details.routes &&
      typeof details.routes === "object" &&
      Object.keys(details.routes).length > 0,
    "Transit details have no routes",
  );
  check(
    /^data\/roads\/[a-f0-9]{2}\.geojson$/.test(version.smokeGeometry ?? ""),
    "Missing geometry smoke fixture",
  );
  const catalogResponse = await request(
    origin,
    `${BASE}data/roads-index.json.gz`,
  );
  check(
    catalogResponse.status === 200,
    "Compressed road catalog is unavailable",
  );
  check(
    !catalogResponse.headers["content-encoding"] ||
      catalogResponse.headers["content-encoding"] === "identity",
    "Explicit .gz road catalog must not have Content-Encoding: gzip",
  );
  let catalog;
  try {
    catalog = JSON.parse(
      gunzipSync(catalogResponse.body, {
        maxOutputLength: 128 * 1024 * 1024,
      }).toString("utf8"),
    );
  } catch {
    throw new Error("Road catalog is not readable gzip JSON");
  }
  check(
    Array.isArray(catalog.roads) && catalog.roads.length > 0,
    "Road catalog is empty",
  );
  check(
    catalog.roads.some(
      (road) =>
        road.geometryUrl === `/${version.smokeGeometry}` &&
        road.geometryCompressedUrl === `/${version.smokeGeometry}.gz`,
    ),
    "Road catalog does not reference the geometry fixture",
  );
  const rawCatalog = await request(origin, `${BASE}data/roads-index.json`, {
    method: "HEAD",
  });
  check(
    rawCatalog.status === 200 &&
      /json/i.test(rawCatalog.headers["content-type"] ?? ""),
    "Raw road catalog fallback is unavailable",
  );
  const geometryPath = localAsset(version.smokeGeometry);
  const compressed = await request(origin, `${geometryPath}.gz`);
  check(compressed.status === 200, "Compressed geometry is unavailable");
  check(
    !compressed.headers["content-encoding"] ||
      compressed.headers["content-encoding"] === "identity",
    "Explicit .gz data must not have Content-Encoding: gzip (the browser decompresses it)",
  );
  let uncompressed;
  try {
    uncompressed = gunzipSync(compressed.body, {
      maxOutputLength: 20 * 1024 * 1024,
    });
  } catch {
    throw new Error("Road geometry is not valid gzip");
  }
  const raw = await request(origin, geometryPath);
  const geometry = json(raw, "raw geometry fallback");
  check(
    geometry.type === "FeatureCollection" &&
      Array.isArray(geometry.features) &&
      geometry.features.length > 0,
    "Road geometry is empty or invalid",
  );
  check(
    uncompressed.equals(raw.body),
    "Compressed geometry and raw fallback differ",
  );
  for (const path of [
    `${BASE}assets/__missing_smoke__.js`,
    `${BASE}data/__missing_smoke__.json`,
  ]) {
    const response = await request(origin, path, { method: "HEAD" });
    check(
      response.status === 404,
      `Missing asset must return 404, not an SPA fallback: ${path}`,
    );
  }
  return {
    commit,
    releaseId: version.releaseId,
    assetsChecked: version.assets.length,
    workerChecked: version.assets.some((asset) => asset.includes(".worker-")),
    geometry: version.smokeGeometry,
    adjacentRoutes: currentBaseline.paths,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const names = {
        "--origin": "origin",
        "--commit": "commit",
        "--baseline": "baselinePath",
        "--baseline-out": "baselineOut",
      };
      if (!names[args[i]] || !args[i + 1])
        throw new Error(
          "Usage: smoke.mjs --origin ORIGIN [--baseline-out FILE | --commit SHA --baseline FILE]",
        );
      options[names[args[i]]] = args[i + 1];
    }
    if (options.baselineOut) {
      const baseline = await snapshotBaseline(options.origin);
      await writeFile(
        options.baselineOut,
        `${JSON.stringify(baseline, null, 2)}\n`,
      );
      console.log("Adjacent-route status baseline saved (HEAD requests only).");
    } else {
      if (options.baselinePath)
        options.baseline = JSON.parse(
          await readFile(options.baselinePath, "utf8"),
        );
      console.log(JSON.stringify(await smokeDeployment(options), null, 2));
    }
  } catch (error) {
    console.error(`Deployment smoke failed: ${error.message}`);
    process.exitCode = 1;
  }
}
