#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

declare -a extra_args=()
declare -i disable_gpu="${VESPER_DISABLE_GPU:-0}"
declare -i disable_gpu_sandbox="${VESPER_DISABLE_GPU_SANDBOX:-0}"
declare -r password_store="${VESPER_PASSWORD_STORE:-gnome-libsecret}"

case "$password_store" in
  gnome-libsecret | kwallet | kwallet5 | kwallet6)
    extra_args+=("--password-store=$password_store")
    ;;
  *)
    printf 'Vesper requires an encrypted password store; unsupported value: %s\n' \
      "$password_store" >&2
    exit 1
    ;;
esac

if ((disable_gpu)); then
  extra_args+=(--disable-gpu)
fi
if ((disable_gpu_sandbox)); then
  extra_args+=(--disable-gpu-sandbox)
fi

export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
mkdir -p "$TMPDIR"

exec zypak-wrapper \
  /app/Vesper/vesper-desktop \
  "${extra_args[@]}" \
  "$@"
