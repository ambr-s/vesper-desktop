#!/usr/bin/env node
// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const releaseMode = args.delete("--release");
const [checkoutArg] = args;
if (!checkoutArg || args.size !== 1) {
  console.error(
    "Usage: node tools/verify-identity.mjs [--release] /path/to/materialised/work",
  );
  process.exit(2);
}

const checkout = path.resolve(checkoutArg);

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(checkout, relativePath), { encoding: "utf8" }),
  );
}

function expect(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label} was ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
    );
  }
}

const packageJson = await readJson("package.json");
const configuration = await readJson("config/default.json");
const production = await readJson("config/production.json");

expect(packageJson.name, "vesper-desktop", "package name");
expect(packageJson.productName, "Vesper", "product name");
expect(packageJson.desktopName, "vesper.desktop", "desktop name");
expect(packageJson.build.appId, "systems.amber.vesper", "application ID");
expect(
  packageJson.build.linux.executableName,
  "vesper-desktop",
  "Linux executable name",
);
expect(
  packageJson.build.linux.desktop.entry.StartupWMClass,
  "vesper",
  "Linux window class",
);
expect(
  packageJson.build.protocols.schemes.join(","),
  "vesper,vespercaptcha",
  "protocol schemes",
);

for (const platform of ["mac", "win", "linux"]) {
  expect(
    packageJson.build[platform].publish[0].url,
    "https://vspdb.asy.st/desktop",
    `${platform} update URL`,
  );
}

expect(
  configuration.updatesUrl,
  "https://vspdb.asy.st/desktop",
  "runtime update URL",
);
expect(
  configuration.challengeUrl,
  "https://vspdb.asy.st/captcha/challenge/generate.html",
  "chat captcha URL",
);
expect(
  production.registrationChallengeUrl,
  "https://vspdb.asy.st/captcha/registration/generate.html",
  "registration captcha URL",
);

const adhocBuildScript = await readFile(
  path.join(checkout, "scripts/prepare_adhoc_build.mjs"),
  { encoding: "utf8" },
);
for (const expected of [
  "const ADHOC_PRODUCT_NAME = `Vesper Adhoc ${formattedDate}.${shortSha}`;",
  "const ADHOC_WM_CLASS = `vesper adhoc ${formattedDate} ${shortSha}`;",
  "const ADHOC_DESKTOP_NAME = `vesper adhoc ${formattedDate} ${shortSha}.desktop`;",
]) {
  if (!adhocBuildScript.includes(expected)) {
    throw new Error(
      `Ad-hoc build identity is missing ${JSON.stringify(expected)}`,
    );
  }
}
for (const forbidden of ["Signal Adhoc", "signal adhoc"]) {
  if (adhocBuildScript.includes(forbidden)) {
    throw new Error(`Signal ad-hoc build identity remains: ${forbidden}`);
  }
}

const supportSource = await readFile(
  path.join(checkout, "ts/types/support.std.ts"),
  { encoding: "utf8" },
);
for (const expected of [
  "https://github.com/ambr-s/vesper-desktop/releases/latest",
  "https://github.com/ambr-s/vesper-desktop/releases",
]) {
  if (!supportSource.includes(expected)) {
    throw new Error(`Vesper release route is missing ${expected}`);
  }
}

for (const relativePath of [
  "ts/types/support.std.ts",
  "ts/components/DialogExpiredBuild.dom.tsx",
  "ts/components/installScreen/InstallScreenErrorStep.dom.tsx",
  "ts/components/conversation/UnsupportedMessage.dom.tsx",
]) {
  const source = await readFile(path.join(checkout, relativePath), {
    encoding: "utf8",
  });
  if (source.includes("signal.org/download")) {
    throw new Error(`Signal download route remains in ${relativePath}`);
  }
}

for (const relativePath of [
  "ts/util/contactSupport.dom.tsx",
  "ts/util/createSupportUrl.std.ts",
]) {
  const source = await readFile(path.join(checkout, relativePath), {
    encoding: "utf8",
  });
  if (source.includes("support.signal.org/hc/requests/new")) {
    throw new Error(
      `Signal support submission route remains in ${relativePath}`,
    );
  }
  if (!source.includes("github.com/ambr-s/vesper-desktop/issues/new")) {
    throw new Error(`Vesper issue route is missing from ${relativePath}`);
  }
}

const chatRefreshSource = await readFile(
  path.join(
    checkout,
    "ts/components/conversation/ChatSessionRefreshedNotification.dom.tsx",
  ),
  { encoding: "utf8" },
);
if (chatRefreshSource.includes("support.signal.org/hc/requests/new")) {
  throw new Error("Signal support submission remains in chat refresh help");
}
if (!chatRefreshSource.includes("createSupportUrl")) {
  throw new Error("Chat refresh help is not routed through Vesper support");
}

const localeRoot = path.join(checkout, "_locales");
for (const entry of await readdir(localeRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const messages = await readJson(
    path.join("_locales", entry.name, "messages.json"),
  );
  const upgradeMessage = messages["icu:upgrade"]?.messageformat;
  if (
    typeof upgradeMessage === "string" &&
    upgradeMessage.includes("signal.org/download")
  ) {
    throw new Error(
      `Signal download route remains in the ${entry.name} upgrade message`,
    );
  }
}

const keyPattern = /^[0-9a-f]{66}$/u;
for (const name of ["updatesPublicKey", "appImageUpdatesPublicKey"]) {
  const value = configuration[name];
  if (!keyPattern.test(value)) {
    throw new Error(`${name} must be a 33-byte hexadecimal public key`);
  }
  if (/^0+$/u.test(value)) {
    if (releaseMode) {
      throw new Error(`${name} is still the fail-closed placeholder`);
    }
    console.warn(`Warning: ${name} is still the fail-closed placeholder.`);
  }
}

const userConfig = await readFile(
  path.join(checkout, "app/user_config.main.ts"),
  {
    encoding: "utf8",
  },
);
if (!userConfig.includes("`Vesper-${config.get('storageProfile')}`")) {
  throw new Error("Development storage is not isolated under a Vesper profile");
}
if (userConfig.includes("`Signal-${config.get('storageProfile')}`")) {
  throw new Error("Signal development storage identity remains configured");
}

const builderPatch = await readFile(
  path.join(checkout, "patches/app-builder-lib.patch"),
  { encoding: "utf8" },
);
for (const expected of [
  "POLICY_ORG='systems.amber.vesper'",
  "systems.amber.vesper.${sanitizedName}.*.policy",
  ".vesper-postinst",
  String.raw`$LOCALAPPDATA\vesper-desktop-updater`,
]) {
  if (!builderPatch.includes(expected)) {
    throw new Error(`Packager identity is missing ${JSON.stringify(expected)}`);
  }
}
for (const forbidden of [
  "POLICY_ORG='org.signalapp'",
  "org.signalapp.${sanitizedName}.*.policy",
  ".signal-postinst",
  String.raw`$LOCALAPPDATA\signal-desktop-updater`,
]) {
  if (builderPatch.includes(forbidden)) {
    throw new Error(`Signal packager identity remains: ${forbidden}`);
  }
}

console.log(
  "Verified Vesper package, storage, protocol, and update identities.",
);
