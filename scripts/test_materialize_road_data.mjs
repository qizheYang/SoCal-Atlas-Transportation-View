import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { materializeRoadData } from "./materialize-road-data.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "southland-road-data-"));
  mkdirSync(join(directory, "roads"));
  const index = {
    roads: [
      {
        id: "r-test",
        geometryUrl: "/data/roads/00.geojson",
        geometryCompressedUrl: "/data/roads/00.geojson.gz",
      },
    ],
    stats: { geometryShards: 1 },
  };
  const geometry = '{"type":"FeatureCollection","features":[]}\n';
  writeFileSync(
    join(directory, "roads-index.json.gz"),
    gzipSync(JSON.stringify(index)),
  );
  writeFileSync(join(directory, "roads/00.geojson.gz"), gzipSync(geometry));
  return { directory, geometry };
}

test("restores exact raw content and repeated runs leave verified files unchanged", () => {
  const { directory, geometry } = fixture();
  try {
    assert.equal(materializeRoadData(directory).restored, 2);
    assert.equal(
      readFileSync(join(directory, "roads/00.geojson"), "utf8"),
      geometry,
    );
    assert.equal(materializeRoadData(directory).restored, 0);
    writeFileSync(join(directory, "roads/00.geojson"), "stale");
    assert.equal(materializeRoadData(directory).restored, 1);
    assert.equal(
      readFileSync(join(directory, "roads/00.geojson"), "utf8"),
      geometry,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing required shard fails before overwriting an existing raw index", () => {
  const { directory } = fixture();
  try {
    writeFileSync(join(directory, "roads-index.json"), "existing");
    rmSync(join(directory, "roads/00.geojson.gz"));
    assert.throws(
      () => materializeRoadData(directory),
      /Required road geometry is missing/,
    );
    assert.equal(
      readFileSync(join(directory, "roads-index.json"), "utf8"),
      "existing",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt compressed content fails rather than reporting a complete setup", () => {
  const { directory } = fixture();
  try {
    writeFileSync(join(directory, "roads/00.geojson.gz"), "not a gzip stream");
    assert.throws(
      () => materializeRoadData(directory),
      /Cannot decompress required road data/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
