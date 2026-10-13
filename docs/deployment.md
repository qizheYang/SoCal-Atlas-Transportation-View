# Production deployment

SoCal Atlas is served at **https://rehydratedwater.com/socalmap/** by the existing DigitalOcean Nginx host. The application is a static Vite build; deployment does not install a Node service or replace the domain's existing homepage and applications.

## Continuous integration and delivery

[`.github/workflows/socalmap.yml`](../.github/workflows/socalmap.yml) runs on pull requests, pushes to `main`, and manual dispatches. Every run uses Node 22 and Python 3.12 to:

1. Install the npm lockfile with `npm ci --legacy-peer-deps` and pinned Python GIS dependencies.
2. Run the application tests, road materialization tests, deployment packaging/smoke tests, GIS/GTFS fixture tests, and receiver tests. Tests use the committed snapshots and fixtures; they do not re-download transit or Census feeds.
3. Build with `npm run build -- --base=/socalmap/`. The build materializes raw road JSON from committed gzip files so browsers without gzip decoding have a fallback.
4. Add `version.json`, package the static files directly at the root of a USTAR gzip archive, calculate its SHA-256, and upload an immutable GitHub Actions artifact retained for 14 days. The version records the full commit, base path, release identity, built asset paths, and a small geometry shard for smoke checks.

Only this repository's `main` push/manual runs may enter the `production` environment and deploy. A separate job downloads the build artifact by its immutable artifact ID and verifies its checksum and run identity. Its token has only `contents: read`; production credentials are not exposed to pull-request jobs. All official GitHub Actions are pinned to verified commit SHAs. Production jobs are serialized without canceling an active deployment. Immediately before connecting to the host, the job checks that its commit is still the latest remote `main`; a superseded build is skipped, including a rerun of an old manual job. To deploy current `main` manually, use **Actions → SoCal Atlas CI and deployment → Run workflow → main**.

The `production` GitHub environment must restrict deployment branches to `main` and contain:

| Setting                | Kind     | Value/purpose                                                 |
| ---------------------- | -------- | ------------------------------------------------------------- |
| `SOCALMAP_HOST`        | Variable | Existing DigitalOcean server address                          |
| `SOCALMAP_PORT`        | Variable | SSH port; defaults to `22`                                    |
| `SOCALMAP_USER`        | Variable | `socalmap-deploy`                                             |
| `SOCALMAP_SSH_KEY`     | Secret   | Dedicated ED25519 deployment private key                      |
| `SOCALMAP_KNOWN_HOSTS` | Secret   | Host key verified through the existing trusted SSH connection |

Private key and known-hosts files are temporary, mode `0600`, and removed on exit. The workflow uses strict host-key checking, batch mode, and only the dedicated identity. It does not run `ssh-keyscan` as a trust decision, copy root credentials, or request an interactive server shell.

## Server layout and limited SSH contract

The deployment key is bound in a root-owned `authorized_keys` to a forced command. It has no forwarding, PTY, unrestricted shell, or sudo access. [`ops/provision.sh`](../ops/provision.sh) installs the account, receiver/config, and isolated Nginx include, backing up the existing domain configuration before validating and reloading Nginx.

| Path                                                      | Purpose                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `/srv/www/socalmap/releases/<commit>-<run-id>-<attempt>/` | Extracted static release                                       |
| `/srv/www/socalmap/current`                               | Atomic symlink to the active release                           |
| `/srv/www/socalmap/previous`                              | Previous release symlink for recovery                          |
| `/srv/www/socalmap/assets/`                               | Shared, immutable hashed assets retained for already-open tabs |
| `/usr/local/libexec/socalmap-deploy`                      | Root-owned forced-command receiver                             |
| `/etc/socalmap-deploy.json`                               | Root-owned receiver configuration                              |
| `/etc/nginx/snippets/socalmap.conf`                       | Nginx locations confined to `/socalmap`                        |
| `/var/backups/yangqizhe/socalmap-setup-*`                 | Provisioning configuration backups                             |

The receiver supports these exact commands:

```text
status
deploy <40-hex-commit>-<numeric-run-id>-<numeric-attempt> <64-hex-archive-sha256>
rollback <existing-release-id>
```

`deploy` reads the archive from SSH standard input; neither SCP nor a remote shell is needed. The receiver verifies the archive checksum and version identity, bounds archive/extracted sizes, rejects links/special files/path traversal, checks required files, and atomically switches the current symlink. Local and public checks confirm the exact version and index; a failure restores the prior release. Existing hashed assets are preserved, and missing data/assets return 404 instead of the application's HTML. Explicit `.gz` snapshots must remain binary payloads without `Content-Encoding: gzip`, because the application performs decompression itself.

## Public smoke checks and rollback

Before deployment, [`ops/smoke.mjs`](../ops/smoke.mjs) records **HEAD-only** status/redirect baselines for `/`, `/game/`, `/guandan/`, `/tac368/`, and `/api/auth/keys`. The existing `/game/` 403 is preserved rather than treated as a new failure. `/api/auth/keys` must remain 404; the smoke test never reads that endpoint's response body.

After promotion, the workflow checks:

- `/socalmap` redirects to the same origin's `/socalmap/`, and `version.json` matches the workflow commit and base path.
- HTML references resolve inside `/socalmap/assets/`; every declared JavaScript/CSS asset, including the overlap worker when present, is retrievable with a valid MIME type.
- The ten-county boundary and transit manifests, boundary/transit GeoJSON files, and transit details are readable and nonempty.
- The gzip road-search catalog decompresses and references the smoke geometry; the raw catalog fallback is available. This downloads the approximately 13 MB compressed catalog, not its approximately 101 MB raw equivalent.
- A small road geometry gzip decodes to exactly the raw fallback, with no accidental double-decompression headers.
- Missing JavaScript/data return 404, and adjacent route statuses/redirects match the pre-deployment baseline.

If these deeper public checks fail, the workflow invokes `rollback` for the release that was active before this deployment and marks the run failed. On the first deployment there is no earlier release for this outer rollback; receiver-level failures still undo its own promotion, while an outer smoke failure requires operator inspection. A successful pipeline confirms static delivery and data availability, not interactive WebGL rendering or live third-party tile availability.

An operator holding the restricted deployment key can inspect and restore an existing release without root access:

```bash
ssh -i /path/to/deploy-key \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/path/to/verified-known-hosts \
  socalmap-deploy@SERVER status

ssh -i /path/to/deploy-key \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/path/to/verified-known-hosts \
  socalmap-deploy@SERVER 'rollback FULL_COMMIT-RUN_ID-ATTEMPT'

node ops/smoke.mjs --origin https://rehydratedwater.com --commit FULL_COMMIT
```

`status` returns JSON with `current`, `previous`, and available `releases`; choose an exact existing release ID. Rollback is health-checked and does not rewrite Git history. Releases and shared assets are retained on the host; remove obsolete releases only after inspecting `current`/`previous`, and keep shared hashed assets that may still be requested by open tabs. An application code fix should be committed to `main` and allowed to pass the full pipeline.

## Local verification

```bash
npm test
node --test scripts/test_materialize_road_data.mjs ops/*.test.mjs
.venv-data/bin/python -m unittest discover -s scripts -p 'test_*.py'
python3 -m unittest discover -s ops/tests -p 'test_*.py'
npm run build -- --base=/socalmap/
node ops/build-release.mjs --commit "$(git rev-parse HEAD)" --run-id 0 --attempt 1
```

The smoke test fixtures bind only to loopback. Production output is under ignored `dist/`; release artifacts are under ignored `release/`. Never commit a deployment private key, copied server configuration containing credentials, or GitHub environment secret values.
