#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"
APP_ID="systems.amber.Vesper"

if (($#)); then
  echo "Usage: $0" >&2
  exit 2
fi

command -v flatpak >/dev/null || {
  echo "flatpak is required." >&2
  exit 1
}
command -v strings >/dev/null || {
  echo "strings is required." >&2
  exit 1
}
command -v xvfb-run >/dev/null || {
  echo "xvfb-run is required. On Ubuntu: sudo apt-get install xvfb" >&2
  exit 1
}

VERSION="$(node -p "require('$WORK/package.json').version")"
ELECTRON_VERSION="$(
  node -p "require('$WORK/package.json').devDependencies.electron"
)"
BUNDLE="$ROOT/artifacts/flatpak/vesper-desktop_${VERSION}_x86_64.flatpak"

[[ -f "$BUNDLE" ]] || {
  echo "Missing $BUNDLE; run ./tools/build-flatpak.sh first." >&2
  exit 1
}

if flatpak info --user "$APP_ID" >/dev/null 2>&1; then
  if flatpak ps --columns=application | grep -Fx "$APP_ID" >/dev/null; then
    flatpak kill "$APP_ID" 2>/dev/null || true
  fi
  flatpak uninstall --user --noninteractive "$APP_ID"
fi
flatpak install --user --noninteractive "$BUNDLE"

# Expand these paths and variables inside the Flatpak sandbox.
# shellcheck disable=SC2016
flatpak run --command=sh "$APP_ID" -c '
  set -eu
  test "$(cat /app/Vesper/resources/package-type)" = flatpak
  test -x /app/Vesper/vesper-desktop
  test -x /app/bin/vesper-desktop
  test -f /app/Vesper/.vesper-postinst
  desktop=/app/share/applications/systems.amber.Vesper.desktop
  test -f "$desktop"
  grep -q "^Name=Vesper$" "$desktop"
  grep -q "^Exec=vesper-desktop %U$" "$desktop"
  grep -q "^Icon=systems.amber.Vesper$" "$desktop"
  grep -q "x-scheme-handler/vesper" "$desktop"
  grep -q "x-scheme-handler/vespercaptcha" "$desktop"
'

INSTALLATION="$(flatpak info --user --show-location "$APP_ID")"
strings "$INSTALLATION/files/Vesper/vesper-desktop" |
  grep -F "Electron/$ELECTRON_VERSION" >/dev/null

SMOKE_LOG="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-smoke.XXXXXXXX")"
PROBLEM_LOG="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-problems.XXXXXXXX")"
cleanup() {
  find "$SMOKE_LOG" "$PROBLEM_LOG" -maxdepth 0 -type f -delete
  if flatpak ps --columns=application | grep -Fx "$APP_ID" >/dev/null; then
    flatpak kill "$APP_ID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

set +e
timeout --signal=TERM --kill-after=5s 20s \
  xvfb-run --auto-servernum \
    flatpak run \
      --env=VESPER_PASSWORD_STORE=kwallet6 \
      --env=VESPER_DISABLE_GPU=1 \
      "$APP_ID" \
      --user-data-dir=/tmp/vesper-flatpak-smoke/Vesper \
      --start-in-tray >"$SMOKE_LOG" 2>&1
SMOKE_STATUS=$?
set -e

if [[ "$SMOKE_STATUS" -ne 124 && "$SMOKE_STATUS" -ne 137 ]]; then
  printf 'Flatpak exited unexpectedly with status %s.\n' "$SMOKE_STATUS" >&2
  sed -n '1,260p' "$SMOKE_LOG" >&2
  exit 1
fi

grep -Fq \
  "userData: /tmp/vesper-flatpak-smoke/Vesper" \
  "$SMOKE_LOG"
grep -En \
  'Uncaught Exception|SyntaxError|TypeError:|ReferenceError:|FATAL:' \
  "$SMOKE_LOG" |
  grep -Ev \
    'FATAL:dbus/bus\.cc:1245.*D-Bus connection was disconnected' \
    >"$PROBLEM_LOG" || true
if [[ -s "$PROBLEM_LOG" ]]; then
  cat "$PROBLEM_LOG" >&2
  echo "Flatpak smoke log contains a fatal application error." >&2
  exit 1
fi

echo "Verified installed $APP_ID with Electron $ELECTRON_VERSION."
echo "The Flatpak remained live for the 20-second smoke test."
