import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { buildRelease } from "./build-release.mjs";

const commit = "a".repeat(40);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "socal-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await mkdir(join(dist, "data/roads"), { recursive: true });
  for (const path of [
    "index.html",
    "data/transit-manifest.json",
    "data/city-boundaries-manifest.json",
    "data/city-boundaries.geojson",
    "data/transit-routes.geojson",
    "data/transit-stops.geojson",
    "data/transit-details.json",
    "data/roads-index.json",
    "assets/index-123.js",
    "assets/index-123.css",
    "assets/routeOverlap.worker-123.js",
  ])
    await writeFile(join(dist, path), "{}");
  await writeFile(join(dist, "data/roads-index.json.gz"), gzipSync("{}"));
  await writeFile(
    join(dist, "data/roads/00.geojson"),
    '{"type":"FeatureCollection","features":[]}',
  );
  await writeFile(
    join(dist, "data/roads/00.geojson.gz"),
    gzipSync('{"type":"FeatureCollection","features":[]}'),
  );
  return {
    dist,
    output: join(root, "release"),
    commit,
    runId: "123",
    attempt: "2",
  };
}
test("release contains the version and all static files at archive root, with a matching checksum", async (t) => {
  const options = await fixture(t);
  const release = await buildRelease(options);
  assert.equal(release.releaseId, `${commit}-123-2`);
  assert.equal(
    createHash("sha256")
      .update(await readFile(release.archive))
      .digest("hex"),
    release.sha256,
  );
  const list = spawnSync("tar", ["-tzf", release.archive], {
    encoding: "utf8",
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^\.\/index\.html$/m);
  assert.match(list.stdout, /^\.\/version\.json$/m);
  assert.match(list.stdout, /^\.\/assets\/routeOverlap\.worker-123\.js$/m);
  assert.doesNotMatch(list.stdout, /(?:^|\/)dist\//m);
  const version = JSON.parse(
    spawnSync("tar", ["-xOzf", release.archive, "./version.json"], {
      encoding: "utf8",
    }).stdout,
  );
  assert.equal(version.commit, commit);
  assert.equal(version.basePath, "/socalmap/");
  assert.equal(version.smokeGeometry, "data/roads/00.geojson");
  assert.ok(version.assets.includes("assets/routeOverlap.worker-123.js"));
  assert.equal(
    (
      await readFile(join(options.output, "socalmap.tar.gz.sha256"), "utf8")
    ).trim(),
    `${release.sha256}  socalmap.tar.gz`,
  );
});
test("rejects non-commit identities and unmaterialized geometry", async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    buildRelease({ ...options, commit: "main" }),
    /full lowercase Git SHA/,
  );
  await rm(join(options.dist, "data/roads/00.geojson"));
  await assert.rejects(buildRelease(options), /Raw geometry fallback/);
});
test("rejects symlinks instead of accidentally shipping files outside dist", async (t) => {
  const options = await fixture(t);
  await symlink(
    "../data/roads-index.json",
    join(options.dist, "assets/leak.json"),
  );
  await assert.rejects(buildRelease(options), /non-regular entry/);
});
