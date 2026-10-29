#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Select the exported series by its actual upstream base, never the live pin."""
import pathlib
import re
import subprocess
import sys


def series_path(root: pathlib.Path, tag: str) -> pathlib.Path:
    match = re.fullmatch(r"v([0-9]+)\.([0-9]+)\.([0-9]+)", tag)
    if not match:
        raise ValueError(f"Invalid Signal tag: {tag!r}")
    version = tuple(int(value) for value in match.groups())
    path = root / "patches"
    if version >= (8, 33, 0):
        path /= "signal-8.33"
    elif version >= (8, 32, 0):
        path /= "signal-8.32"
    if not any(path.glob("*.patch")):
        raise ValueError(f"Selected patch series is empty: {path}")
    return path


def upstream_tag(work: pathlib.Path, transform: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(work), "describe", "--tags", "--exact-match",
         "--match", "v[0-9]*", f"{transform}^"], text=True,
    ).strip()


if __name__ == "__main__":
    if len(sys.argv) == 3:
        tag = sys.argv[2]
    elif len(sys.argv) == 5 and sys.argv[2] == "--work":
        tag = upstream_tag(pathlib.Path(sys.argv[3]), sys.argv[4])
    else:
        sys.exit("Usage: patch_series.py ROOT TAG | ROOT --work WORK TRANSFORM")
    try:
        print(series_path(pathlib.Path(sys.argv[1]), tag))
    except (ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
