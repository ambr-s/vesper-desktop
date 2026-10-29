#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Generate and audit AppStream against the packaged application, not the pin."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET


def generate(template, version, epoch):
    tree = ET.parse(template, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    releases = tree.getroot().find("releases")
    releases.clear()
    release = ET.SubElement(releases, "release", {
        "version": version,
        "date": datetime.fromtimestamp(epoch, timezone.utc).date().isoformat(),
    })
    description = ET.SubElement(release, "description")
    ET.SubElement(description, "p").text = (
        f"Packages Vesper Desktop {version} for Linux with an independently "
        "installable Flatpak."
    )
    ET.indent(tree, space="  ")
    return ET.tostring(tree.getroot(), encoding="unicode", xml_declaration=True) + "\n"


def verify(path, payload_version, expected_version, epoch):
    releases = ET.parse(path).getroot().findall("releases/release")
    expected = {
        "version": payload_version,
        "date": datetime.fromtimestamp(epoch, timezone.utc).date().isoformat(),
    }
    if (payload_version != expected_version or len(releases) != 1
            or releases[0].attrib != expected):
        raise ValueError(
            f"AppStream/payload mismatch: expected {expected_version}, "
            f"payload {payload_version}, release {expected}; "
            f"found {[release.attrib for release in releases]}"
        )


def payload_version(archive, work):
    # Use the project's pinned ASAR implementation, never an executable app launch.
    output = subprocess.check_output([
        "node", "-e",
        "const {createRequire}=require('node:module');"
        "const asar=createRequire(process.argv[1])('@electron/asar');"
        "process.stdout.write(asar.extractFile(process.argv[2], 'package.json'));",
        str(work.resolve() / "package.json"), str(archive.resolve()),
    ], text=True)
    version = json.loads(output)["version"]
    if not isinstance(version, str) or not version.strip():
        raise ValueError("Packaged application has no version")
    return version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("generate", "verify"))
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--epoch", type=int, required=True)
    parser.add_argument("--deb", type=Path)
    parser.add_argument("--asar", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    expected = json.loads((args.work / "package.json").read_text())["version"]
    if args.mode == "generate":
        if args.deb is None or args.output is None:
            parser.error("generate requires --deb and --output")
        with tempfile.TemporaryDirectory(prefix="vesper-flatpak-metadata-") as directory:
            subprocess.run(["dpkg-deb", "--extract", str(args.deb), directory], check=True)
            version = payload_version(Path(directory) / "opt/Vesper/resources/app.asar", args.work)
        deb_version = subprocess.check_output(
            ["dpkg-deb", "--field", str(args.deb), "Version"], text=True
        ).strip()
        if version != expected or deb_version != version:
            raise ValueError(f"Debian/payload/source mismatch: {deb_version}/{version}/{expected}")
        args.output.write_text(generate(args.metadata, version, args.epoch))
    else:
        if args.asar is None:
            parser.error("verify requires --asar")
        version = payload_version(args.asar, args.work)
        verify(args.metadata, version, expected, args.epoch)
    print(f"Verified Flatpak AppStream/payload version {version}")


if __name__ == "__main__":
    main()

