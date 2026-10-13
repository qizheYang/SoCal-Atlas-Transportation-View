#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
export async function buildRelease({
  dist = "dist",
  output = "release",
  commit,
  runId = "0",
  attempt = "1",
}) {
  if (!SHA.test(commit ?? ""))
    throw new Error("commit must be a full lowercase Git SHA");
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(attempt))
    throw new Error("runId and attempt must be numeric");
  const root = resolve(dist);
  const files = [];
  async function walk(relative = "") {
    for (const entry of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Release contains a non-regular entry: ${path}`);
    }
  }
  await walk();
  for (const required of [
    "index.html",
    "data/transit-manifest.json",
    "data/city-boundaries-manifest.json",
    "data/city-boundaries.geojson",
    "data/transit-routes.geojson",
    "data/transit-stops.geojson",
    "data/transit-details.json",
    "data/roads-index.json",
    "data/roads-index.json.gz",
  ]) {
    if (!files.includes(required))
      throw new Error(`Required build output is missing: ${required}`);
  }
  const assets = files
    .filter((path) => /^assets\/.+\.(js|css)$/.test(path))
    .sort();
  if (
    !assets.some((path) => path.endsWith(".js")) ||
    !assets.some((path) => path.endsWith(".css"))
  )
    throw new Error("JavaScript and CSS build assets are required");
  const candidates = await Promise.all(
    files
      .filter((path) => /^data\/roads\/[a-f0-9]{2}\.geojson\.gz$/.test(path))
      .map(async (path) => ({
        path,
        bytes: (await lstat(join(root, path))).size,
      })),
  );
  candidates.sort((a, b) => a.bytes - b.bytes || a.path.localeCompare(b.path));
  if (!candidates.length)
    throw new Error("Compressed road geometry is missing");
  const smokeGeometry = candidates[0].path.slice(0, -3);
  if (!files.includes(smokeGeometry))
    throw new Error("Raw geometry fallback is missing");
  const releaseId = `${commit}-${runId}-${attempt}`;
  const version = {
    commit,
    basePath: "/socalmap/",
    releaseId,
    builtAt: new Date().toISOString(),
    assets,
    smokeGeometry,
  };
  await writeFile(
    join(root, "version.json"),
    `${JSON.stringify(version, null, 2)}\n`,
  );
  const out = resolve(output);
  await mkdir(out, { recursive: true });
  const archive = join(out, "socalmap.tar.gz");
  const tar = spawnSync(
    "tar",
    ["--format=ustar", "-czf", archive, "-C", root, "."],
    { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  if (tar.status !== 0)
    throw new Error(
      `tar failed: ${tar.stderr || tar.error?.message || tar.status}`,
    );
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await writeFile(
    join(out, "socalmap.tar.gz.sha256"),
    `${digest}  socalmap.tar.gz\n`,
  );
  await writeFile(
    join(out, "release.json"),
    `${JSON.stringify({ releaseId, commit, sha256: digest }, null, 2)}\n`,
  );
  return { releaseId, commit, sha256: digest, archive };
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
        "--dist": "dist",
        "--output": "output",
        "--commit": "commit",
        "--run-id": "runId",
        "--attempt": "attempt",
      };
      if (!names[args[i]] || !args[i + 1])
        throw new Error(
          "Usage: build-release.mjs --commit SHA [--dist dist --output release --run-id ID --attempt N]",
        );
      options[names[args[i]]] = args[i + 1];
    }
    console.log(JSON.stringify(await buildRelease(options)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
