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
  test "$VESPER_PASSWORD_STORE" = gnome-libsecret
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

if flatpak run \
  --env=VESPER_PASSWORD_STORE=basic \
  "$APP_ID" \
  --version >/dev/null 2>&1; then
  echo "Flatpak unexpectedly accepted the plaintext password store." >&2
  exit 1
fi

SMOKE_ROOT_PARENT="$HOME/.var/app/$APP_ID/cache"
mkdir -p -- "$SMOKE_ROOT_PARENT"
SMOKE_ROOT="$(mktemp -d "$SMOKE_ROOT_PARENT/vesper-flatpak-smoke.XXXXXXXX")"
SMOKE_LOG_FIRST="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-smoke-first.XXXXXXXX")"
SMOKE_LOG_SECOND="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-smoke-second.XXXXXXXX")"
PROBLEM_LOG="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-problems.XXXXXXXX")"
cleanup() {
  find \
    "$SMOKE_LOG_FIRST" \
    "$SMOKE_LOG_SECOND" \
    "$PROBLEM_LOG" \
    -maxdepth 0 \
    -type f \
    -delete
  if flatpak ps --columns=application | grep -Fx "$APP_ID" >/dev/null; then
    flatpak kill "$APP_ID" 2>/dev/null || true
  fi
  find "$SMOKE_ROOT" -depth -delete
}
trap cleanup EXIT

run_smoke() {
  local log_file="$1"
  local smoke_status

  set +e
  timeout --signal=TERM --kill-after=5s 20s \
    xvfb-run --auto-servernum \
      flatpak run \
        --env=VESPER_DISABLE_GPU=1 \
        "$APP_ID" \
        "--user-data-dir=$SMOKE_ROOT/Vesper" \
        --start-in-tray >"$log_file" 2>&1
  smoke_status=$?
  set -e

  if [[ "$smoke_status" -ne 124 && "$smoke_status" -ne 137 ]]; then
    printf 'Flatpak exited unexpectedly with status %s.\n' \
      "$smoke_status" >&2
    sed -n '1,260p' "$log_file" >&2
    exit 1
  fi

  grep -Fq "userData: $SMOKE_ROOT/Vesper" "$log_file"
  if flatpak ps --columns=application | grep -Fx "$APP_ID" >/dev/null; then
    flatpak kill "$APP_ID" 2>/dev/null || true
  fi
}

run_smoke "$SMOKE_LOG_FIRST"

node -e '
  const config = require(process.argv[1]);
  if (
    config.safeStorageBackend !== "gnome_libsecret" ||
    typeof config.encryptedKey !== "string" ||
    !/^[0-9a-f]+$/u.test(config.encryptedKey) ||
    Object.hasOwn(config, "key")
  ) {
    process.exit(1);
  }
' "$SMOKE_ROOT/Vesper/config.json"

run_smoke "$SMOKE_LOG_SECOND"

grep -En \
  'Uncaught Exception|SyntaxError|TypeError:|ReferenceError:|FATAL:|database encryption key|SafeStorageDecryptionError' \
  "$SMOKE_LOG_FIRST" \
  "$SMOKE_LOG_SECOND" |
  grep -Ev \
    'FATAL:dbus/bus\.cc:1245.*D-Bus connection was disconnected' \
    >"$PROBLEM_LOG" || true
if [[ -s "$PROBLEM_LOG" ]]; then
  cat "$PROBLEM_LOG" >&2
  echo "Flatpak smoke log contains a fatal application error." >&2
  exit 1
fi

echo "Verified installed $APP_ID with Electron $ELECTRON_VERSION."
echo "Verified encrypted gnome-libsecret storage with no plaintext SQL key."
echo "The Flatpak remained live across two 20-second smoke tests."
