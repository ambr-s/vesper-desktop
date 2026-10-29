#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Regression tests for Flatpak AppStream release identity."""
import importlib.util
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent


class FlatpakMetadataTests(unittest.TestCase):
    def test_release_generated_from_payload_and_utc_epoch(self):
        spec = importlib.util.spec_from_file_location(
            "flatpak_metadata", ROOT / "tools/flatpak_metadata.py"
        )
        self.assertTrue(Path(spec.origin).exists(), "missing dynamic metadata generator")
        metadata = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(metadata)
        for version in ("8.33.0", "9.1.2-beta.3"):
            with self.subTest(version=version):
                xml = metadata.generate(
                    ROOT / "flatpak/systems.amber.Vesper.metainfo.xml", version, 0
                )
                release = ET.fromstring(xml).find("releases/release")
                self.assertEqual(release.attrib, {"version": version, "date": "1970-01-01"})
                self.assertNotIn("8.20.0", xml)
                self.assertIn(version, "".join(release.itertext()))

    def test_audit_rejects_stale_missing_duplicate_or_wrong_date(self):
        import flatpak_metadata
        self.assertTrue(hasattr(flatpak_metadata, "verify"), "missing payload agreement audit")
        generate, verify = flatpak_metadata.generate, flatpak_metadata.verify
        import tempfile
        xml = generate(ROOT / "flatpak/systems.amber.Vesper.metainfo.xml", "8.33.0", 0)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metadata.xml"
            path.write_text(xml)
            verify(path, "8.33.0", "8.33.0", 0)
            for broken in (
                xml.replace("8.33.0", "8.20.0"),
                xml.replace('date="1970-01-01"', 'date="2026-07-25"'),
                xml.replace("<releases>", '<releases><release version="8.33.0" date="1970-01-01"/>'),
                xml.replace("<releases>", "<ignored>").replace("</releases>", "</ignored>"),
            ):
                path.write_text(broken)
                with self.assertRaises(ValueError):
                    verify(path, "8.33.0", "8.33.0", 0)
            path.write_text(xml)
            with self.assertRaises(ValueError):
                verify(path, "8.33.0", "8.34.0", 0)


if __name__ == "__main__":
    unittest.main()
