#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/work"
ARTIFACT_ROOT="$ROOT/artifacts"
APT_ROOT="$ARTIFACT_ROOT/apt"
FLATPAK_ROOT="$ARTIFACT_ROOT/flatpak"
FLATPAK_REPO="$FLATPAK_ROOT/repo"
APP_ID="systems.amber.Vesper"
FLATPAK_BRANCH="stable"

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 DEBIAN_PACKAGE GPG_HOME GPG_KEY_FINGERPRINT" >&2
  exit 2
fi

DEBIAN_PACKAGE="$(realpath -- "$1")"
GPG_HOME="$(realpath -- "$2")"
GPG_KEY_FINGERPRINT="${3^^}"

for command in apt-ftparchive base64 dpkg-deb flatpak gpg gzip; do
  command -v "$command" >/dev/null || {
    echo "$command is required to prepare the Linux repositories." >&2
    exit 1
  }
done

[[ -f "$DEBIAN_PACKAGE" ]] || {
  echo "Missing Debian package: $DEBIAN_PACKAGE" >&2
  exit 1
}
[[ -d "$GPG_HOME" ]] || {
  echo "Missing GPG home: $GPG_HOME" >&2
  exit 1
}
[[ "$GPG_KEY_FINGERPRINT" =~ ^[0-9A-F]{40,64}$ ]] || {
  echo "GPG key fingerprint must be 40 to 64 hexadecimal characters." >&2
  exit 1
}
[[ -d "$FLATPAK_REPO" ]] || {
  echo "Missing Flatpak repository; run ./tools/build-flatpak.sh first." >&2
  exit 1
}
gpg \
  --batch \
  --homedir "$GPG_HOME" \
  --list-secret-keys "$GPG_KEY_FINGERPRINT" >/dev/null

PACKAGE_NAME="$(dpkg-deb --field "$DEBIAN_PACKAGE" Package)"
PACKAGE_VERSION="$(dpkg-deb --field "$DEBIAN_PACKAGE" Version)"
PACKAGE_ARCH="$(dpkg-deb --field "$DEBIAN_PACKAGE" Architecture)"
[[ "$PACKAGE_NAME" == "vesper-desktop" ]] || {
  echo "Unexpected Debian package name: $PACKAGE_NAME" >&2
  exit 1
}
[[ "$PACKAGE_ARCH" == "amd64" ]] || {
  echo "Unexpected Debian package architecture: $PACKAGE_ARCH" >&2
  exit 1
}
[[ "$PACKAGE_VERSION" =~ ^[0-9A-Za-z.+:~-]+$ ]] || {
  echo "Unexpected Debian package version: $PACKAGE_VERSION" >&2
  exit 1
}

reset_generated_directory() {
  local target="$1"
  local resolved

  resolved="$(realpath -m -- "$target")"
  [[ "$resolved" == "$ARTIFACT_ROOT"/* ]] || {
    echo "Refusing to clean unexpected repository path: $target" >&2
    exit 1
  }
  if [[ -e "$resolved" ]]; then
    find "$resolved" -depth -delete
  fi
  mkdir -p -- "$resolved"
}

reset_generated_directory "$APT_ROOT"

POOL_DIR="$APT_ROOT/pool/main/v/$PACKAGE_NAME"
PACKAGES_DIR="$APT_ROOT/dists/stable/main/binary-amd64"
mkdir -p -- "$POOL_DIR" "$PACKAGES_DIR"
cp -- "$DEBIAN_PACKAGE" "$POOL_DIR/$(basename -- "$DEBIAN_PACKAGE")"

(
  cd "$APT_ROOT"
  apt-ftparchive packages pool > dists/stable/main/binary-amd64/Packages
  gzip \
    --no-name \
    --best \
    --stdout \
    dists/stable/main/binary-amd64/Packages \
    > dists/stable/main/binary-amd64/Packages.gz
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Vesper \
    -o APT::FTPArchive::Release::Label=Vesper \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    -o APT::FTPArchive::Release::Components=main \
    -o APT::FTPArchive::Release::Description="Vesper Desktop packages" \
    release dists/stable \
    > dists/stable/Release
)

GPG_OPTIONS=(
  --batch
  --yes
  --homedir "$GPG_HOME"
  --local-user "$GPG_KEY_FINGERPRINT"
)
gpg \
  "${GPG_OPTIONS[@]}" \
  --armor \
  --detach-sign \
  --output "$APT_ROOT/dists/stable/Release.gpg" \
  "$APT_ROOT/dists/stable/Release"
gpg \
  "${GPG_OPTIONS[@]}" \
  --armor \
  --clearsign \
  --output "$APT_ROOT/dists/stable/InRelease" \
  "$APT_ROOT/dists/stable/Release"

PUBLIC_KEY="$APT_ROOT/vesper-archive-keyring.gpg"
PUBLIC_KEY_ASC="$APT_ROOT/vesper-archive-keyring.asc"
gpg \
  --batch \
  --homedir "$GPG_HOME" \
  --export "$GPG_KEY_FINGERPRINT" > "$PUBLIC_KEY"
gpg \
  --batch \
  --homedir "$GPG_HOME" \
  --armor \
  --export "$GPG_KEY_FINGERPRINT" > "$PUBLIC_KEY_ASC"

{
  printf 'Types: deb\n'
  printf 'URIs: https://vspdb.asy.st/apt\n'
  printf 'Suites: stable\n'
  printf 'Components: main\n'
  printf 'Architectures: amd64\n'
  printf 'Signed-By: /usr/share/keyrings/vesper-archive-keyring.gpg\n'
} > "$APT_ROOT/vesper.sources"

flatpak build-sign \
  --gpg-sign="$GPG_KEY_FINGERPRINT" \
  --gpg-homedir="$GPG_HOME" \
  "$FLATPAK_REPO" \
  "$APP_ID" \
  "$FLATPAK_BRANCH"
flatpak build-update-repo \
  --title=Vesper \
  --comment="Private Signal messaging with Vesper privacy controls" \
  --description="The official Vesper Desktop Flatpak repository." \
  --homepage=https://github.com/ambr-s/vesper-desktop \
  --default-branch="$FLATPAK_BRANCH" \
  --generate-static-deltas \
  --gpg-sign="$GPG_KEY_FINGERPRINT" \
  --gpg-homedir="$GPG_HOME" \
  "$FLATPAK_REPO"

VERSION="$(node -p "require('$WORK/package.json').version")"
FLATPAK_BUNDLE="$FLATPAK_ROOT/vesper-desktop_${VERSION}_x86_64.flatpak"
find "$FLATPAK_BUNDLE" -maxdepth 0 -type f -delete 2>/dev/null || true
flatpak build-bundle \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo \
  --gpg-keys="$PUBLIC_KEY" \
  "$FLATPAK_REPO" \
  "$FLATPAK_BUNDLE" \
  "$APP_ID" \
  "$FLATPAK_BRANCH"

GPG_KEY_BASE64="$(base64 --wrap=0 "$PUBLIC_KEY")"
{
  printf '[Flatpak Repo]\n'
  printf 'Title=Vesper\n'
  printf 'Comment=Official Vesper Desktop releases\n'
  printf 'Description=Private Signal messaging with Vesper privacy controls\n'
  printf 'Url=https://vspdb.asy.st/flatpak/repo\n'
  printf 'Homepage=https://github.com/ambr-s/vesper-desktop\n'
  printf 'GPGKey=%s\n' "$GPG_KEY_BASE64"
} > "$FLATPAK_ROOT/vesper.flatpakrepo"
{
  printf '[Flatpak Ref]\n'
  printf 'Name=%s\n' "$APP_ID"
  printf 'Branch=%s\n' "$FLATPAK_BRANCH"
  printf 'Title=Vesper\n'
  printf 'IsRuntime=false\n'
  printf 'Url=https://vspdb.asy.st/flatpak/repo\n'
  printf 'RuntimeRepo=https://flathub.org/repo/flathub.flatpakrepo\n'
  printf 'GPGKey=%s\n' "$GPG_KEY_BASE64"
} > "$FLATPAK_ROOT/vesper.flatpakref"

gpg \
  --batch \
  --homedir "$GPG_HOME" \
  --verify \
  "$APT_ROOT/dists/stable/Release.gpg" \
  "$APT_ROOT/dists/stable/Release"
gpg \
  --batch \
  --homedir "$GPG_HOME" \
  --verify "$APT_ROOT/dists/stable/InRelease"

VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/vesper-flatpak-repo.XXXXXXXX")"
cleanup() {
  find "$VERIFY_ROOT" -depth -delete
}
trap cleanup EXIT
mkdir -p \
  "$VERIFY_ROOT/data" \
  "$VERIFY_ROOT/config" \
  "$VERIFY_ROOT/cache"
XDG_DATA_HOME="$VERIFY_ROOT/data" \
XDG_CONFIG_HOME="$VERIFY_ROOT/config" \
XDG_CACHE_HOME="$VERIFY_ROOT/cache" \
  flatpak remote-add \
    --user \
    --gpg-import="$PUBLIC_KEY" \
    vesper-release-verify \
    "file://$FLATPAK_REPO"
XDG_DATA_HOME="$VERIFY_ROOT/data" \
XDG_CONFIG_HOME="$VERIFY_ROOT/config" \
XDG_CACHE_HOME="$VERIFY_ROOT/cache" \
  flatpak remote-ls \
    --user \
    --columns=application,branch \
    vesper-release-verify |
  grep -Fx "$APP_ID	$FLATPAK_BRANCH" >/dev/null

echo
echo "Signed Linux repositories prepared:"
printf '  APT: %s\n' "${APT_ROOT#"$ROOT/"}"
printf '  Flatpak: %s\n' "${FLATPAK_ROOT#"$ROOT/"}"
