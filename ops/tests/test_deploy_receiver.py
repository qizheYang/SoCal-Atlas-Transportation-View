"""Executable invariants for the unprivileged deployment receiver."""

import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "receiver", Path(__file__).resolve().parents[1] / "server" / "socalmap-deploy.py"
)
receiver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receiver)

SHA_A = "a" * 40
SHA_B = "b" * 40
RELEASE_A = f"{SHA_A}-100-1"
RELEASE_B = f"{SHA_B}-101-1"


def make_archive(commit=SHA_A, extra=None, base="/socalmap/", members=None, missing=None, release_id=None):
    release_id = release_id or (RELEASE_A if commit == SHA_A else RELEASE_B)
    files = {
        "./index.html": b'<!doctype html><html><script src="/socalmap/assets/app-12345678.js"></script></html>',
        "./version.json": json.dumps({"commit": commit, "basePath": base, "releaseId": release_id}).encode(),
        "./assets/app-12345678.js": b"console.log('immutable');",
        "./data/transit-manifest.json": b'{"agencies": []}',
        "./data/roads-index.json.gz": gzip.compress(b'{"roads": []}'),
    }
    if extra:
        files.update(extra)
    if missing:
        files.pop(missing)
    target = io.BytesIO()
    with tarfile.open(fileobj=target, mode="w:gz", format=tarfile.USTAR_FORMAT) as archive:
        root = tarfile.TarInfo(".")
        root.type = tarfile.DIRTYPE
        archive.addfile(root)
        for name, body in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(body)
            archive.addfile(info, io.BytesIO(body))
        for info, body in members or []:
            archive.addfile(info, io.BytesIO(body))
    return target.getvalue()


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "site"
        self.health_calls = []
        self.app = receiver.Receiver(self.root, "https://example.test", self.health)

    def tearDown(self):
        self.temporary.cleanup()

    def health(self, origin, release_id, directory):
        # Public health is invoked only after current resolves to this exact release.
        self.assertEqual((self.root / "current").resolve(), directory.resolve())
        self.health_calls.append(release_id)

    def deploy(self, payload=None, release_id=RELEASE_A):
        payload = payload or make_archive()
        return self.app.deploy(release_id, hashlib.sha256(payload).hexdigest(), io.BytesIO(payload))

    def assert_empty(self):
        self.assertEqual(self.app.status(), {"current": None, "previous": None, "releases": []})
        self.assertEqual(list((self.root / "releases").iterdir()), [])

    def test_deployment_promotion_previous_rollback_and_shared_assets(self):
        first = self.deploy()
        self.assertEqual(first["current"], RELEASE_A)
        self.assertEqual(first["files"], 5)
        second = self.deploy(make_archive(SHA_B, {"./assets/new-87654321.js": b"second"}), RELEASE_B)
        self.assertEqual(second["previous"], RELEASE_A)
        self.assertEqual(os.readlink(self.root / "current"), f"releases/{RELEASE_B}")
        self.assertEqual((self.root / "assets/new-87654321.js").read_bytes(), b"second")
        self.app.rollback(RELEASE_A)
        self.assertEqual(self.app.status()["current"], RELEASE_A)
        self.assertEqual(self.app.status()["previous"], RELEASE_B)
        self.assertEqual(self.health_calls, [RELEASE_A, RELEASE_B, RELEASE_A])
        self.assertTrue((self.root / "assets/new-87654321.js").exists())
        self.assertEqual((self.root / "releases" / RELEASE_A / "index.html").stat().st_mode & 0o777, 0o644)

    def test_sha_mismatch_does_not_extract_or_promote(self):
        with self.assertRaisesRegex(receiver.DeployError, "SHA256 mismatch"):
            self.app.deploy(RELEASE_A, "0" * 64, io.BytesIO(make_archive()))
        self.assert_empty()

    def test_version_commit_base_and_required_files_rejected(self):
        for payload in (make_archive(SHA_B), make_archive(base="/"), make_archive(missing="./data/roads-index.json.gz"), make_archive(release_id=f"{SHA_A}-100-2")):
            with self.subTest(payload=hashlib.sha256(payload).hexdigest()):
                with self.assertRaises(receiver.DeployError):
                    self.deploy(payload)
                self.assert_empty()

    def test_traversal_absolute_and_control_paths_rejected(self):
        for name in ("../escape", "./assets/../../escape", "/tmp/escape", "bad\\path", "bad\npath"):
            with self.subTest(name=name):
                with self.assertRaises(receiver.DeployError):
                    self.deploy(make_archive(extra={name: b"bad"}))
                self.assert_empty()
                self.assertFalse((self.root.parent / "escape").exists())

    def test_links_special_entries_and_metadata_rejected(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.XHDTYPE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_SPARSE, tarfile.CONTTYPE):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo("./special")
                member.type = kind
                member.linkname = "../../outside"
                with self.assertRaises(receiver.DeployError):
                    self.deploy(make_archive(members=[(member, b"")]))
                self.assert_empty()

    def test_duplicate_file_rejected(self):
        member = tarfile.TarInfo("index.html")
        member.size = 4
        with self.assertRaisesRegex(receiver.DeployError, "Duplicate"):
            self.deploy(make_archive(members=[(member, b"evil")]))
        self.assert_empty()

    def test_invalid_gzip_and_truncated_tar_rejected(self):
        for payload in (b"not gzip", gzip.compress(b"short")):
            with self.assertRaises(receiver.DeployError):
                self.deploy(payload)
            self.assert_empty()

    def test_appended_nonzero_payload_rejected(self):
        raw = gzip.decompress(make_archive())
        with self.assertRaisesRegex(receiver.DeployError, "Trailing archive"):
            self.deploy(gzip.compress(raw + b"payload"))
        self.assert_empty()

    def test_compressed_extracted_member_and_tar_limits(self):
        for constant, limit in (("MAX_ARCHIVE_BYTES", 10), ("MAX_EXTRACTED_BYTES", 100), ("MAX_MEMBER_BYTES", 10), ("MAX_TAR_BYTES", 512), ("MAX_MEMBERS", 2)):
            with self.subTest(constant=constant), patch.object(receiver, constant, limit):
                with self.assertRaises(receiver.DeployError):
                    self.deploy()
            self.assert_empty()

    def test_failed_health_restores_existing_current_and_previous(self):
        self.deploy()
        self.app.health = lambda *_: (_ for _ in ()).throw(RuntimeError("public route unavailable"))
        with self.assertRaisesRegex(receiver.DeployError, "prior current restored"):
            self.deploy(make_archive(SHA_B), RELEASE_B)
        status = self.app.status()
        self.assertEqual(status["current"], RELEASE_A)
        self.assertIsNone(status["previous"])
        self.assertIn(RELEASE_B, status["releases"])

    def test_failed_first_health_removes_current(self):
        self.app.health = lambda *_: (_ for _ in ()).throw(RuntimeError("offline"))
        with self.assertRaisesRegex(receiver.DeployError, "prior current restored"):
            self.deploy()
        self.assertIsNone(self.app.status()["current"])
        self.assertFalse((self.root / "current").is_symlink())

    def test_failed_rollback_restores_newer_current(self):
        self.deploy()
        self.deploy(make_archive(SHA_B), RELEASE_B)
        self.app.health = lambda *_: (_ for _ in ()).throw(RuntimeError("offline"))
        with self.assertRaises(receiver.DeployError):
            self.app.rollback(RELEASE_A)
        self.assertEqual(self.app.status()["current"], RELEASE_B)
        self.assertEqual(self.app.status()["previous"], RELEASE_A)

    def test_asset_name_collision_preserves_current_and_asset(self):
        self.deploy()
        original = (self.root / "assets/app-12345678.js").read_bytes()
        with self.assertRaisesRegex(receiver.DeployError, "filename collision"):
            self.deploy(make_archive(SHA_B, {"./assets/app-12345678.js": b"changed"}), RELEASE_B)
        self.assertEqual(self.app.status()["current"], RELEASE_A)
        self.assertEqual((self.root / "assets/app-12345678.js").read_bytes(), original)
        self.assertFalse((self.root / "releases" / RELEASE_B).exists())

    def test_unknown_rollback_and_duplicate_release_rejected(self):
        with self.assertRaisesRegex(receiver.DeployError, "Unknown release"):
            self.app.rollback(RELEASE_A)
        self.deploy()
        with self.assertRaisesRegex(receiver.DeployError, "already exists"):
            self.deploy()
        for release_id in ("../../etc", RELEASE_A + "; touch /tmp/bad", SHA_A):
            with self.assertRaisesRegex(receiver.DeployError, "Invalid release"):
                self.app.rollback(release_id)

    def test_concurrent_deployment_is_rejected(self):
        with self.app.locked():
            with self.assertRaisesRegex(receiver.DeployError, "already running"):
                self.deploy()
        self.assert_empty()

    def test_unmanaged_current_symlink_is_rejected(self):
        (self.root / "current").symlink_to("/etc")
        with self.assertRaisesRegex(receiver.DeployError, "Invalid current"):
            self.app.status()

    def test_main_rejects_shell_and_extra_arguments_before_config(self):
        for command in ("", "sh", "status; id", "status extra", "deploy x y", "rollback ../../etc"):
            with self.subTest(command=command), patch.dict(os.environ, {"SSH_ORIGINAL_COMMAND": command}), patch.object(receiver, "load_config") as config, patch("sys.stderr", new_callable=io.StringIO) as stderr:
                self.assertEqual(receiver.main(), 1)
                self.assertIn("Allowed commands", stderr.getvalue())
                config.assert_not_called()

    def test_public_health_checks_commit_base_and_exact_index(self):
        self.deploy()
        directory = self.root / "releases" / RELEASE_A

        def response(request, timeout):
            name = receiver.urllib.parse.urlsplit(request.full_url).path.rsplit("/", 1)[-1]
            body = (directory / name).read_bytes()
            stream = io.BytesIO(body)
            stream.status = 200
            stream.geturl = lambda: request.full_url
            self.assertEqual(timeout, 8)
            self.assertEqual(request.get_header("Cache-control"), "no-cache")
            return stream

        with patch.object(receiver.urllib.request, "urlopen", side_effect=response) as fetch:
            receiver.public_health("https://example.test", RELEASE_A, directory)
        self.assertEqual(fetch.call_count, 2)

        for bad_name, bad_body in (("version.json", b"{}"), ("index.html", b'<html>old index</html>')):
            def broken_response(request, timeout):
                name = receiver.urllib.parse.urlsplit(request.full_url).path.rsplit("/", 1)[-1]
                stream = io.BytesIO(bad_body if name == bad_name else (directory / name).read_bytes())
                stream.status = 200
                stream.geturl = lambda: request.full_url
                return stream
            with self.subTest(body=bad_body), patch.object(receiver.urllib.request, "urlopen", side_effect=broken_response), patch.object(receiver.time, "sleep"):
                with self.assertRaisesRegex(receiver.DeployError, "Public health check failed"):
                    receiver.public_health("https://example.test", RELEASE_A, directory)

    def test_public_health_rejects_cross_origin_redirect(self):
        self.deploy()
        directory = self.root / "releases" / RELEASE_A

        def response(*_args, **_kwargs):
            stream = io.BytesIO(b"{}")
            stream.status = 200
            stream.geturl = lambda: "https://unexpected.example/"
            return stream

        with patch.object(receiver.urllib.request, "urlopen", side_effect=response), patch.object(receiver.time, "sleep"):
            with self.assertRaisesRegex(receiver.DeployError, "Unexpected public health response"):
                receiver.public_health("https://example.test", RELEASE_A, directory)


if __name__ == "__main__":
    unittest.main()
