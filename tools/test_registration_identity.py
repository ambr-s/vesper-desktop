#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Keep registration branding across the legacy and Axo install screens."""
from pathlib import Path
import tempfile
import unittest

from transform import transform_registration_identity


class RegistrationIdentityTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def source(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return target

    def test_legacy_artwork(self):
        logo = self.source('stylesheets/components/InstallScreenSignalLogo.scss',
                           '../images/signal-logo-and-wordmark.svg')
        standalone = self.source('ts/components/standaloneRegistration/StandaloneRegistration.dom.tsx',
                                 'images/signal-logo-with-text.svg')
        transform_registration_identity(self.root)
        self.assertEqual(logo.read_text(), '../images/vesper-logo-and-wordmark.svg')
        self.assertEqual(standalone.read_text(), 'images/vesper-logo-with-text.svg')

    def test_axo_wrapper_and_both_theme_branches(self):
        logo = self.source('ts/components/installScreen/InstallScreenSignalLogo.dom.tsx',
                           "import { AxoBrand } from '../../axo/AxoBrand.dom.tsx';\n"
                           '<div className={position}><AxoBrand.LogoAndWordMark maxWidth={112} /></div>')
        themed = "light ? 'images/signal-logo-with-text--light.svg' : 'images/signal-logo-with-text--dark.svg'"
        paths = [self.source(path, themed) for path in (
            'ts/components/standaloneRegistration/StandaloneRegistration.dom.tsx',
            'ts/components/EntryPoint.dom.tsx')]
        transform_registration_identity(self.root)
        self.assertIn('<div className={position}><img', logo.read_text())
        self.assertIn('width={112}', logo.read_text())
        self.assertIn('alt="Vesper"', logo.read_text())
        self.assertNotIn('AxoBrand', logo.read_text())
        for path in paths:
            self.assertEqual(path.read_text(), themed.replace('signal-logo-with-text--light', 'vesper-logo-with-text').replace('signal-logo-with-text--dark', 'vesper-logo-with-text'))

    def test_unknown_layout_fails_closed(self):
        with self.assertRaises(FileNotFoundError):
            transform_registration_identity(self.root)


if __name__ == '__main__':
    unittest.main()
