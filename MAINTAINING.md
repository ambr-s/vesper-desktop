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

| Android behaviour | Desktop status | Desktop treatment |
| --- | --- | --- |
| Vesper product identity and branding | Implemented | Own package name, application ID, executable, desktop entry, storage, icons and protocol handlers |
| Production and development coexistence | Implemented | Development Vesper has separate package, application ID, executable, desktop entry and protocols |
| Light, dark and system appearance | Implemented | Existing Desktop theme modes use Vesper's static palette |
| Optional diagnostic logging | Implemented | Off by default; disabling asks for confirmation and clears local logs and crash reports |
| Preserve remote deletion requests | Implemented | Off by default; applies only to ordinary incoming messages and adds a local marker |
| Vesper settings and help | Implemented | Public Vesper settings, Vesper About content and internal settings after seven version clicks |
| Independent update channel | Implemented, release-blocked | Desktop-only host, signing key and R2 credentials; release validation rejects placeholder keys |
| APK variants and Firebase configuration | Not applicable | Android packaging only |
| MobileCoin 16 KB compatibility | Not applicable | Android native-library constraint |
| Direct Material You APIs | Not applicable | Desktop keeps its native light, dark and system theme model |

## Release

The manual release workflow builds Linux x64 on a Blacksmith Ubuntu 24.04
runner. It accepts only a signed, remote release tag, runs the complete local
gate, verifies Vesper identity, signs the update and creates a draft GitHub
release. Publication uses a Desktop-only R2 bucket and never reuses Android
credentials.

The release environment needs these GitHub Actions secrets:

- `VESPER_DESKTOP_UPDATE_PRIVATE_KEY`
- `VESPER_DESKTOP_R2_ACCOUNT_ID`
- `VESPER_DESKTOP_R2_ACCESS_KEY_ID`
- `VESPER_DESKTOP_R2_SECRET_ACCESS_KEY`

The corresponding public updater key belongs in `branding/vesper.env`. Generate
it as a separate Desktop keypair. `node tools/verify-identity.mjs --release work`
rejects the fail-closed placeholder.

The expected public routes under `https://vspdb.asy.st` are:

- `/desktop/latest-linux.yml`
- `/desktop/<package>`
- `/desktop/<package>.sig`
- `/captcha/challenge/generate.html`
- `/captcha/registration/generate.html`
- `/captcha/vesper-captcha.js`

Do not publish from a local checkout. Do not push a tag until its exact outer
commit and the release inputs have been reviewed.
