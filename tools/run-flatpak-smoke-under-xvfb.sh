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

# Expand the final command's variables inside the Flatpak sandbox.
# shellcheck disable=SC2016
exec flatpak build \
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
