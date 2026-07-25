# Vesper Desktop

Vesper is an independent desktop client for the Signal service. This repository
contains a small set of Vesper changes, not a copy of Signal Desktop. The
materialisation tools apply those changes to the Signal release recorded in
`upstream.pin`.

Vesper uses its own application identity, storage and protocol handlers, so it can
be installed alongside Signal Desktop.

## Build on Linux

Install `xvfb` and `libpulse0`, then run:

```bash
./tools/build-local.sh
```

The script installs Signal Desktop's pinned Node and pnpm dependencies, runs the
checks, and builds a Linux x64 Debian package in `work/release/`. It prints the
package path and SHA-256 checksum when it finishes.

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
