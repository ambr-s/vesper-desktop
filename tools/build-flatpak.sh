#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"
APP_ID="systems.amber.Vesper"
MANIFEST="$ROOT/flatpak/$APP_ID.yml"
ARTIFACT_ROOT="$ROOT/artifacts/flatpak"
SOURCE_DIR="$ARTIFACT_ROOT/source"
BUILD_DIR="$ARTIFACT_ROOT/build"
STATE_DIR="$ARTIFACT_ROOT/state"
REPO_DIR="$ARTIFACT_ROOT/repo"

if (($#)); then
  echo "Usage: $0" >&2
  exit 2
fi

[[ -d "$WORK/.git" ]] || {
  echo "Materialise Vesper before building the Flatpak." >&2
  exit 1
}
[[ -f "$MANIFEST" ]] || {
  echo "Missing Flatpak manifest: $MANIFEST" >&2
  exit 1
}
[[ -z "$(git -C "$WORK" status --porcelain)" ]] || {
  echo "work/ has uncommitted source changes." >&2
  exit 1
}

VERSION="$(node -p "require('$WORK/package.json').version")"
DEB="$WORK/release/vesper-desktop_${VERSION}_amd64.deb"
BUNDLE="$ARTIFACT_ROOT/vesper-desktop_${VERSION}_x86_64.flatpak"

[[ -f "$DEB" ]] || {
  echo "Missing $DEB; run ./tools/build-local.sh first." >&2
  exit 1
}

SOURCE_COMMIT_TIME="$(git -C "$WORK" show -s --format=%ct HEAD)"
PACKAGE_TIME="$(stat --format=%Y "$DEB")"
if ((PACKAGE_TIME < SOURCE_COMMIT_TIME)); then
  echo "$DEB predates the current source commit; rebuild it first." >&2
  exit 1
fi

reset_generated_directory() {
  local target="$1"
  local resolved

  resolved="$(realpath -m -- "$target")"
  [[ "$resolved" == "$ARTIFACT_ROOT"/* ]] || {
    echo "Refusing to clean unexpected Flatpak path: $target" >&2
    exit 1
  }
  if [[ -e "$resolved" ]]; then
    find "$resolved" -depth -delete
  fi
  mkdir -p -- "$resolved"
}

mkdir -p -- "$ARTIFACT_ROOT"
reset_generated_directory "$SOURCE_DIR"
reset_generated_directory "$BUILD_DIR"
reset_generated_directory "$STATE_DIR"
reset_generated_directory "$REPO_DIR"
find "$BUNDLE" -maxdepth 0 -type f -delete 2>/dev/null || true
cp --reflink=auto "$DEB" "$SOURCE_DIR/vesper-desktop.deb"

if ! flatpak remotes --user --columns=name | grep -Fxq flathub; then
  flatpak remote-add \
    --user \
    --if-not-exists \
    flathub \
    https://dl.flathub.org/repo/flathub.flatpakrepo
fi

if command -v flatpak-builder >/dev/null 2>&1; then
  BUILDER=(flatpak-builder)
elif flatpak info --user org.flatpak.Builder >/dev/null 2>&1; then
  BUILDER=(flatpak run org.flatpak.Builder)
else
  cat >&2 <<'EOF'
flatpak-builder is required. Install it through your package manager, or run:
  flatpak install --user flathub org.flatpak.Builder
EOF
  exit 1
fi

export SOURCE_DATE_EPOCH="$SOURCE_COMMIT_TIME"
"${BUILDER[@]}" \
  --force-clean \
  --user \
  --assumeyes \
  --install-deps-from=flathub \
  --default-branch=stable \
  --state-dir="$STATE_DIR" \
  --repo="$REPO_DIR" \
  "$BUILD_DIR" \
  "$MANIFEST"

flatpak build-bundle \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
  "$REPO_DIR" \
  "$BUNDLE" \
  "$APP_ID" \
  stable

flatpak build-update-repo --generate-static-deltas "$REPO_DIR"

echo
echo "Flatpak build completed:"
printf '  %s\n' "${BUNDLE#"$ROOT/"}"
sha256sum "$BUNDLE"
