#!/usr/bin/env python3
"""Root-owned forced SSH command; run only as the unprivileged deploy account."""

from __future__ import annotations

import contextlib
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import uuid


CONFIG_PATH = Path("/etc/socalmap-deploy.json")
BASE_PATH = "/socalmap/"
RELEASE_PATTERN = r"[0-9a-f]{40}-[0-9]+-[0-9]+"
RELEASE_RE = re.compile(RELEASE_PATTERN)
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_TAR_BYTES = MAX_EXTRACTED_BYTES + 64 * 1024 * 1024
MAX_MEMBERS = 20_000
CHUNK_BYTES = 1024 * 1024


class DeployError(Exception):
    pass


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_directory(path):
    path = Path(path)
    if path.is_symlink():
        raise DeployError(f"Directory must not be a symlink: {path.name}")
    path.mkdir(mode=0o755, parents=True, exist_ok=True)
    if not path.is_dir():
        raise DeployError(f"Not a directory: {path.name}")
    path.chmod(0o755)


class BoundedTarReader:
    """Bound gzip expansion before the tar parser can allocate metadata buffers."""

    def __init__(self, source):
        self.source = source
        self.total = 0

    def read(self, amount):
        value = self.source.read(amount)
        self.total += len(value)
        if self.total > MAX_TAR_BYTES:
            raise DeployError("Expanded tar exceeds the size limit")
        return value

    def exact(self, amount):
        value = self.read(amount)
        if len(value) != amount:
            raise DeployError("Truncated tar archive")
        return value


def archive_path(name):
    if not name or len(name) > 512 or name.startswith("/"):
        raise DeployError("Invalid archive path")
    if "\\" in name or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise DeployError("Invalid characters in archive path")
    if ".." in name.split("/"):
        raise DeployError("Archive path traversal is forbidden")
    path = PurePosixPath(name)
    return Path(*path.parts) if path.parts else Path(".")


def extract_archive(archive, destination):
    """Accept USTAR regular files/directories, never links or metadata extensions."""
    extracted_bytes = 0
    members = 0
    seen_files = set()
    with gzip.open(archive, "rb") as compressed:
        source = BoundedTarReader(compressed)
        while True:
            header = source.exact(tarfile.BLOCKSIZE)
            if header == bytes(tarfile.BLOCKSIZE):
                if source.exact(tarfile.BLOCKSIZE) != bytes(tarfile.BLOCKSIZE):
                    raise DeployError("Invalid tar end marker")
                while padding := source.read(CHUNK_BYTES):
                    if padding.strip(b"\0"):
                        raise DeployError("Trailing archive payload is forbidden")
                break
            try:
                member = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
            except (tarfile.HeaderError, UnicodeError) as error:
                raise DeployError("Invalid tar header") from error
            members += 1
            if members > MAX_MEMBERS:
                raise DeployError("Archive has too many entries")
            if member.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
                raise DeployError("Only USTAR regular files and directories are accepted")
            if member.size < 0 or member.size > MAX_MEMBER_BYTES:
                raise DeployError("Archive member exceeds the size limit")
            relative = archive_path(member.name)
            target = destination / relative
            if member.isdir():
                if member.size:
                    raise DeployError("Archive directory contains data")
                safe_directory(target)
                continue
            if relative == Path(".") or relative in seen_files:
                raise DeployError("Duplicate or invalid archive file")
            seen_files.add(relative)
            extracted_bytes += member.size
            if extracted_bytes > MAX_EXTRACTED_BYTES:
                raise DeployError("Extracted files exceed the size limit")
            safe_directory(target.parent)
            # An empty staging directory plus exclusive writes prevents archive overwrite.
            with target.open("xb") as output:
                remaining = member.size
                while remaining:
                    chunk = source.exact(min(remaining, CHUNK_BYTES))
                    output.write(chunk)
                    remaining -= len(chunk)
                output.flush()
                os.fsync(output.fileno())
            target.chmod(0o644)
            padding = (-member.size) % tarfile.BLOCKSIZE
            if padding:
                source.exact(padding)
    return {"files": len(seen_files), "bytes": extracted_bytes}


def validate_release(directory, release_id):
    for relative in ("index.html", "version.json", "data/transit-manifest.json", "data/roads-index.json.gz"):
        path = directory / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise DeployError(f"Release is missing required file: {relative}")
    version_path = directory / "version.json"
    if version_path.stat().st_size > 65536:
        raise DeployError("version.json is too large")
    try:
        version = json.loads(version_path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as error:
        raise DeployError("Invalid version.json") from error
    if not isinstance(version, dict) or version.get("commit") != release_id[:40]:
        raise DeployError("version.json commit does not match the release")
    if version.get("basePath") != BASE_PATH:
        raise DeployError("version.json basePath must be /socalmap/")
    if version.get("releaseId") != release_id:
        raise DeployError("version.json releaseId does not match the release")
    return version


def public_health(origin, release_id, directory):
    """Check the public Nginx route, not merely the filesystem after promotion."""
    expected_index = sha256_file(directory / "index.html")
    expected_commit = release_id[:40]
    last_error = None
    for attempt in range(3):
        try:
            results = {}
            for name, limit in (("version.json", 65536), ("index.html", 8 * 1024 * 1024)):
                url = f"{origin}{BASE_PATH}{name}?release={release_id}&check={uuid.uuid4().hex}"
                request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "socalmap-deploy/1"})
                with urllib.request.urlopen(request, timeout=8) as response:
                    final_url = urllib.parse.urlsplit(response.geturl())
                    if f"{final_url.scheme}://{final_url.netloc}" != origin or response.status != 200:
                        raise DeployError("Unexpected public health response")
                    body = response.read(limit + 1)
                    if len(body) > limit:
                        raise DeployError("Public health response exceeds its size limit")
                    results[name] = body
            version = json.loads(results["version.json"])
            if version.get("commit") != expected_commit or version.get("basePath") != BASE_PATH or version.get("releaseId") != release_id:
                raise DeployError("Public version.json does not match the promoted release")
            if hashlib.sha256(results["index.html"]).hexdigest() != expected_index:
                raise DeployError("Public index.html does not match the promoted release")
            return
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(1)
    raise DeployError(f"Public health check failed: {last_error}")


class Receiver:
    def __init__(self, root, origin, health=public_health):
        self.root = Path(root)
        self.origin = origin
        self.health = health
        safe_directory(self.root)
        safe_directory(self.root / "releases")
        safe_directory(self.root / "assets")

    @contextlib.contextmanager
    def locked(self):
        lock_path = self.root / ".deploy.lock"
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise DeployError("Another deployment is already running") from error
            yield

    def link_target(self, name):
        link = self.root / name
        if not link.is_symlink():
            if link.exists():
                raise DeployError(f"{name} must be a managed release symlink")
            return None
        target = os.readlink(link)
        prefix = "releases/"
        if not target.startswith(prefix) or not RELEASE_RE.fullmatch(target[len(prefix):]):
            raise DeployError(f"Invalid {name} release symlink")
        release_id = target[len(prefix):]
        directory = self.root / target
        if directory.is_symlink() or not directory.is_dir():
            raise DeployError(f"Missing {name} release")
        return release_id

    def set_link(self, name, release_id):
        link = self.root / name
        if release_id is None:
            link.unlink(missing_ok=True)
            return
        temporary = self.root / f".{name}-{uuid.uuid4().hex}"
        try:
            temporary.symlink_to(f"releases/{release_id}")
            os.replace(temporary, link)
        finally:
            temporary.unlink(missing_ok=True)

    def status(self):
        with self.locked():
            return {"current": self.link_target("current"), "previous": self.link_target("previous"),
                    "releases": sorted(path.name for path in (self.root / "releases").iterdir()
                                       if RELEASE_RE.fullmatch(path.name) and path.is_dir() and not path.is_symlink())}

    def copy_assets(self, directory):
        source = directory / "assets"
        if not source.is_dir() or source.is_symlink():
            raise DeployError("Release assets directory is missing")
        for asset in sorted(source.rglob("*")):
            if asset.is_symlink():
                raise DeployError("Asset symlinks are forbidden")
            target = self.root / "assets" / asset.relative_to(source)
            if asset.is_dir():
                safe_directory(target)
                continue
            if not asset.is_file():
                raise DeployError("Asset must be a regular file")
            safe_directory(target.parent)
            if target.is_symlink():
                raise DeployError("Shared asset symlinks are forbidden")
            if target.exists():
                if not target.is_file() or sha256_file(target) != sha256_file(asset):
                    raise DeployError(f"Immutable asset filename collision: {asset.relative_to(source)}")
                continue
            temporary = target.parent / f".incoming-{uuid.uuid4().hex}"
            try:
                shutil.copyfile(asset, temporary)
                temporary.chmod(0o644)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)

    def promote(self, release_id):
        directory = self.root / "releases" / release_id
        if directory.is_symlink() or not directory.is_dir():
            raise DeployError("Unknown release")
        validate_release(directory, release_id)
        previous_current = self.link_target("current")
        self.link_target("previous")
        self.set_link("current", release_id)
        try:
            self.health(self.origin, release_id, directory)
            if previous_current and previous_current != release_id:
                self.set_link("previous", previous_current)
        except Exception as error:
            self.set_link("current", previous_current)
            raise DeployError(f"Promotion failed; prior current restored: {error}") from error
        return {"current": release_id, "previous": self.link_target("previous"), "healthy": True}

    def deploy(self, release_id, expected_sha, stream):
        if not RELEASE_RE.fullmatch(release_id) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
            raise DeployError("Invalid release id or archive SHA256")
        with self.locked():
            final = self.root / "releases" / release_id
            if final.exists() or final.is_symlink():
                raise DeployError("Release id already exists; use a new run attempt")
            with tempfile.TemporaryDirectory(prefix=".incoming-", dir=self.root / "releases") as temporary:
                working = Path(temporary)
                archive = working / "payload.tar.gz"
                content = working / "content"
                content.mkdir(mode=0o755)
                digest = hashlib.sha256()
                size = 0
                with archive.open("xb") as output:
                    while chunk := stream.read(CHUNK_BYTES):
                        size += len(chunk)
                        if size > MAX_ARCHIVE_BYTES:
                            raise DeployError("Compressed archive exceeds the size limit")
                        digest.update(chunk)
                        output.write(chunk)
                if digest.hexdigest() != expected_sha:
                    raise DeployError("Archive SHA256 mismatch")
                try:
                    inventory = extract_archive(archive, content)
                except (OSError, EOFError, tarfile.TarError) as error:
                    raise DeployError(f"Malformed archive: {error}") from error
                validate_release(content, release_id)
                self.copy_assets(content)
                content.chmod(0o755)
                os.rename(content, final)
            result = self.promote(release_id)
            return {**result, "archiveSha256": expected_sha, **inventory}

    def rollback(self, release_id):
        if not RELEASE_RE.fullmatch(release_id):
            raise DeployError("Invalid release id")
        with self.locked():
            return self.promote(release_id)


def load_config():
    # Neither SSH environment variables nor caller-provided arguments may choose
    # the filesystem root or health-check destination.
    descriptor = os.open(CONFIG_PATH, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "r", encoding="utf-8") as source:
        metadata = os.fstat(source.fileno())
        if metadata.st_uid != 0 or metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise DeployError("Deployment config must be root-owned and not group/world writable")
        config = json.load(source)
    if not isinstance(config, dict) or set(config) != {"root", "origin"}:
        raise DeployError("Deployment config must contain only root and origin")
    root = config["root"]
    origin = config["origin"]
    if not isinstance(root, str) or not Path(root).is_absolute() or root == "/":
        raise DeployError("Deployment root must be an absolute directory")
    if not isinstance(origin, str):
        raise DeployError("Invalid public origin")
    parsed = urllib.parse.urlsplit(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise DeployError("Public origin must be an HTTPS origin without a path")
    return config


def main():
    os.umask(0o022)
    try:
        original = os.environ.get("SSH_ORIGINAL_COMMAND", "")
        deploy_match = re.fullmatch(rf"deploy ({RELEASE_PATTERN}) ([0-9a-f]{{64}})", original)
        rollback_match = re.fullmatch(rf"rollback ({RELEASE_PATTERN})", original)
        if original != "status" and not deploy_match and not rollback_match:
            raise DeployError("Allowed commands: status; deploy <release-id> <archive-sha256>; rollback <release-id>")
        receiver = Receiver(**load_config())
        if deploy_match:
            result = receiver.deploy(*deploy_match.groups(), sys.stdin.buffer)
        elif rollback_match:
            result = receiver.rollback(rollback_match.group(1))
        else:
            result = receiver.status()
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
