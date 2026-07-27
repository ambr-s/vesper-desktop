#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

if (($# != 2)); then
  echo "Usage: $0 BUILD_DIR SMOKE_ROOT" >&2
  exit 2
fi

BUILD_DIR="$1"
SMOKE_ROOT="$2"
SMOKE_ROOT_PARENT="$(dirname -- "$SMOKE_ROOT")"

[[ "${DISPLAY:-}" =~ ^:[0-9]+$ ]] || {
  echo "Expected an Xvfb DISPLAY; found ${DISPLAY:-unset}." >&2
  exit 1
}
[[ -S "/tmp/.X11-unix/X${DISPLAY#:}" ]] || {
  echo "Xvfb socket is missing for $DISPLAY." >&2
  exit 1
}

KEYRING_ROOT="$(
  mktemp -d "$SMOKE_ROOT_PARENT/vesper-keyring.XXXXXXXX"
)"
KEYRING_CONTROL="$KEYRING_ROOT/control"
KEYRING_DATA="$KEYRING_ROOT/data"
KEYRING_LOGIN_LOG="$KEYRING_ROOT/login.log"
KEYRING_START_LOG="$KEYRING_ROOT/start.log"
mkdir -m 700 "$KEYRING_CONTROL" "$KEYRING_DATA"
unset GNOME_KEYRING_CONTROL SSH_AUTH_SOCK
printf '\n' |
  XDG_DATA_HOME="$KEYRING_DATA" \
    gnome-keyring-daemon \
      --login \
      --components=secrets \
      --control-directory="$KEYRING_CONTROL" >"$KEYRING_LOGIN_LOG" 2>&1
GNOME_KEYRING_CONTROL="$KEYRING_CONTROL" \
XDG_DATA_HOME="$KEYRING_DATA" \
  gnome-keyring-daemon \
    --start \
    --components=secrets \
    >"$KEYRING_START_LOG" 2>&1

KEYRING_READY=false
for _ in {1..50}; do
  KEYRING_HAS_OWNER="$(
    gdbus call \
      --session \
      --dest org.freedesktop.DBus \
      --object-path /org/freedesktop/DBus \
      --method org.freedesktop.DBus.NameHasOwner \
      org.freedesktop.secrets
  )"
  if [[ "$KEYRING_HAS_OWNER" == "(true,)" ]]; then
    KEYRING_READY=true
    break
  fi
  sleep 0.1
done
if [[ "$KEYRING_READY" != true ]]; then
  cat "$KEYRING_LOGIN_LOG" "$KEYRING_START_LOG" >&2
  echo "Temporary Secret Service did not start." >&2
  exit 1
fi
KEYRING_DEFAULT_ALIAS="$(
  gdbus call \
    --session \
    --dest org.freedesktop.secrets \
    --object-path /org/freedesktop/secrets \
    --method org.freedesktop.Secret.Service.ReadAlias \
    default
)"
if [[ "$KEYRING_DEFAULT_ALIAS" == "(objectpath '/',)" ]]; then
  cat "$KEYRING_LOGIN_LOG" "$KEYRING_START_LOG" >&2
  echo "Temporary Secret Service has no default collection." >&2
  exit 1
fi

# Expand the final command's variables inside the Flatpak sandbox.
# shellcheck disable=SC2016
flatpak build \
  --die-with-parent \
  --readonly \
  --share=ipc \
  --share=network \
  --socket=session-bus \
  --bind-mount=/tmp/.X11-unix=/tmp/.X11-unix \
  --filesystem="$SMOKE_ROOT_PARENT" \
  --env="VESPER_TEST_DISPLAY=$DISPLAY" \
  --env=VESPER_DISABLE_GPU=1 \
  "$BUILD_DIR" \
  sh -c '
    export DISPLAY="$VESPER_TEST_DISPLAY"
    exec /app/bin/vesper-desktop "$@"
  ' \
  sh \
  "--user-data-dir=$SMOKE_ROOT/Vesper" \
  --start-in-tray
