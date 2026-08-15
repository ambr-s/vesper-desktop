#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"

[[ -d "$WORK/.git" ]] || {
  echo "No materialised work/ checkout; run ./tools/materialize.sh first." >&2
  exit 1
}

if [[ -n "$(git -C "$WORK" status --porcelain)" ]]; then
  echo "work/ has uncommitted changes; commit them before export." >&2
  exit 1
fi

TRANSFORM_COMMIT="$(
  git -C "$WORK" log --format=%H --grep='^Vesper transforms$' -n 1
)"
OVERLAY_COMMIT="$(
  git -C "$WORK" log --format=%H --grep='^Vesper owned overlays$' -n 1
)"
if [[ -z "$TRANSFORM_COMMIT" || -z "$OVERLAY_COMMIT" ]]; then
  echo "Expected transform and overlay materialization commits." >&2
  exit 1
fi

git -C "$WORK" merge-base --is-ancestor "$TRANSFORM_COMMIT" "$OVERLAY_COMMIT" || {
  echo "Overlay commit does not follow the transform commit." >&2
  exit 1
}
git -C "$WORK" merge-base --is-ancestor "$OVERLAY_COMMIT" HEAD || {
  echo "Overlay commit is not part of the current work/ branch." >&2
  exit 1
}

OVERLAY_EXCLUDES=()
while IFS= read -r -d '' overlay_file; do
  relative_path="${overlay_file#"$ROOT/overlay/"}"
  source_file="$WORK/$relative_path"
  [[ -f "$source_file" || -L "$source_file" ]] || {
    echo "Owned overlay is missing from work/: $relative_path" >&2
    exit 1
  }
  cp -a -- "$source_file" "$overlay_file"
  OVERLAY_EXCLUDES+=("$relative_path")
done < <(
  find "$ROOT/overlay" -mindepth 1 \
    \( -type f -o -type l \) \
    ! -name '.gitkeep' \
    -print0
)

mkdir -p "$ROOT/patches"

mapfile -t FEATURE_COMMITS < <(
  git -C "$WORK" rev-list --reverse "$OVERLAY_COMMIT..HEAD"
)
for commit in "${FEATURE_COMMITS[@]}"; do
  author="$(git -C "$WORK" show -s --format='%an <%ae>' "$commit")"
  signoffs="$(
    git -C "$WORK" show -s \
      --format='%(trailers:key=Signed-off-by,valueonly)' \
      "$commit"
  )"
  if ! grep -Fqx -- "$author" <<< "$signoffs"; then
    subject="$(git -C "$WORK" show -s --format=%s "$commit")"
    echo "Feature commit lacks its author's DCO sign-off: $subject" >&2
    echo "Amend it with: git commit --amend -s" >&2
    exit 1
  fi
done

EXPORT_ARGS=(
  --work "$WORK"
  --output "$ROOT/patches"
  --base "$OVERLAY_COMMIT"
)
for relative_path in "${OVERLAY_EXCLUDES[@]}"; do
  EXPORT_ARGS+=(--exclude "$relative_path")
done
python3 "$ROOT/tools/export_patches.py" "${EXPORT_ARGS[@]}"
