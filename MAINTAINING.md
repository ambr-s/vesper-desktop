# Maintaining Vesper Desktop

## Patch workflow

`upstream.pin` names the Signal Desktop release that has passed Vesper's full
gate. `tools/materialize.sh` clones that tag, applies `transforms/`, copies
`overlay/`, and replays `patches/`. The generated marker commits are unsigned;
every Vesper feature commit must be GPG-signed.

For a source change:

1. Materialise the current pin with `./tools/materialize.sh`.
2. Work and commit in `work/`.
3. Run focused checks, then `./tools/build-local.sh`.
4. Run `./tools/export.sh`.
5. Review every generated patch.
6. Rematerialise from a clean checkout and rerun the full gate.

`tools/bump.sh vX.Y.Z` prepares a candidate upstream release without changing
the pin. Advance the pin only after resolving patch conflicts and passing the
same checks.

## Android parity

The sibling `../vesper-android` project is the behavioural reference.

| Android behaviour                       | Desktop status               | Desktop treatment                                                                                 |
| --------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Vesper product identity and branding    | Implemented                  | Own package name, application ID, executable, desktop entry, storage, icons and protocol handlers |
| Production and development coexistence  | Implemented                  | Development Vesper has separate package, application ID, executable, desktop entry and protocols  |
| Light, dark and system appearance       | Implemented                  | Existing Desktop theme modes use Vesper's static palette                                          |
| Optional diagnostic logging             | Implemented                  | Off by default; disabling asks for confirmation and clears local logs and crash reports           |
| Preserve remote deletion requests       | Implemented                  | Off by default; applies only to ordinary incoming messages and adds a local marker                |
| Vesper settings and help                | Implemented                  | Public Vesper settings, Vesper About content and internal settings after seven version clicks     |
| Independent update channel              | Implemented, release-blocked | Desktop-only host and signing keys; R2 credentials are still required for publication             |
| Flatpak package                         | Implemented                  | Flatpak ID `systems.amber.Vesper`, 25.08 runtime, local install audit and 20-second smoke test    |
| Android resource qualifiers             | Not applicable               | Android resource-selection mechanism                                                              |
| APK variants and Firebase configuration | Not applicable               | Android packaging only                                                                            |
| MobileCoin 16 KB compatibility          | Not applicable               | Android native-library constraint                                                                 |
| Direct Material You APIs                | Not applicable               | Desktop keeps its native light, dark and system theme model                                       |

## Release

The manual release workflow builds Linux x64 on a Blacksmith Ubuntu 24.04
runner. It accepts only a signed, remote release tag, runs the complete local
gate, verifies Vesper identity, signs the Debian update, builds and tests the
Flatpak, and creates a draft GitHub release. Publication uses a Desktop-only R2
bucket and never reuses Android credentials.

The release environment needs these GitHub Actions secrets:

- `VESPER_DESKTOP_UPDATE_PRIVATE_KEY`
- `VESPER_DESKTOP_R2_ACCOUNT_ID`
- `VESPER_DESKTOP_R2_ACCESS_KEY_ID`
- `VESPER_DESKTOP_R2_SECRET_ACCESS_KEY`

The updater and AppImage public keys belong in `branding/vesper.env`. Their
private counterparts are generated locally under `.secrets/` by:

```bash
node tools/generate-update-keys.mjs
```

The command refuses to replace existing keys. Keep
`.secrets/vesper-desktop-update.key` and
`.secrets/vesper-desktop-appimage-update.key` offline except when copying them
into the matching release secret through an approved secret channel.
`node tools/verify-identity.mjs --release work` rejects missing, malformed or
placeholder public keys.

## Flatpak

`tools/build-flatpak.sh` packages the current Debian build with the
`org.freedesktop.Platform` 25.08 runtime and Electron2 BaseApp. It refuses a
Debian package older than the current source commit. `tools/test-flatpak.sh`
installs the bundle for the current user, checks its desktop and protocol
identity, and confirms the Electron version. It then starts Vesper twice with
temporary application data. The launcher defaults to `gnome-libsecret` and
rejects Electron's plaintext password store. The test checks that the SQLCipher
key is encrypted in `config.json`, that no plaintext `key` field exists, and
that the same profile opens on the second run.

The Flatpak application remains AGPL-3.0-only. Its AppStream metadata is
CC0-1.0 so software catalogues may copy and index it.

The expected public routes under `https://vspdb.asy.st` are:

- `/desktop/latest-linux.yml`
- `/desktop/<package>`
- `/desktop/<package>.sig`
- `/captcha/challenge/generate.html`
- `/captcha/registration/generate.html`
- `/captcha/vesper-captcha.js`

Do not publish from a local checkout. Do not push a tag until its exact outer
commit and the release inputs have been reviewed.
