# Maintaining Vesper Desktop

## Patch workflow

`upstream.pin` names the Signal Desktop release that has passed Vesper's full
gate. `tools/materialize.sh` clones that tag, applies `transforms/`, copies
`overlay/`, and replays `patches/`. Marker and replayed commits are necessarily
unsigned because Git patches do not preserve commit-object signatures.
Authoring commits must be GPG-signed before their first export and carry the
author's DCO sign-off, which is preserved in the patch. `tools/export.sh`
rejects feature commits without that sign-off.

For a source change:

1. Materialise the current pin with `./tools/materialize.sh`.
2. Work in `work/`, then commit with `git commit -S -s`.
3. Run focused checks, then `./tools/build-local.sh`.
4. Run `./tools/export.sh`.
5. Review every generated patch.
6. Rematerialise from a clean checkout and rerun the full gate.

`tools/bump.sh vX.Y.Z` prepares a candidate upstream release without changing
the pin. Advance the pin only after resolving patch conflicts and passing the
same checks.

## Android parity

The sibling `../vesper-android` project is the behavioural reference.

| Android behaviour                       | Desktop status | Desktop treatment                                                                                       |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| Vesper product identity and branding    | Implemented    | Own package name, application ID, executable, desktop entry, storage, icons and protocol handlers       |
| Production and development coexistence  | Implemented    | Development Vesper has separate package, application ID, executable, desktop entry and protocols        |
| `signal.me` contact links               | Implemented    | Production claims the shared `sgnl` fallback scheme; verified HTTPS ownership remains controlled by Signal |
| Light, dark and system appearance       | Implemented    | Existing Desktop theme modes use Vesper's static palette                                                |
| Optional diagnostic logging             | Implemented    | Off by default; disabling asks for confirmation and clears local logs and crash reports                 |
| Preserve remote deletion requests       | Implemented    | Off by default; applies only to ordinary incoming messages and adds a local marker                      |
| Vesper settings and help                | Implemented    | Public Vesper settings, Vesper About content and internal settings after seven version clicks           |
| Independent update channel              | Implemented    | Desktop-only R2 host, Linux manifest and separate normal/AppImage updater signing keys                   |
| Debian repository                       | Implemented    | Signed `stable/main` APT repository with a scoped deb822 source and dedicated archive key               |
| Flatpak package and repository          | Implemented    | Signed repo and bundle for `systems.amber.Vesper`, 25.08 runtime, bundle audit and isolated smoke tests |
| AppImage package                        | Implemented    | Linux x64 package, blockmap, separate updater signature and self-replacement updater                    |
| Android resource qualifiers             | Not applicable | Android resource-selection mechanism                                                                    |
| APK variants and Firebase configuration | Not applicable | Android packaging only                                                                                  |
| MobileCoin 16 KB compatibility          | Not applicable | Android native-library constraint                                                                       |
| Direct Material You APIs                | Not applicable | Desktop keeps its native light, dark and system theme model                                             |

## Release

The manual release workflow accepts only a signed, remote release tag and runs
the complete gate on a Blacksmith Ubuntu 24.04 runner. It produces a Debian
package, AppImage and Flatpak, signs both updater packages, and creates signed
APT and Flatpak repositories. A final job assembles the exact artifacts,
creates a draft GitHub release, uploads immutable objects to the Desktop-only
R2 bucket, publishes the GitHub release, and updates repository and updater
metadata last.

The release environment needs these GitHub Actions secrets:

- `VESPER_DESKTOP_UPDATE_PRIVATE_KEY`
- `VESPER_DESKTOP_APPIMAGE_UPDATE_PRIVATE_KEY`
- `VESPER_DESKTOP_LINUX_REPOSITORY_PRIVATE_KEY`
- `VESPER_DESKTOP_R2_ACCOUNT_ID`
- `VESPER_DESKTOP_R2_ACCESS_KEY_ID`
- `VESPER_DESKTOP_R2_SECRET_ACCESS_KEY`

The Linux repository secret is an ASCII-armoured OpenPGP private key dedicated
to package publication. Use a key without a passphrase; GitHub's protected
`release` environment is the access boundary and the ephemeral runner deletes
its temporary keyring.

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
checks the completed bundle tree's desktop and protocol identity and confirms
the Electron version without installing, replacing or stopping the user's
Vesper app. It starts that isolated build twice with temporary application data.
The launcher defaults to `gnome-libsecret` and rejects Electron's plaintext
password store. The test checks that the SQLCipher key is encrypted in
`config.json`, that no plaintext `key` field exists, and that the same profile
opens on the second run.

The Flatpak application remains AGPL-3.0-only. Its AppStream metadata is
CC0-1.0 so software catalogues may copy and index it.

`tools/prepare-linux-repositories.sh` signs the Flatpak commit and summary,
rebuilds the bundle with the repository public key, emits
`vesper.flatpakrepo` and `vesper.flatpakref`, and builds the signed APT
repository from the same release key. It uses temporary or generated artifact
paths only; private signing material remains outside the repository.

The expected public routes under `https://vspdb.asy.st` are:

- `/desktop/latest-linux.yml`
- `/desktop/<package>`
- `/desktop/<package>.sig`
- `/apt/vesper-archive-keyring.gpg`
- `/apt/vesper.sources`
- `/apt/dists/stable/InRelease`
- `/flatpak/vesper.flatpakrepo`
- `/flatpak/vesper.flatpakref`
- `/flatpak/repo/summary`

The separate Worker at `https://vsp.asy.st` serves `/config/{hashed ACI}` and
the `/captcha/registration/generate.html` and
`/captcha/challenge/generate.html` handoff pages for desktop and Android.

Do not publish from a local checkout. Do not push a tag until its exact outer
commit and the release inputs have been reviewed.
