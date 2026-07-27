#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"
APP_ID="systems.amber.Vesper"
BUILD_DIR="$ROOT/artifacts/flatpak/build"
SMOKE_READY_TIMEOUT_SECONDS=180
SMOKE_RESTART_SECONDS=30

if (($#)); then
  echo "Usage: $0" >&2
  exit 2
fi

command -v flatpak >/dev/null || {
  echo "flatpak is required." >&2
  exit 1
}
command -v dbus-run-session >/dev/null || {
  echo "dbus-run-session is required. On Ubuntu: sudo apt-get install dbus-daemon" >&2
  exit 1
}
command -v gdbus >/dev/null || {
  echo "gdbus is required. On Ubuntu: sudo apt-get install libglib2.0-bin" >&2
  exit 1
}
command -v gnome-keyring-daemon >/dev/null || {
  echo "gnome-keyring-daemon is required. On Ubuntu: sudo apt-get install gnome-keyring" >&2
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
[[ -f "$BUILD_DIR/metadata" && -x "$BUILD_DIR/files/Vesper/vesper-desktop" ]] || {
  echo "Missing completed Flatpak build directory; rerun ./tools/build-flatpak.sh." >&2
  exit 1
}

# Expand these paths and variables inside the Flatpak sandbox.
# shellcheck disable=SC2016
flatpak build --readonly "$BUILD_DIR" sh -c '
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

strings "$BUILD_DIR/files/Vesper/vesper-desktop" |
  grep -F "Electron/$ELECTRON_VERSION" >/dev/null

if flatpak build \
  --readonly \
  --socket=session-bus \
  --env=VESPER_PASSWORD_STORE=basic \
  "$BUILD_DIR" \
  /app/bin/vesper-desktop \
  --version >/dev/null 2>&1; then
  echo "Flatpak unexpectedly accepted the plaintext password store." >&2
  exit 1
fi

SMOKE_ROOT_PARENT="$(
  mktemp -d "${TMPDIR:-/tmp}/vesper-flatpak-smoke-parent.XXXXXXXX"
)"
SMOKE_ROOT="$(mktemp -d "$SMOKE_ROOT_PARENT/vesper-flatpak-smoke.XXXXXXXX")"
SMOKE_LOG_FIRST="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-smoke-first.XXXXXXXX")"
SMOKE_LOG_SECOND="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-smoke-second.XXXXXXXX")"
PROBLEM_LOG="$(mktemp "${TMPDIR:-/tmp}/vesper-flatpak-problems.XXXXXXXX")"
DEFAULT_FLATPAK_USER_DIR="$(
  realpath -m \
    "${FLATPAK_USER_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/flatpak}"
)"
export FLATPAK_USER_DIR="$SMOKE_ROOT_PARENT/flatpak-user"
export FLATPAK_SYSTEM_DIR="$DEFAULT_FLATPAK_USER_DIR"
cleanup() {
  find \
    "$SMOKE_LOG_FIRST" \
    "$SMOKE_LOG_SECOND" \
    "$PROBLEM_LOG" \
    -maxdepth 0 \
    -type f \
    -delete
  find "$SMOKE_ROOT_PARENT" -depth -delete
}
trap cleanup EXIT

flatpak install \
  --user \
  --noninteractive \
  --no-deps \
  "$BUNDLE"
flatpak info --user "$APP_ID" >/dev/null

run_smoke() {
  local log_file="$1"
  local mode="$2"
  local smoke_seconds="$3"
  local smoke_status
  local hard_timeout_seconds=$((smoke_seconds + 30))

  set +e
  timeout --signal=TERM --kill-after=5s "${hard_timeout_seconds}s" \
    xvfb-run \
      --auto-servernum \
      --server-args='-screen 0 1280x720x24 -nolisten tcp -ac' \
      dbus-run-session -- \
        bash "$ROOT/tools/run-flatpak-smoke-under-xvfb.sh" \
        "$APP_ID" \
        "$SMOKE_ROOT" \
        "$mode" \
        "$smoke_seconds" >"$log_file" 2>&1
  smoke_status=$?
  set -e

  if [[ "$smoke_status" -ne 0 ]]; then
    printf 'Flatpak exited unexpectedly with status %s.\n' \
      "$smoke_status" >&2
    sed -n '1,260p' "$log_file" >&2
    exit 1
  fi
}

# The dollar expression belongs to the JavaScript template literal.
# shellcheck disable=SC2016
read_encrypted_key() {
  node -e '
    const config = require(process.argv[1]);
    const details = {
      safeStorageBackend: config.safeStorageBackend,
      encryptedKeyType: typeof config.encryptedKey,
      encryptedKeyLength:
        typeof config.encryptedKey === "string"
          ? config.encryptedKey.length
          : undefined,
      hasPlaintextKey: Object.hasOwn(config, "key"),
    };
    if (
      config.safeStorageBackend !== "gnome_libsecret" ||
      typeof config.encryptedKey !== "string" ||
      !/^[0-9a-f]+$/u.test(config.encryptedKey) ||
      Object.hasOwn(config, "key")
    ) {
      console.error(
        `Unexpected Flatpak database-key configuration: ${JSON.stringify(details)}`
      );
      process.exit(1);
    }
    process.stdout.write(config.encryptedKey);
  ' "$SMOKE_ROOT/Vesper/config.json"
}

run_smoke \
  "$SMOKE_LOG_FIRST" \
  await-config \
  "$SMOKE_READY_TIMEOUT_SECONDS"
ENCRYPTED_KEY_FIRST="$(read_encrypted_key)"
run_smoke \
  "$SMOKE_LOG_SECOND" \
  keep-alive \
  "$SMOKE_RESTART_SECONDS"
ENCRYPTED_KEY_SECOND="$(read_encrypted_key)"
if [[ "$ENCRYPTED_KEY_SECOND" != "$ENCRYPTED_KEY_FIRST" ]]; then
  echo "Flatpak database key changed between launches." >&2
  exit 1
fi

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

echo "Verified $APP_ID bundle contents with Electron $ELECTRON_VERSION."
echo "Verified encrypted gnome-libsecret storage with no plaintext SQL key."
echo "The Flatpak initialized and remained live after an encrypted restart."
