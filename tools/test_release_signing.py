#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Exercise the actual workflow tag gate using disposable local repositories.

Only ephemeral test keys are generated; no production private key is used.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def signing_step():
    lines = (ROOT / '.github/workflows/release.yml').read_text().splitlines()
    start = lines.index('      - name: Verify signed release tag')
    start = lines.index('        run: |', start) + 1
    script = []
    for line in lines[start:]:
        if line and not line.startswith('          '):
            break
        script.append(line[10:])
    return '\n'.join(script)


class WorkflowTests(unittest.TestCase):
    def test_both_release_jobs_select_the_signed_tag_not_published_pin(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        selection = '''      - name: Materialise Vesper
        env:
          RELEASE_SIGNAL_TAG: ${{ github.ref_name }}
        run: ./tools/materialize.sh --tag "$RELEASE_SIGNAL_TAG"'''
        self.assertEqual(workflow.count(selection), 2)
        # Exercise the actual command with a recorder, including shell metacharacters.
        command = selection.split('        run: ', 1)[1]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'tools').mkdir()
            recorder = path / 'tools/materialize.sh'
            recorder.write_text('#!/bin/bash\nprintf "%s\\n" "$@" > arguments\n')
            recorder.chmod(0o755)
            for tag in ('v8.35.0', 'main', 'v8.35.0; touch injected'):
                with self.subTest(tag=tag):
                    subprocess.run(['bash', '-euo', 'pipefail', '-c', command],
                                   cwd=path, env=dict(os.environ, RELEASE_SIGNAL_TAG=tag),
                                   check=True)
                    self.assertEqual((path / 'arguments').read_text().splitlines(),
                                     ['--tag', tag])
                    self.assertFalse((path / 'injected').exists())

    def test_materializer_rejects_non_release_ref_before_cloning(self):
        for tag in ('main', 'v8.35.0-beta.1', 'v8.35.0; touch injected'):
            with self.subTest(tag=tag):
                result = subprocess.run([str(ROOT / 'tools/materialize.sh'), '--tag', tag],
                                        capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Invalid Signal tag:', result.stderr)

    def test_checkout_free_publish_has_repository_context(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        publish = workflow.split('\n  publish:', 1)[1]
        self.assertIn('GH_REPO: ${{ github.repository }}', publish)


class ReleaseSigningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vesper-signing-test-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.env = dict(os.environ, HOME=str(self.path), GIT_CONFIG_NOSYSTEM='1',
                        GIT_CONFIG_GLOBAL=os.devnull, GITHUB_REF='refs/tags/v1.2.3',
                        GITHUB_OUTPUT=str(self.path / 'output'))
        self.run_command('git', 'init', '-q')
        self.git('config', 'user.name', 'Release test')
        self.git('config', 'user.email', 'release@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'gpg.format', 'ssh')
        for name in ('trusted', 'other'):
            self.run_command('ssh-keygen', '-q', '-t', 'ed25519', '-N', '',
                             '-f', str(self.path / name))
        self.git('config', 'user.signingkey', str(self.path / 'trusted'))
        (self.path / 'work').mkdir()
        (self.path / 'work/package.json').write_text('{"version":"1.2.3"}')
        trust = self.path / '.github/release-signers'
        trust.parent.mkdir()
        trust.write_text('release@example.invalid namespaces="git" ' +
                         (self.path / 'trusted.pub').read_text())
        self.git('add', 'work/package.json', '.github/release-signers')
        self.git('commit', '-qm', 'release input')
        self.git('tag', '-s', 'v1.2.3', '-m', 'release')
        self.run_command('git', 'init', '--bare', '-q', 'remote.git')
        self.git('remote', 'add', 'origin', str(self.path / 'remote.git'))
        self.git('push', '-q', 'origin', 'refs/tags/v1.2.3')

    def run_command(self, *args, check=True):
        return subprocess.run(args, cwd=self.path, env=self.env, check=check,
                              capture_output=True, text=True)

    def git(self, *args):
        return self.run_command('git', *args)

    def gate(self):
        return self.run_command('bash', '-euo', 'pipefail', '-c', signing_step(), check=False)

    def test_trusted_signed_tag(self):
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.path / 'output').read_text(), 'version=1.2.3\n')

    def assert_rejected(self, message):
        result = self.gate()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)
        self.assertFalse((self.path / 'output').exists())

    def test_wrong_signer_despite_runner_trust(self):
        self.git('config', 'user.signingkey', str(self.path / 'other'))
        self.git('tag', '-sf', 'v1.2.3', '-m', 'wrong signer')
        other_trust = self.path / 'other-signers'
        other_trust.write_text('other namespaces="git" ' +
                               (self.path / 'other.pub').read_text())
        self.git('config', 'gpg.ssh.allowedSignersFile', str(other_trust))
        self.assert_rejected('No principal matched')

    def test_published_pin_does_not_select_release_source(self):
        (self.path / 'upstream.pin').write_text('signal=v1.2.2\n')
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.path / 'output').read_text(), 'version=1.2.3\n')
        self.assertEqual((self.path / 'upstream.pin').read_text(), 'signal=v1.2.2\n')

    def test_wrong_tag_commit(self):
        self.git('commit', '--allow-empty', '-qm', 'different build commit')
        self.assert_rejected('but the build uses')

    def test_wrong_dispatch_ref(self):
        self.env['GITHUB_REF'] = 'refs/heads/main'
        self.assert_rejected('Dispatch this workflow from')

    def test_replaced_remote_tag(self):
        self.git('tag', '-sf', 'v1.2.3', '-m', 'replacement signed tag')
        self.assert_rejected('does not match the verified local tag')

    def test_missing_remote_tag(self):
        self.git('push', '-q', 'origin', ':refs/tags/v1.2.3')
        result = self.gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.path / 'output').exists())

    def test_unsigned_annotated_tag(self):
        self.git('tag', '-af', 'v1.2.3', '-m', 'unsigned')
        self.assert_rejected('no signature found')

    def test_lightweight_tag(self):
        self.git('tag', '-d', 'v1.2.3')
        self.git('tag', 'v1.2.3')
        self.assert_rejected('expected tag type')

    def test_openpgp_tag_cannot_bypass_pinned_ssh_authority(self):
        # Git auto-detects signature formats: gpg.format=ssh alone is not a gate.
        self.env['GNUPGHOME'] = str(self.path / 'gnupg')
        Path(self.env['GNUPGHOME']).mkdir(mode=0o700)
        self.run_command('gpg', '--batch', '--passphrase', '', '--quick-generate-key',
                         'Test <release@example.invalid>', 'ed25519', 'sign', '0')
        self.git('config', 'gpg.format', 'openpgp')
        self.git('config', 'user.signingkey', 'release@example.invalid')
        self.git('tag', '-sf', 'v1.2.3', '-m', 'unapproved OpenPGP signer')
        self.git('push', '-q', '--force', 'origin', 'refs/tags/v1.2.3')
        result = self.gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.path / 'output').exists())

    def test_missing_pinned_trust(self):
        (self.path / '.github/release-signers').unlink()
        self.assert_rejected('No principal matched')


if __name__ == '__main__':
    unittest.main()
