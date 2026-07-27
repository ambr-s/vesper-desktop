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

if [[ ! -e "$WORK/.git" ]]; then
  "$ROOT/tools/materialize.sh"
fi

"$ROOT/tools/verify-materialised.sh"

[[ -f "$WORK/.nvmrc" && -f "$WORK/package.json" ]] || {
  echo "Materialised checkout is missing .nvmrc or package.json." >&2
  exit 1
}

REQUIRED_NODE="$(tr -d '[:space:]' < "$WORK/.nvmrc")"
[[ "$REQUIRED_NODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Invalid Node version in work/.nvmrc: $REQUIRED_NODE" >&2
  exit 1
}

NVM_ROOT="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_ROOT/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$NVM_ROOT/nvm.sh"
  nvm install "$REQUIRED_NODE"
  nvm use "$REQUIRED_NODE"
else
  command -v node >/dev/null || {
    echo "Node $REQUIRED_NODE is required; install nvm or the exact Node version." >&2
    exit 1
  }
  CURRENT_NODE="$(node --version)"
  if [[ "$CURRENT_NODE" != "v$REQUIRED_NODE" ]]; then
    echo "Node v$REQUIRED_NODE is required; found $CURRENT_NODE." >&2
    exit 1
  fi
fi

command -v corepack >/dev/null || {
  echo "corepack is required by Signal Desktop's pinned Node toolchain." >&2
  exit 1
}
command -v xvfb-run >/dev/null || {
  echo "xvfb-run is required. On Ubuntu: sudo apt-get install xvfb libpulse0" >&2
  exit 1
}

corepack enable
export CI=true

cd "$WORK"

echo "Installing dependencies with the package manager pinned by Signal Desktop..."
NPM_CONFIG_LOGLEVEL=verbose \
NPM_CONFIG_NODE_GYP=echo \
  pnpm install --frozen-lockfile

echo "Checking generated Vesper icons..."
node "$ROOT/tools/generate-icons.mjs" --check

echo "Building workspace packages removed by clean rematerialisation..."
pnpm --filter @signalapp/types build
pnpm --filter @signalapp/windows-ucv build

echo "Generating application assets..."
pnpm run generate

echo "Checking Vesper and upstream source..."
pnpm run lint-prettier
pnpm run check:types
pnpm run oxlint
pnpm run lint-css
pnpm run test-lint-intl
pnpm run test-oxlint

echo "Running focused Vesper Electron tests..."
ELECTRON_DISABLE_SANDBOX=1 \
NODE_ENV=test \
NODE_OPTIONS='--import=tsx' \
LANG=en-us \
  ./node_modules/.bin/electron-mocha \
    --no-sandbox \
    --timeout 10000 \
    --extension ts,tsx,js,mjs \
    --file ts/test-node/setup.preload.ts \
    ts/test-node/app/menu_test.node.ts \
    ts/test-node/app/renderWindowsToast_test.std.tsx \
    ts/test-node/VesperConfig_test.dom.ts \
    ts/test-node/util/isVesperAuthor_test.dom.ts \
    ts/test-node/util/vesperDeleteForEveryone_test.std.ts \
    ts/test-node/util/vesperProtocol_test.std.ts

echo "Generating the Electron preload cache..."
ARTIFACTS_DIR=artifacts/linux \
  xvfb-run --auto-servernum pnpm run build:preload-cache

BUILD_MARKER="$(mktemp "${TMPDIR:-/tmp}/vesper-desktop-build.XXXXXXXX")"
cleanup() {
  rm -f -- "$BUILD_MARKER"
}
trap cleanup EXIT

echo "Building the Linux x64 Debian and AppImage packages..."
DISABLE_INSPECT_FUSE=on \
  pnpm run build:release --linux deb AppImage --x64 --publish=never

mapfile -t DEBIAN_PACKAGES < <(
  find release \
    -maxdepth 1 \
    -type f \
    -name '*.deb' \
    -newer "$BUILD_MARKER" \
    -print |
    sort
)

mapfile -t APPIMAGE_PACKAGES < <(
  find release \
    -maxdepth 1 \
    -type f \
    -name '*.AppImage' \
    -newer "$BUILD_MARKER" \
    -print |
    sort
)

if ((${#DEBIAN_PACKAGES[@]} != 1)); then
  printf 'Expected one new Debian package, found %s:\n' \
    "${#DEBIAN_PACKAGES[@]}" >&2
  find release -maxdepth 1 -type f -printf '  %p\n' | sort >&2
  exit 1
fi
if ((${#APPIMAGE_PACKAGES[@]} != 1)); then
  printf 'Expected one new AppImage package, found %s:\n' \
    "${#APPIMAGE_PACKAGES[@]}" >&2
  find release -maxdepth 1 -type f -printf '  %p\n' | sort >&2
  exit 1
fi

echo
echo "Local build completed:"
printf '  %s\n' "${DEBIAN_PACKAGES[0]}" "${APPIMAGE_PACKAGES[0]}"
sha256sum "${DEBIAN_PACKAGES[0]}" "${APPIMAGE_PACKAGES[0]}"
