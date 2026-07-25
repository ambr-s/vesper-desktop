#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

show_encryption_warning() {
  local message
  read -r -d '|' message <<'EOF' || true
Vesper uses the <b>plaintext password store</b> by default in Flatpak because
encrypted backends can corrupt the local database on some systems. Your local
database key will not be protected by the desktop keyring.

To try an encrypted backend, set <tt>VESPER_PASSWORD_STORE</tt> to
<tt>gnome-libsecret</tt>, <tt>kwallet</tt>, <tt>kwallet5</tt> or
<tt>kwallet6</tt> with Flatseal or this command:

<tt>flatpak override --user --env=VESPER_PASSWORD_STORE=gnome-libsecret systems.amber.Vesper</tt>

Encrypted backends remain experimental and may cause data loss.

Choose Yes to continue with the plaintext store or No to exit. |
EOF

  if ! zenity \
    --question \
    --no-wrap \
    --default-cancel \
    --icon-name=dialog-warning \
    --title "Vesper password store" \
    --text "$message"; then
    printf 'Vesper was not started because the password-store warning was declined.\n'
    exit 1
  fi
}

declare -a extra_args=()
declare -i disable_gpu="${VESPER_DISABLE_GPU:-0}"
declare -i disable_gpu_sandbox="${VESPER_DISABLE_GPU_SANDBOX:-0}"
declare -r password_store="${VESPER_PASSWORD_STORE:-basic}"

case "$password_store" in
  basic | gnome-libsecret | kwallet | kwallet5 | kwallet6)
    extra_args+=("--password-store=$password_store")
    ;;
  *)
    printf 'VESPER_PASSWORD_STORE has an unsupported value: %s\n' \
      "$password_store" >&2
    exit 1
    ;;
esac

if [[ "$password_store" == basic &&
  ! -f "$XDG_CONFIG_HOME/Vesper/config.json" ]]; then
  show_encryption_warning
fi

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
