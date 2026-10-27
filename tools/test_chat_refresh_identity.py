#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Exercise identity validation against a materialised checkout, without editing it."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
CONVERSATION = pathlib.Path("ts/components/conversation")


@unittest.skipUnless((WORK / "package.json").exists(), "materialise work/ first")
class ChatRefreshIdentityTest(unittest.TestCase):
    def verify(self, mutations=None):
        # Symlink unchanged inputs; copy only the path under test. The verifier
        # never writes source files, so the running build is unaffected.
        with tempfile.TemporaryDirectory() as directory:
            checkout = pathlib.Path(directory)
            mutations = mutations or {}
            def populate(source, target, prefix=pathlib.Path()):
                target.mkdir(exist_ok=True)
                for item in source.iterdir():
                    relative = prefix / item.name
                    if relative in mutations:
                        (target / item.name).write_text(mutations[relative])
                    elif any(relative in path.parents for path in mutations):
                        populate(item, target / item.name, relative)
                    else:
                        (target / item.name).symlink_to(item)
            populate(WORK, checkout)
            return subprocess.run(
                ["node", str(ROOT / "tools/verify-identity.mjs"), str(checkout)],
                capture_output=True, text=True, check=False,
            )

    def test_materialised_chat_refresh_route(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_chat_refresh_must_use_vesper_support(self):
        paths = [CONVERSATION / name for name in (
            "ChatSessionRefreshedDialog.dom.tsx",
            "ChatSessionRefreshedNotification.dom.tsx",
        )]
        result = self.verify({path: (WORK / path).read_text().replace(
            "createSupportUrl", "removedVesperSupportRoute"
        ) for path in paths})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not routed through Vesper support", result.stderr)

    def test_notification_cannot_reintroduce_signal_support(self):
        path = CONVERSATION / "ChatSessionRefreshedNotification.dom.tsx"
        result = self.verify({path: (WORK / path).read_text() +
            "\n// https://support.signal.org/hc/requests/new\n"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Signal support submission remains", result.stderr)


if __name__ == "__main__":
    unittest.main()
