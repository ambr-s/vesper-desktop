# Release signing and bootstrap prerequisites

The release tag is an **annotated SSH-signed tag**. `.github/release-signers`
pins the public release authority to fingerprint
`SHA256:EF3gGPsqYeFgL3uLafFv3ScSLFcq0bE3HxPpPgWuzSM`, restricted to the Git
signature namespace. The label `vesper-release` is a trust principal, not a
requirement on the tagger's email address. No private signing material belongs in
this repository. Key rotation requires a reviewed change to this trust file.

The workflow verifies all of the following before building:

- The dispatch ref equals `refs/tags/v<materialised package version>`.
- The tag is annotated and verifies against the pinned SSH public key.
- OpenPGP and X.509 signatures cannot substitute runner-global trust for that key.
- The tag points to the checked-out build commit.
- The remote tag object matches the verified local tag object.

Run the focused regression suite with:

```sh
python3 tools/test_release_signing.py -v
```

It requires Python 3, Git with SSH signature support, OpenSSH, GnuPG, Bash, and
Node.js. It executes the actual workflow verification block in disposable local
repositories, with temporary test-only keys. It does not use production private
keys or contact an external remote.

## Before the first release

1. Merge the reviewed patchset and require green CI for that exact commit. Create
   the signed tag on that commit using the private counterpart of the pinned SSH
   key. Publish the tag, then dispatch `release.yml` from that tag, not `main`.
2. Configure the GitHub `release` environment with approval and deployment-tag
   restrictions. Merely naming an environment in YAML does not provision those
   protections. Restrict release-tag creation/mutation to authorized maintainers;
   tag-dispatched workflow code and its trust file are themselves supplied by the
   tagged commit.
3. Provide `VESPER_DESKTOP_LINUX_REPOSITORY_PRIVATE_KEY`: an ASCII-armored OpenPGP
   secret key usable for unattended signing by GnuPG and Flatpak. It is distinct
   from the SSH Git key and both updater keys. The current workflow has no
   passphrase-unlocking step. Retain this archive signing identity for subsequent
   releases; existing APT/Flatpak installations trust its public key.
4. Provide both updater secrets (`VESPER_DESKTOP_UPDATE_PRIVATE_KEY` and
   `VESPER_DESKTOP_APPIMAGE_UPDATE_PRIVATE_KEY`) matching the public keys embedded
   in the materialised application. Presence alone is not proof of a matching
   pair; the build signs and verifies both resulting packages.
5. Provide the R2 account/access-key/secret-access-key triplet named in the
   workflow, with write access to `vesper-desktop-updates`. Confirm that
   `https://vspdb.asy.st/` serves this bucket's `desktop/`, `apt/`, and `flatpak/`
   paths publicly, without an authentication/HTML fallback.
6. Confirm the configured Blacksmith runners are available. The publishing runner
   must provide `gh` and the AWS CLI; the workflow currently assumes both are
   installed. The build runner needs outbound access to upstream, package
   registries, and Flathub.

After publishing, verify the public updater manifest, package signatures and
blockmap, APT `InRelease` and public key, Flatpak signed summary/bootstrap files,
and GitHub release assets against the built release. A first-release manifest
404 is expected before publication, not proof that the bucket route is correctly
configured. If publication fails after creating the draft, investigate and
recover that draft deliberately: rerunning currently refuses an existing GitHub
release rather than silently overwriting it.
