#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Exercise the real smoke monitor with a controlled config-writing child.

Only the Xvfb/Secret Service setup is omitted. The launch, polling, timeout,
early-exit handling and cleanup trap run verbatim from the production script.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parent
READY = {"encryptedKey": "ab" * 83, "safeStorageBackend": "gnome_libsecret"}


class FlatpakSmokeTests(unittest.TestCase):
    def run_monitor(self, initial, *, complete=False, mode="await-config", die=False):
        with tempfile.TemporaryDirectory(prefix="flatpak-monitor-") as tmp:
            root = Path(tmp)
            config = root / "Vesper/config.json"
            config.parent.mkdir()
            if initial is not None:
                config.write_text(initial)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            # The writer cannot publish the final backend until the monitor has
            # polled the intermediate config and slept. No timing guess is used.
            child = bin_dir / "flatpak"
            child.write_text("""#!/usr/bin/env python3
import json, os, pathlib, time
root = pathlib.Path(os.environ['TEST_ROOT'])
def stop_requested():
    if (root / 'stopped').exists():
        (root / 'exited').touch()
        raise SystemExit(0)
if os.environ['TEST_DIE'] == '1':
    (root / 'exited').touch()
    raise SystemExit(7)
if os.environ['TEST_COMPLETE'] == '1':
    while not (root / 'polled').exists():
        stop_requested()
        time.sleep(0.01)
    stop_requested()
    target = root / 'Vesper/config.json'
    staged = target.with_suffix('.new')
    staged.write_text(os.environ['TEST_READY'])
    staged.replace(target)
while True:
    stop_requested()
    time.sleep(0.01)
""")
            child.chmod(0o755)
            sleep = bin_dir / "sleep"
            sleep.write_text('#!/bin/sh\n[ "$1" != 0.25 ] || touch "$TEST_ROOT/polled"\nexec /bin/sleep "$@"\n')
            sleep.chmod(0o755)
            source = (TOOLS / "run-flatpak-smoke-under-xvfb.sh").read_text()
            monitor = root / "monitor.sh"
            monitor.write_text(
                '#!/usr/bin/env bash\nset -euo pipefail\n'
                # Some development sandboxes forbid even signalling own children.
                # Model signals cooperatively; leave the monitor/trap unchanged.
                'kill() { if [[ "$1" == -0 ]]; then '
                '[[ ! -f "$TEST_ROOT/exited" ]]; else '
                'touch "$TEST_ROOT/stopped"; fi; }\n'
                'APP_ID=test\nSMOKE_ROOT="$TEST_ROOT"\n'
                'SMOKE_ROOT_PARENT="$TEST_ROOT"\nMODE="$TEST_MODE"\n'
                'SMOKE_SECONDS=1\nAPP_PID=\n' + source.split('\nAPP_PID=\n', 1)[1]
            )
            env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}",
                       TEST_ROOT=str(root), TEST_MODE=mode,
                       TEST_COMPLETE=str(int(complete)), TEST_DIE=str(int(die)),
                       TEST_READY=json.dumps(READY))
            result = subprocess.run(["bash", str(monitor)], env=env,
                                    capture_output=True, text=True, timeout=10)
            final = config.read_text() if config.exists() else None
            return result, final

    def test_waits_for_backend_after_encrypted_key_write(self):
        result, final = self.run_monitor(json.dumps({"encryptedKey": READY["encryptedKey"]}), complete=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(final), READY, "monitor killed writer before backend was saved")

    def test_missing_and_partial_json_can_become_ready(self):
        for initial in (None, '{"encryptedKey":', '{}'):
            with self.subTest(initial=initial):
                result, final = self.run_monitor(initial, complete=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(final), READY)

    def test_incomplete_or_insecure_config_never_becomes_ready(self):
        cases = [None, '{', 'null', '{}',
                 json.dumps({"encryptedKey": READY["encryptedKey"]}),
                 json.dumps({**READY, "safeStorageBackend": "basic_text"}),
                 json.dumps({**READY, "safeStorageBackend": "kwallet6"}),
                 json.dumps({**READY, "encryptedKey": ""}),
                 json.dumps({**READY, "encryptedKey": "not-hex"}),
                 json.dumps({**READY, "encryptedKey": 123}),
                 json.dumps({**READY, "key": None})]
        for initial in cases:
            with self.subTest(initial=initial):
                result, _ = self.run_monitor(initial)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("did not persist", result.stderr)

    def test_early_process_exit_fails(self):
        result, _ = self.run_monitor(None, die=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exited early with status 7", result.stderr)

    def test_keep_alive_does_not_stop_on_ready_config(self):
        import time
        start = time.monotonic()
        result, final = self.run_monitor(json.dumps(READY), mode="keep-alive")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreaterEqual(time.monotonic() - start, 1)
        self.assertEqual(json.loads(final), READY)

    def test_keep_alive_rejects_early_exit(self):
        result, _ = self.run_monitor(json.dumps(READY), mode="keep-alive", die=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exited early with status 7", result.stderr)


if __name__ == "__main__":
    unittest.main()
