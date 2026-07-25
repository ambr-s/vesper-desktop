#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"

if (($#)); then
  echo "Usage: $0" >&2
  exit 2
fi

[[ -e "$WORK/.git" ]] || {
  echo "No materialised work/ checkout; run ./tools/materialize.sh first." >&2
  exit 1
}

[[ -z "$(git -C "$WORK" status --porcelain)" ]] || {
  echo "The materialised worktree is not clean." >&2
  git -C "$WORK" status --short >&2
  exit 1
}

TRANSFORM_COMMIT="$(
  git -C "$WORK" log --format=%H --grep='^Vesper transforms$' -n 1
)"
OVERLAY_COMMIT="$(
  git -C "$WORK" log --format=%H --grep='^Vesper owned overlays$' -n 1
)"
[[ -n "$TRANSFORM_COMMIT" && -n "$OVERLAY_COMMIT" ]] || {
  echo "Materialisation boundary commits are missing." >&2
  exit 1
}
git -C "$WORK" merge-base --is-ancestor "$TRANSFORM_COMMIT" "$OVERLAY_COMMIT"
git -C "$WORK" merge-base --is-ancestor "$OVERLAY_COMMIT" HEAD

mapfile -t PATCHES < <(
  find "$ROOT/patches" -maxdepth 1 -type f -name '*.patch' -print | sort
)
mapfile -t FEATURE_COMMITS < <(
  git -C "$WORK" rev-list --reverse "$OVERLAY_COMMIT..HEAD"
)
if ((${#PATCHES[@]} != ${#FEATURE_COMMITS[@]})); then
  printf 'Expected %s replayed feature commits, found %s.\n' \
    "${#PATCHES[@]}" "${#FEATURE_COMMITS[@]}" >&2
  exit 1
fi

while IFS= read -r -d '' overlay_file; do
  relative_path="${overlay_file#"$ROOT/overlay/"}"
  cmp --silent "$overlay_file" "$WORK/$relative_path" || {
    echo "Owned overlay differs in work/: $relative_path" >&2
    exit 1
  }
done < <(
  find "$ROOT/overlay" -mindepth 1 \
    \( -type f -o -type l \) \
    ! -name '.gitkeep' \
    -print0
)

node "$ROOT/tools/verify-identity.mjs" "$WORK"
echo "Verified clean materialisation with ${#FEATURE_COMMITS[@]} feature patches."
