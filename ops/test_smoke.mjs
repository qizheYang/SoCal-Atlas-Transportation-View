import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { smokeDeployment, snapshotBaseline } from "./smoke.mjs";

const commit = "a".repeat(40);
async function fixture(t) {
  const geo = Buffer.from(
    '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]},"properties":{}}]}',
  );
  const version = {
    commit,
    basePath: "/socalmap/",
    releaseId: `${commit}-1-1`,
    assets: [
      "assets/index-1.js",
      "assets/index-1.css",
      "assets/routeOverlap.worker-1.js",
    ],
    smokeGeometry: "data/roads/00.geojson",
  };
  const routes = new Map([
    ["/", [200, "text/html", "existing homepage"]],
    ["/game/", [403, "text/html", "preexisting denial"]],
    ["/guandan/", [200, "text/html", "existing guandan"]],
    ["/tac368/", [200, "text/html", "existing tac368"]],
    ["/api/auth/keys", [404, "text/plain", "must never be fetched"]],
    ["/socalmap", [308, "text/plain", "", { location: "/socalmap/" }]],
    [
      "/socalmap/",
      [
        200,
        "text/html",
        '<title>SoCal Atlas</title><script src="/socalmap/assets/index-1.js"></script><link href="/socalmap/assets/index-1.css"><div id="root"></div>',
      ],
    ],
    [
      "/socalmap/version.json",
      [200, "application/json", JSON.stringify(version)],
    ],
    [
      "/socalmap/assets/index-1.js",
      [200, "text/javascript", 'console.log("app")'],
    ],
    ["/socalmap/assets/index-1.css", [200, "text/css", "body{}"]],
    [
      "/socalmap/assets/routeOverlap.worker-1.js",
      [200, "text/javascript", "self.onmessage=()=>{}"],
    ],
    [
      "/socalmap/data/city-boundaries-manifest.json",
      [
        200,
        "application/json",
        JSON.stringify({
          scope: "socal-ten",
          countyFips: Array(10).fill("county"),
        }),
      ],
    ],
    [
      "/socalmap/data/transit-manifest.json",
      [200, "application/json", '{"routes":[{"id":"metro:a"}]}'],
    ],
    [
      "/socalmap/data/roads-index.json.gz",
      [
        200,
        "application/gzip",
        gzipSync(
          '{"roads":[{"geometryUrl":"/data/roads/00.geojson","geometryCompressedUrl":"/data/roads/00.geojson.gz"}]}',
        ),
      ],
    ],
    ["/socalmap/data/roads-index.json", [200, "application/json", "{}"]],
    ["/socalmap/data/roads/00.geojson", [200, "application/geo+json", geo]],
    [
      "/socalmap/data/roads/00.geojson.gz",
      [200, "application/gzip", gzipSync(geo)],
    ],
  ]);
  for (const file of [
    "city-boundaries.geojson",
    "transit-routes.geojson",
    "transit-stops.geojson",
  ])
    routes.set(`/socalmap/data/${file}`, [200, "application/geo+json", geo]);
  routes.set("/socalmap/data/transit-details.json", [
    200,
    "application/json",
    '{"routes":{"metro:a":{}}}',
  ]);
  const requests = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    requests.push({ method: req.method, path });
    const [status, type, body, headers = {}] = routes.get(path) ?? [
      404,
      "text/plain",
      "not found",
    ];
    res.writeHead(status, { "content-type": type, ...headers });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    routes,
    version,
    requests,
  };
}
test("checks subpath assets, worker, gzip/raw geometry and existing-route statuses without reading sensitive bodies", async (t) => {
  const { origin, requests } = await fixture(t);
  const baseline = await snapshotBaseline(origin);
  const result = await smokeDeployment({ origin, commit, baseline });
  assert.equal(result.workerChecked, true);
  assert.equal(result.assetsChecked, 3);
  assert.equal(result.adjacentRoutes["/game/"].status, 403);
  assert.ok(
    requests
      .filter((request) => request.path === "/api/auth/keys")
      .every((request) => request.method === "HEAD"),
  );
});
test("rejects accidental root-relative application assets", async (t) => {
  const { origin, routes } = await fixture(t);
  routes.get("/socalmap/")[2] = routes
    .get("/socalmap/")[2]
    .replace("/socalmap/assets/index-1.js", "/assets/index-1.js");
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /escapes \/socalmap/,
  );
});
test("rejects double-decompression headers on explicit gzip snapshots", async (t) => {
  const { origin, routes } = await fixture(t);
  routes.get("/socalmap/data/roads/00.geojson.gz")[3] = {
    "content-encoding": "gzip",
  };
  await assert.rejects(smokeDeployment({ origin, commit }), /Content-Encoding/);
});
test("detects changes to adjacent application routes", async (t) => {
  const { origin, routes } = await fixture(t);
  const baseline = await snapshotBaseline(origin);
  routes.get("/guandan/")[0] = 404;
  await assert.rejects(
    smokeDeployment({ origin, commit, baseline }),
    /Adjacent route changed: \/guandan/,
  );
});
test("rejects SPA HTML fallback for missing assets and for worker JavaScript", async (t) => {
  const { origin, routes } = await fixture(t);
  routes.set("/socalmap/assets/__missing_smoke__.js", [
    200,
    "text/html",
    "wrong fallback",
  ]);
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /Missing asset must return 404/,
  );
  routes.delete("/socalmap/assets/__missing_smoke__.js");
  routes.set("/socalmap/assets/routeOverlap.worker-1.js", [
    200,
    "text/html",
    "wrong fallback",
  ]);
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /Built asset is unavailable/,
  );
});
test("rejects stale releases and any unprotected auth keys endpoint", async (t) => {
  const { origin, routes } = await fixture(t);
  await assert.rejects(
    smokeDeployment({ origin, commit: "b".repeat(40) }),
    /Deployed version/,
  );
  routes.get("/api/auth/keys")[0] = 200;
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /protection must return 404/,
  );
});
test("rejects an HTML redirect to the same path on an unrelated host", async (t) => {
  const { origin, routes } = await fixture(t);
  routes.get("/socalmap")[3].location = "https://unrelated.invalid/socalmap/";
  await assert.rejects(smokeDeployment({ origin, commit }), /Base redirect/);
});

test("rejects broken road search catalog even when the geometry shard is healthy", async (t) => {
  const { origin, routes } = await fixture(t);
  routes.get("/socalmap/data/roads-index.json.gz")[2] =
    gzipSync('{"roads":[]}');
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /Road catalog is empty/,
  );
  routes.get("/socalmap/data/roads-index.json.gz")[2] = Buffer.from("not gzip");
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /not readable gzip JSON/,
  );
});

test("rejects missing transit geography even when its manifest is present", async (t) => {
  const { origin, routes } = await fixture(t);
  routes.delete("/socalmap/data/transit-routes.geojson");
  await assert.rejects(
    smokeDeployment({ origin, commit }),
    /transit-routes.geojson: expected HTTP 200/,
  );
});
