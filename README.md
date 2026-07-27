# Vesper Desktop

Vesper is an independent desktop client for the Signal service. This repository
contains a small set of Vesper changes, not a copy of Signal Desktop. The
materialisation tools apply those changes to the Signal release recorded in
`upstream.pin`.

Vesper uses its own application identity, storage and protocol handlers, so it can
be installed alongside Signal Desktop.

Production installers also register Signal's `sgnl` fallback scheme so
`signal.me` contact pages can hand links to Vesper. An operating system may show
an application chooser when Signal Desktop is installed because custom schemes
are registered as a whole. Vesper cannot claim verified ownership of the
`https://signal.me` domain without Signal publishing Vesper's signing identity.

Account configuration and captcha handoff pages are served by Vesper's
Cloudflare Worker at `https://vsp.asy.st`; the clients do not depend on
`signalcaptchas.org`.

## Supported releases

Release packaging currently targets Linux x64 as a Debian package, Flatpak and
self-updating AppImage. Linux arm64 is not yet a release target.

## Build on Linux x64

Install `xvfb` and `libpulse0`, then run:

```bash
./tools/build-local.sh
```

The script installs Signal Desktop's pinned Node and pnpm dependencies, runs the
checks, and builds Linux x64 Debian and AppImage packages in `work/release/`. It
prints both package paths and SHA-256 checksums when it finishes.

To build the Flatpak, install `flatpak-builder` through your package manager or
install its user-scoped Flatpak:

```bash
flatpak install --user flathub org.flatpak.Builder
./tools/build-flatpak.sh
./tools/test-flatpak.sh
```

The Flatpak build uses the verified Debian payload and writes
`artifacts/flatpak/vesper-desktop_<version>_x86_64.flatpak`. The test command
checks it as `systems.amber.Vesper` and runs two isolated smoke tests without
installing, replacing or stopping the user's app. Vesper stores its database
key through the desktop keyring and refuses Electron's plaintext password-store
backend.

## Install on Linux

To use the signed Debian repository:

```bash
curl -fsSL https://vspdb.asy.st/apt/vesper-archive-keyring.gpg |
  sudo tee /usr/share/keyrings/vesper-archive-keyring.gpg >/dev/null
curl -fsSL https://vspdb.asy.st/apt/vesper.sources |
  sudo tee /etc/apt/sources.list.d/vesper.sources >/dev/null
sudo apt update
sudo apt install vesper-desktop
```

To install the signed Flatpak release:

```bash
flatpak install --from https://vspdb.asy.st/flatpak/vesper.flatpakref
```

The AppImage and its checksum are attached to each GitHub release. Make it
executable and run it in place; AppImage installations use Vesper's independent
AppImage update key.

Source work belongs in the ignored `work/` checkout. Mechanical changes live in
`transforms/`, Vesper-owned files in `overlay/`, and source integration changes in
`patches/`. Commit and test a change in `work/`, then run `./tools/export.sh`.
Never edit a generated patch by hand. [MAINTAINING.md](MAINTAINING.md) covers the
full workflow.

## Licence and credits

Vesper's modifications are free software under the
[GNU Affero General Public License v3.0 only](LICENSE). Vesper is built from
[Signal Desktop](https://github.com/signalapp/Signal-Desktop), and parts of its
settings and appearance work draw on
[Molly](https://github.com/mollyim/mollyim-android). Their contributors keep
their copyright. [NOTICE](NOTICE) records the source history.

Signal and its associated marks belong to their respective owners. Vesper is not
affiliated with or endorsed by Signal Messenger.
