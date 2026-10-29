#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
import pathlib
import subprocess
import tempfile
import unittest

from patch_series import series_path, upstream_tag


class PatchSeriesTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        for directory in ("patches", "patches/signal-8.32", "patches/signal-8.33"):
            path = self.root / directory
            path.mkdir(exist_ok=True)
            (path / "0001.patch").write_text("fixture")

    def test_old_releases_keep_original_series(self):
        for tag in ("v8.25.0", "v8.26.0", "v8.31.1"):
            with self.subTest(tag=tag):
                self.assertEqual(series_path(self.root, tag), self.root / "patches")

    def test_published_832_keeps_its_series(self):
        for tag in ("v8.32.0", "v8.32.1"):
            with self.subTest(tag=tag):
                self.assertEqual(series_path(self.root, tag),
                                 self.root / "patches/signal-8.32")

    def test_833_and_newer_use_rebased_series(self):
        for tag in ("v8.33.0", "v8.33.1", "v9.0.0"):
            with self.subTest(tag=tag):
                self.assertEqual(series_path(self.root, tag),
                                 self.root / "patches/signal-8.33")

    def test_missing_833_never_falls_back_to_published_series(self):
        (self.root / "patches/signal-8.33/0001.patch").unlink()
        with self.assertRaisesRegex(ValueError, "empty"):
            series_path(self.root, "v8.33.0")

    def test_reject_malformed_tags(self):
        for tag in ("8.32.0", "v8.32", "v8.32.0-beta", "v8.32.0\n", "../v8.32.0"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                series_path(self.root, tag)

    def test_missing_candidate_never_falls_back(self):
        (self.root / "patches/signal-8.32/0001.patch").unlink()
        with self.assertRaisesRegex(ValueError, "empty"):
            series_path(self.root, "v8.32.0")

    def test_export_uses_transform_parent_not_pin(self):
        def git(*args):
            return subprocess.check_output([
                "git", "-C", str(self.root), "-c", "commit.gpgsign=false",
                "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                *args], text=True, stderr=subprocess.DEVNULL).strip()
        git("init")
        git("commit", "--allow-empty", "-m", "upstream")
        git("tag", "v8.32.0")
        git("commit", "--allow-empty", "-m", "Vesper transforms")
        transform = git("rev-parse", "HEAD")
        (self.root / "upstream.pin").write_text("signal=v8.25.0\n")
        self.assertEqual(upstream_tag(self.root, transform), "v8.32.0")
        self.assertEqual(series_path(self.root, upstream_tag(self.root, transform)),
                         self.root / "patches/signal-8.32")


if __name__ == "__main__":
    unittest.main()
