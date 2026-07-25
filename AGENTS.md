# Vesper Desktop repository guide

Vesper Desktop is maintained as a small patchset against upstream Signal-Desktop. This
repository is not a Signal source fork and must never absorb the materialised `work/`
tree.

## Product goal

Bring Vesper Desktop to user-facing feature parity with the sibling
`../vesper-android` project.

Treat the behaviour currently shipped by `vesper-android` as the source of truth. Inspect
its branding inputs, overlays, patches, materialised source, and current tests before
implementing the corresponding Desktop behaviour. Port intent and observable behaviour,
not Android implementation details.

Parity includes, where the Desktop platform has a meaningful equivalent:

- Vesper identity, branding, palette, application metadata, and update-channel identity.
- Appearance behaviour and Vesper-specific settings/help surfaces.
- The ability to disable debug logging.
- The option to preserve messages that another participant remotely deletes.
- Development builds that can coexist safely with a production installation.
- Release, update, and privacy behaviour needed to make the Desktop client consistent
  with Vesper Android.

Android-only work such as Android resource qualifiers, APK variants, MobileCoin native
page-size compatibility, Firebase configuration, and Material You APIs must not be
ported literally. Record them as not applicable or implement a Desktop-native behaviour
only when that preserves the same user-facing intent.

Feature parity does not mean copying every Android patch. Keep the Desktop delta small,
auditable, and resilient to upstream churn.

## Patchset source of truth

- `upstream.pin` is the newest known-good stable Signal Desktop release tag.
- `transforms/` contains low-conflict scripted transform inputs.
- `overlay/` contains Vesper-owned whole files.
- `patches/` contains generated source commits.
- `work/` is ignored and is the only place Signal source development occurs.

The initial materialised tree is vanilla Signal Desktop. `./tools/verify-vanilla.sh`
exists only as a baseline check and is expected to stop passing once intentional Vesper
features are exported.

## Required development workflow

1. Review the corresponding behaviour in `../vesper-android`.
2. Run `./tools/materialize.sh` if `work/` does not exist.
3. Implement one coherent parity feature at a time inside `work/`.
4. Test and commit that feature inside `work/`.
5. Run `./tools/build-local.sh` from this repository.
6. Run `./tools/export.sh` to regenerate `patches/` and owned overlays.
7. Review the exported patch for scope, upstream coupling, and accidental Signal
   branding/source changes.

Never hand-edit files in `patches/`. Prefer a transform for stable mechanical rewrites,
an overlay for Vesper-owned whole files, and a focused Git patch only when integration
with upstream source is unavoidable.

Do not create a GitHub repository, add a remote, push, publish, or configure release
credentials unless the user explicitly asks for that external action in the current
session.

Never commit signing certificates, signing passwords, publishing tokens, generated
release artefacts, `node_modules/`, or the materialised `work/` checkout.
