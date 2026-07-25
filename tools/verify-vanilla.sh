#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [vX.Y.Z]" >&2
  exit 2
fi

[[ -d "$WORK/.git" ]] || {
  echo "No materialised work/ checkout; run ./tools/materialize.sh first." >&2
  exit 1
}

PIN_LINE="$(<"$ROOT/upstream.pin")"
[[ "$PIN_LINE" =~ ^signal=(v[0-9]+\.[0-9]+\.[0-9]+)$ ]] || {
  echo "Invalid upstream.pin: expected signal=vX.Y.Z" >&2
  exit 1
}
PINNED_TAG="${BASH_REMATCH[1]}"
TAG="${1:-$PINNED_TAG}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Invalid Signal tag: $TAG" >&2
  exit 1
}

git -C "$WORK" rev-parse --verify --quiet "$TAG^{commit}" >/dev/null || {
  echo "Materialised checkout does not contain $TAG." >&2
  exit 1
}

if ! git -C "$WORK" diff --quiet "$TAG^{tree}" "HEAD^{tree}"; then
  echo "Materialised source differs from vanilla Signal Desktop $TAG:" >&2
  git -C "$WORK" diff --stat "$TAG^{tree}" "HEAD^{tree}" >&2
  exit 1
fi

echo "Materialised source tree is identical to Signal Desktop $TAG."
