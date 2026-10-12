#!/usr/bin/env node
/** Restore generated road JSON from the committed gzip assets, with no npm dependencies. */
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const defaultDataDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/data",
);

function readGzip(path) {
  if (!existsSync(path))
    throw new Error(`Required road data is missing: ${path}`);
  try {
    return gunzipSync(readFileSync(path));
  } catch (cause) {
    throw new Error(`Cannot decompress required road data: ${path}`, { cause });
  }
}

function writeDeterministically(path, content) {
  if (existsSync(path) && readFileSync(path).equals(content)) return false;
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return true;
}

export function materializeRoadData(dataDirectory = defaultDataDirectory) {
  const directory = resolve(dataDirectory);
  const indexPath = join(directory, "roads-index.json");
  const indexContent = readGzip(`${indexPath}.gz`);
  let index;
  try {
    index = JSON.parse(indexContent.toString("utf8"));
  } catch (cause) {
    throw new Error(`Road index is not valid JSON: ${indexPath}.gz`, { cause });
  }
  if (!Array.isArray(index.roads) || !index.roads.length) {
    throw new Error("Road index must contain a nonempty roads array.");
  }
  const shards = new Set();
  for (const road of index.roads) {
    const match = /^\/data\/roads\/([a-f0-9]{2}\.geojson)$/.exec(
      road.geometryUrl ?? "",
    );
    if (!match || road.geometryCompressedUrl !== `${road.geometryUrl}.gz`) {
      throw new Error(
        `Invalid road geometry asset reference for ${road.id ?? "unknown road"}.`,
      );
    }
    shards.add(match[1]);
  }
  if (shards.size !== index.stats?.geometryShards) {
    throw new Error(
      `Road index expects ${index.stats?.geometryShards} geometry shards but references ${shards.size}.`,
    );
  }
  const files = [...shards]
    .sort()
    .map((name) => join(directory, "roads", name));
  // Detect an incomplete checkout before replacing any previously generated raw files.
  for (const path of files) {
    if (!existsSync(`${path}.gz`))
      throw new Error(`Required road geometry is missing: ${path}.gz`);
  }
  let restored = writeDeterministically(indexPath, indexContent);
  let bytes = indexContent.length;
  for (const path of files) {
    const content = readGzip(`${path}.gz`);
    restored += writeDeterministically(path, content);
    bytes += content.length;
  }
  return { fileCount: files.length + 1, restored, bytes };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--data-dir")) {
      throw new Error(
        "Usage: node scripts/materialize-road-data.mjs [--data-dir PATH]",
      );
    }
    const result = materializeRoadData(args[1] || defaultDataDirectory);
    console.log(
      `Road data verified: ${result.fileCount} files, ${result.restored} restored (${(result.bytes / 1e6).toFixed(1)} MB raw).`,
    );
  } catch (error) {
    console.error(`Road data setup failed: ${error.message}`);
    console.error(
      "Restore the required public/data/*.gz and public/data/roads/*.gz assets, or rebuild them with the GIS import scripts.",
    );
    process.exitCode = 1;
  }
}
