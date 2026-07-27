# Contributing

Vesper is maintained as a patchset. Make source changes in the materialised
Signal Desktop checkout:

```bash
./tools/materialize.sh
cd work
# edit, test and commit
cd ..
./tools/export.sh
./tools/build-local.sh
```

Do not edit files in `patches/` by hand. Use a transform for stable mechanical
changes, an overlay for a Vesper-owned whole file, and a focused source commit
when integration with Signal Desktop is unavoidable.

By contributing, you agree to license your work under `AGPL-3.0-only`. You keep
your copyright and confirm that you wrote the change or have the right to submit
it under that licence.

Add a Developer Certificate of Origin sign-off with `git commit -s`:

```text
Signed-off-by: Your Name <you@example.com>
```

The sign-off follows
[Developer Certificate of Origin 1.1](https://developercertificate.org/) and is
not a copyright assignment. GPG-sign authoring commits before their first
export; format-patch preserves the DCO trailer but cannot preserve the Git
commit object's signature, so commits replayed by `tools/materialize.sh` are
expected to be unsigned. If you adapt work from Signal, Molly or another
project, keep its notices and name the repository, path, commit, licence and
original author in the commit or `NOTICE`.

Never submit private keys, tokens, passwords, signing files, local credentials,
dependencies or generated build output.
