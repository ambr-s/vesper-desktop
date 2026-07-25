#!/usr/bin/env python3
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent


def load_environment(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key or not value:
            raise ValueError(f"Invalid branding entry: {raw_line}")
        result[key] = value
    return result


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object in {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def expect(value: Any, expected: Any, path: str) -> None:
    if value != expected:
        raise ValueError(f"{path} was {value!r}; expected {expected!r}")


def replace_exact(path: Path, old: str, new: str, count: int) -> None:
    original = path.read_text(encoding="utf-8")
    actual = original.count(old)
    if actual != count:
        raise ValueError(
            f"{path.relative_to(ROOT)} contained {actual} instances of {old!r}; "
            f"expected {count}"
        )
    path.write_text(original.replace(old, new), encoding="utf-8")


def transform_package(checkout: Path, brand: dict[str, str]) -> None:
    path = checkout / "package.json"
    package = read_json(path)

    expected = {
        "name": "signal-desktop",
        "productName": "Signal",
        "description": "Private messaging from your desktop",
        "desktopName": "signal.desktop",
        "repository": "https://github.com/signalapp/Signal-Desktop.git",
    }
    for key, value in expected.items():
        expect(package.get(key), value, f"package.json.{key}")

    package.update(
        {
            "name": brand["PACKAGE_NAME"],
            "productName": brand["APP_TITLE"],
            "description": "Private Signal messaging with Vesper privacy controls",
            "desktopName": brand["DESKTOP_NAME"],
            "repository": "https://github.com/ambr-s/vesper-desktop.git",
            "author": {
                "name": "amber",
                "email": "amber@flourish.ch",
                "url": "https://amber.systems",
            },
        }
    )

    scripts = package["scripts"]
    scripts["build:vesper-development"] = (
        "node scripts/prepare_vesper_development_build.mjs && "
        "cross-env SIGNAL_ENV=production pnpm run build:electron "
        "--config.directories.output=release-development"
    )
    expect(
        scripts["push-strings"],
        "node scripts/remove-strings.mjs && "
        "node scripts/extract-info-plist-strings.mjs && "
        "node scripts/push-strings.mjs",
        "scripts.push-strings",
    )
    scripts["push-strings"] = scripts["push-strings"].replace(
        "node scripts/extract-info-plist-strings.mjs && ", "", 1
    )
    scripts.pop("build:release:mas", None)
    scripts.pop("build:mas-dev", None)
    scripts.pop("prepare-mas-build", None)

    build = package["build"]
    expect(build["appId"], "org.whispersystems.signal-desktop", "build.appId")
    build["appId"] = brand["APP_ID"]

    update_url = f'{brand["UPDATE_ORIGIN"]}/desktop'
    for platform in ("mac", "win", "linux"):
        publishers = build[platform]["publish"]
        expect(len(publishers), 1, f"build.{platform}.publish")
        publishers[0]["url"] = update_url

    build["mac"].pop("signInstaller", None)

    win_signing = build["win"]["signtoolOptions"]
    for key in ("certificateSubjectName", "certificateSha1", "publisherName"):
        win_signing.pop(key, None)

    linux = build["linux"]
    expect(linux["executableName"], "signal-desktop", "build.linux.executableName")
    expect(
        linux["desktop"]["entry"]["StartupWMClass"],
        "signal",
        "build.linux.desktop.entry.StartupWMClass",
    )
    linux["executableName"] = brand["EXECUTABLE_NAME"]
    linux["desktop"]["entry"]["StartupWMClass"] = "vesper"
    linux["extraResources"][0]["filter"] = ["systems.amber.vesper.*.policy"]

    expect(
        build["protocols"]["schemes"],
        ["sgnl", "signalcaptcha"],
        "build.protocols.schemes",
    )
    build["protocols"] = {
        "name": "vesper-url-schemes",
        "schemes": [
            brand["PROTOCOL_SCHEME"],
            brand["CAPTCHA_PROTOCOL_SCHEME"],
        ],
    }

    build.pop("mas", None)
    build.pop("masDev", None)
    write_json(path, package)


def transform_configuration(checkout: Path, brand: dict[str, str]) -> None:
    default_path = checkout / "config/default.json"
    default = read_json(default_path)
    default["updatesUrl"] = f'{brand["UPDATE_ORIGIN"]}/desktop'
    default["updatesPublicKey"] = brand["UPDATES_PUBLIC_KEY"]
    default["appImageUpdatesPublicKey"] = brand["APPIMAGE_UPDATES_PUBLIC_KEY"]
    default["challengeUrl"] = (
        f'{brand["UPDATE_ORIGIN"]}/captcha/challenge/generate.html'
    )
    default["registrationChallengeUrl"] = (
        f'{brand["UPDATE_ORIGIN"]}/captcha/registration/generate.html'
    )
    write_json(default_path, default)

    production_path = checkout / "config/production.json"
    production = read_json(production_path)
    production["challengeUrl"] = default["challengeUrl"]
    production["registrationChallengeUrl"] = default["registrationChallengeUrl"]
    write_json(production_path, production)


def transform_strings(checkout: Path) -> None:
    manifest = read_json(ROOT / "branding/strings.json")
    manifest.pop("$schema", None)
    path = checkout / "_locales/en/messages.json"
    messages = read_json(path)

    for key, replacement in manifest.items():
        if key not in messages:
            raise KeyError(f"Missing English localisation key: {key}")
        current = messages[key].get("messageformat")
        if not isinstance(current, str) or not current:
            raise ValueError(f"Missing messageformat for English localisation key: {key}")
        messages[key]["messageformat"] = replacement

    write_json(path, messages)

    for locale_path in sorted((checkout / "_locales").glob("*/messages.json")):
        if locale_path == path:
            continue
        locale_messages = read_json(locale_path)
        changed = False
        for key in manifest:
            entry = locale_messages.get(key)
            if not isinstance(entry, dict):
                continue
            current = entry.get("messageformat")
            if not isinstance(current, str):
                continue
            updated = current.replace("Signal Desktop", "Vesper")
            updated = updated.replace("Signal desktop", "Vesper")
            updated = updated.replace("Signal", "Vesper")
            updated = updated.replace(
                "signal.org/download",
                "github.com/ambr-s/vesper-desktop/releases/latest",
            )
            if updated != current:
                entry["messageformat"] = updated
                changed = True
        if changed:
            write_json(locale_path, locale_messages)

    replace_exact(
        checkout / "build/SignalStrings.nsh",
        "Signal",
        "Vesper",
        75,
    )


def transform_channel_scripts(checkout: Path) -> None:
    for name in (
        "prepare_adhoc_build.mjs",
        "prepare_alpha_build.mjs",
        "prepare_axolotl_build.mjs",
        "prepare_beta_build.mjs",
        "prepare_staging_build.mjs",
    ):
        path = checkout / "scripts" / name
        text = path.read_text(encoding="utf-8")
        text = text.replace(
            "org.whispersystems.signal-desktop", "systems.amber.vesper"
        )
        text = text.replace("signal-desktop", "vesper-desktop")
        text = text.replace("signal.desktop", "vesper.desktop")
        text = text.replace("'signal", "'vesper")
        text = re.sub(r"(?<=')Signal(?=(?: |'))", "Vesper", text)
        path.write_text(text, encoding="utf-8")

    adhoc_path = checkout / "scripts/prepare_adhoc_build.mjs"
    replace_exact(
        adhoc_path,
        "`Signal Adhoc ${formattedDate}.${shortSha}`",
        "`Vesper Adhoc ${formattedDate}.${shortSha}`",
        1,
    )
    replace_exact(
        adhoc_path,
        "`signal adhoc ${formattedDate} ${shortSha}`",
        "`vesper adhoc ${formattedDate} ${shortSha}`",
        1,
    )
    replace_exact(
        adhoc_path,
        "`signal adhoc ${formattedDate} ${shortSha}.desktop`",
        "`vesper adhoc ${formattedDate} ${shortSha}.desktop`",
        1,
    )


def transform_policy_identity(checkout: Path) -> None:
    replacements = (
        ("org.signalapp", "systems.amber.vesper"),
        ("Signal Desktop", "Vesper"),
        ("https://signal.org/", "https://amber.systems/"),
    )
    paths = [
        checkout / "scripts/gen-policy-files.mjs",
        checkout / "scripts/ensure-linux-file-permissions.mjs",
        checkout / "ts/util/os/promptOSAuthMain.main.ts",
    ]
    paths.extend((checkout / "build/policy-templates").glob("*.policy"))
    paths.extend((checkout / "build").glob("org.signalapp.*.policy"))
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for old, new in replacements:
            text = text.replace(old, new)
        path.write_text(text, encoding="utf-8")

    for source in sorted((checkout / "build/policy-templates").glob("org.signalapp.*")):
        target = source.with_name(source.name.replace("org.signalapp", "systems.amber.vesper"))
        source.rename(target)

    for source in sorted((checkout / "build").glob("org.signalapp.*.policy")):
        target = source.with_name(
            source.name.replace("org.signalapp", "systems.amber.vesper")
        )
        source.rename(target)

    auth_path = checkout / "ts/util/os/promptOSAuthMain.main.ts"
    replace_exact(
        auth_path,
        "    command = 'pkcheck -u --process $$ --action-id "
        "systems.amber.vesper.view-aep';",
        "    command =\n"
        "      'pkcheck -u --process $$ --action-id "
        "systems.amber.vesper.view-aep';",
        1,
    )
    replace_exact(
        auth_path,
        "    actionCommand = 'pkaction --action-id "
        "systems.amber.vesper.plaintext-export';",
        "    actionCommand =\n"
        "      'pkaction --action-id systems.amber.vesper.plaintext-export';",
        1,
    )


def transform_miscellaneous_identity(checkout: Path) -> None:
    menu_test_path = checkout / "ts/test-node/app/menu_test.node.ts"
    replace_exact(menu_test_path, "'About Signal Desktop'", "'About Vesper'", 2)
    replace_exact(menu_test_path, "'Signal Desktop'", "'Vesper'", 1)
    replace_exact(menu_test_path, "'Quit Signal'", "'Quit Vesper'", 2)

    replace_exact(
        checkout / "app/startup_config.main.ts",
        "`org.whispersystems.${packageJson.name}`",
        "`systems.amber.${packageJson.name}`",
        1,
    )
    replace_exact(
        checkout / "app/user_config.main.ts",
        "`Signal-${config.get('storageProfile')}`",
        "`Vesper-${config.get('storageProfile')}`",
        1,
    )
    replace_exact(
        checkout / "ts/logging/uploadDebugLog.node.ts",
        "signal-desktop-debug-log-",
        "vesper-desktop-debug-log-",
        1,
    )
    replace_exact(
        checkout / "ts/state/ducks/installer.preload.ts",
        "OS.getName() || 'Signal Desktop'",
        "OS.getName() || 'Vesper'",
        1,
    )
    replace_exact(
        checkout / "ts/services/notifications.preload.ts",
        "FALLBACK_NOTIFICATION_TITLE = 'Signal'",
        "FALLBACK_NOTIFICATION_TITLE = 'Vesper'",
        1,
    )
    replace_exact(
        checkout / "ts/windows/main/attachments.preload.ts",
        "const appName = 'Signal'",
        "const appName = 'Vesper'",
        1,
    )
    replace_exact(
        checkout / "ts/state/smart/ToastManager.preload.tsx",
        "`signal-desktop-${Date.now()}.heapsnapshot`",
        "`vesper-desktop-${Date.now()}.heapsnapshot`",
        1,
    )
    replace_exact(
        checkout / "scripts/generate-acknowledgments.mjs",
        "'Signal Desktop makes use of the following open source projects.'",
        "'Vesper makes use of the following open source projects.'",
        1,
    )
    replace_exact(
        checkout / "ACKNOWLEDGMENTS.md",
        "Signal Desktop makes use of the following open source projects.",
        "Vesper makes use of the following open source projects.",
        1,
    )
    replace_exact(
        checkout / "scripts/symbolicate-crash-report.mjs",
        "filename.startsWith('signal-desktop-')",
        "filename.startsWith('vesper-desktop-')",
        1,
    )
    replace_exact(
        checkout / "scripts/symbolicate-crash-report.mjs",
        "filename.startsWith('Signal')",
        "filename.startsWith('Vesper')",
        1,
    )
    replace_exact(
        checkout / "scripts/test-release.mjs",
        "const tmpApp = join(tmpFolder, 'Signal');",
        "const tmpApp = join(tmpFolder, 'Vesper');",
        1,
    )
    builder_patch = checkout / "patches/app-builder-lib.patch"
    original_builder_patch_hash = hashlib.sha256(
        builder_patch.read_bytes()
    ).hexdigest()
    replace_exact(
        builder_patch,
        "POLICY_ORG='org.signalapp'",
        "POLICY_ORG='systems.amber.vesper'",
        1,
    )
    replace_exact(
        builder_patch,
        "org.signalapp.${sanitizedName}.*.policy",
        "systems.amber.vesper.${sanitizedName}.*.policy",
        1,
    )
    replace_exact(builder_patch, ".signal-postinst", ".vesper-postinst", 1)
    replace_exact(
        builder_patch,
        r"$LOCALAPPDATA\signal-desktop-updater",
        r"$LOCALAPPDATA\vesper-desktop-updater",
        1,
    )
    vesper_builder_patch_hash = hashlib.sha256(builder_patch.read_bytes()).hexdigest()
    replace_exact(
        checkout / "pnpm-lock.yaml",
        original_builder_patch_hash,
        vesper_builder_patch_hash,
        5,
    )

    linux_updater_path = checkout / "ts/updater/linux.main.ts"
    replace_exact(
        linux_updater_path, ".signal-postinst", ".vesper-postinst", 3
    )
    replace_exact(linux_updater_path, "/opt/Signal", "/opt/Vesper", 2)
    replace_exact(
        checkout / "stylesheets/_modules.scss",
        "../images/signal-logo.svg",
        "../images/vesper-logo.svg",
        1,
    )
    replace_exact(
        checkout / "stylesheets/components/InstallScreenSignalLogo.scss",
        "../images/signal-logo-and-wordmark.svg",
        "../images/vesper-logo-and-wordmark.svg",
        1,
    )
    replace_exact(
        checkout / "ts/components/standaloneRegistration/StandaloneRegistration.dom.tsx",
        "images/signal-logo-with-text.svg",
        "images/vesper-logo-with-text.svg",
        1,
    )
    replace_exact(
        checkout / "background.html",
        "images/signal-logo.svg",
        "images/vesper-logo.svg",
        1,
    )
    replace_exact(
        checkout / "app/main.main.ts",
        "images', 'signal-logo-desktop-linux.png",
        "images', 'vesper-logo-desktop-linux.png",
        1,
    )

    for path in (
        checkout / "build/entitlements.mas-dev.inherit.plist",
        checkout / "build/entitlements.mas-dev.plist",
        checkout / "build/entitlements.mas.inherit.plist",
        checkout / "build/entitlements.mas.plist",
        checkout / "scripts/build-mas-dev.sh",
        checkout / "scripts/extract-info-plist-strings.mjs",
        checkout / "scripts/prepare_mas_build.mjs",
        checkout / "scripts/sign-mas-installer.mjs",
    ):
        path.unlink()


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {Path(sys.argv[0]).name} /path/to/materialised/work", file=sys.stderr)
        return 2

    checkout = Path(sys.argv[1]).resolve()
    if not (checkout / ".git").exists():
        print(f"Not a Git checkout: {checkout}", file=sys.stderr)
        return 2

    brand = load_environment(ROOT / "branding/vesper.env")
    transform_package(checkout, brand)
    transform_configuration(checkout, brand)
    transform_strings(checkout)
    transform_channel_scripts(checkout)
    transform_policy_identity(checkout)
    transform_miscellaneous_identity(checkout)
    print("Applied Vesper Desktop identity transforms.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
