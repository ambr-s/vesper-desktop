#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Exercise the real publisher with disposable packages, keys and HTTP remotes."""
import functools
import hashlib
import gzip
import http.server
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = "systems.amber.Vesper"
REF = f"app/{APP}/x86_64/stable"


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, **kwargs)
    if result.returncode:
        raise AssertionError(f"{args}:\n{result.stdout}")
    return result.stdout


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class LinuxRepositories(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="vesper-repositories-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        for directory in ("tools", "work", "gpg", "build/files/bin", "build/export", "deb/DEBIAN"):
            (cls.root / directory).mkdir(parents=True)
        cls.gpg = cls.root / "gpg"
        cls.gpg.chmod(0o700)
        cls.addClassCleanup(lambda: subprocess.run(
            ["gpgconf", "--homedir", str(cls.gpg), "--kill", "all"], check=False))
        shutil.copy2(ROOT / "tools/prepare-linux-repositories.sh", cls.root / "tools")
        (cls.root / "work/package.json").write_text('{"version":"1.0.0"}')
        (cls.root / "deb/DEBIAN/control").write_text(
            "Package: vesper-desktop\nVersion: 1.0.0\nArchitecture: amd64\n"
            "Maintainer: Test <test@example.invalid>\nDescription: Disposable fixture\n")
        cls.deb = cls.root / "fixture.deb"
        run("dpkg-deb", "--build", str(cls.root / "deb"), str(cls.deb))
        run("gpg", "--homedir", str(cls.gpg), "--batch", "--pinentry-mode", "loopback",
            "--passphrase", "", "--quick-generate-key", "Test <test@example.invalid>",
            "rsa2048", "sign", "0")
        cls.key = next(line.split(":")[9] for line in run(
            "gpg", "--homedir", str(cls.gpg), "--with-colons", "--list-secret-keys").splitlines()
                       if line.startswith("fpr:"))
        (cls.root / "build/metadata").write_text(
            f"[Application]\nname={APP}\nruntime=org.freedesktop.Platform/x86_64/25.08\n"
            "sdk=org.freedesktop.Sdk/x86_64/25.08\ncommand=fixture\n")
        (cls.root / "build/files/bin/fixture").write_text("disposable payload\n")
        cls.repo = cls.root / "artifacts/flatpak/repo"
        cls.repo.parent.mkdir(parents=True)
        run("flatpak", "build-export", "--arch=x86_64", str(cls.repo), str(cls.root / "build"), "stable")
        # Reproduce the build's unsigned deltas before the signing phase.
        run("flatpak", "build-update-repo", "--generate-static-deltas", str(cls.repo))
        cls.before_deltas = run("ostree", f"--repo={cls.repo}", "static-delta", "list")
        assert cls.before_deltas.strip(), "Fixture must contain pre-signing deltas"
        run("bash", str(cls.root / "tools/prepare-linux-repositories.sh"),
            str(cls.deb), str(cls.gpg), cls.key)
        handler = functools.partial(QuietHandler, directory=str(cls.repo))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    def test_apt_signed_hash_chain(self):
        apt = self.root / "artifacts/apt"
        stable = apt / "dists/stable"
        keyring = apt / "vesper-archive-keyring.gpg"
        run("gpgv", "--keyring", str(keyring), str(stable / "Release.gpg"), str(stable / "Release"))
        run("gpgv", "--keyring", str(keyring), "--output", str(self.root / "verified-release"),
            str(stable / "InRelease"))
        self.assertEqual((self.root / "verified-release").read_bytes(), (stable / "Release").read_bytes())
        section = None
        entries = []
        for line in (stable / "Release").read_text().splitlines():
            if not line.startswith(" "):
                section = line.rstrip(":")
            elif section in ("MD5Sum", "SHA1", "SHA256", "SHA512"):
                digest, size, name = line.split()
                self.assertNotIn(name, ("Release", "Release.gpg", "InRelease"), "Release must not index itself")
                data = (stable / name).read_bytes()
                algorithm = {"MD5Sum": "md5"}.get(section, section.lower())
                self.assertEqual(hashlib.new(algorithm, data).hexdigest(), digest)
                self.assertEqual(len(data), int(size))
                entries.append((section, name))
        for name in ("Packages", "Packages.gz"):
            self.assertIn(("SHA256", f"main/binary-amd64/{name}"), entries)
        packages = (stable / "main/binary-amd64/Packages").read_bytes()
        self.assertEqual(gzip.decompress((stable / "main/binary-amd64/Packages.gz").read_bytes()), packages)
        fields = dict(line.split(": ", 1) for line in packages.decode().splitlines() if ": " in line)
        payload = (apt / fields["Filename"]).read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(), fields["SHA256"])
        self.assertEqual(len(payload), int(fields["Size"]))

    def test_fresh_flatpak_installs(self):
        expected = run("ostree", f"--repo={self.repo}", "rev-parse", REF).strip()
        for mode in ("default-1", "default-2", "without-deltas"):
            with self.subTest(mode=mode):
                home = self.root / mode
                env = dict(os.environ, HOME=str(home), XDG_DATA_HOME=str(home / "data"),
                           XDG_CONFIG_HOME=str(home / "config"), XDG_CACHE_HOME=str(home / "cache"))
                home.mkdir()
                run("flatpak", "remote-add", "--user",
                    f"--gpg-import={self.root}/artifacts/apt/vesper-archive-keyring.gpg",
                    "fixture", f"http://127.0.0.1:{self.server.server_port}", env=env)
                options = ["--no-static-deltas"] if mode == "without-deltas" else []
                run("flatpak", "install", "--user", "--noninteractive", "--no-deps", "--no-related",
                    *options, "fixture", REF, env=env)
                self.assertEqual(run("flatpak", "info", "--user", "--show-commit", APP, env=env).strip(), expected)
                repo = home / "data/flatpak/repo"
                run("ostree", f"--repo={repo}", "show", "--gpg-verify-remote=fixture", expected)
                config = (repo / "config").read_text()
                self.assertIn("gpg-verify=true", config)
                self.assertIn("gpg-verify-summary=true", config)

    def test_untrusted_remote_is_rejected(self):
        client = self.root / "untrusted-client"
        run("ostree", f"--repo={client}", "init", "--mode=bare-user-only")
        run("ostree", f"--repo={client}", "remote", "add",
            "--set=gpg-verify=true", "--set=gpg-verify-summary=true",
            "fixture", f"http://127.0.0.1:{self.server.server_port}")
        with self.assertRaisesRegex(AssertionError, "GPG|signature|public key"):
            run("ostree", f"--repo={client}", "pull", "--require-static-deltas", "fixture", REF)

    def test_signed_static_delta_pull(self):
        client = self.root / "delta-client"
        run("ostree", f"--repo={client}", "init", "--mode=bare-user-only")
        run("ostree", f"--repo={client}", "remote", "add",
            "--set=gpg-verify=true", "--set=gpg-verify-summary=true",
            f"--gpg-import={self.root}/artifacts/apt/vesper-archive-keyring.gpg",
            "fixture", f"http://127.0.0.1:{self.server.server_port}")
        run("ostree", f"--repo={client}", "pull", "--require-static-deltas", "fixture", REF)
        run("ostree", f"--repo={client}", "show", "--gpg-verify-remote=fixture", f"fixture:{REF}")


if __name__ == "__main__":
    unittest.main()
