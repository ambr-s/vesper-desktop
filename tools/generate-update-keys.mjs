#!/usr/bin/env node
// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { constants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyDirectory = path.join(root, ".secrets");
const requireFromWork = createRequire(path.join(root, "work", "package.json"));

if (process.argv.length !== 2) {
  process.stderr.write("Usage: node tools/generate-update-keys.mjs\n");
  process.exit(2);
}

let PrivateKey;
try {
  ({ PrivateKey } = requireFromWork("@signalapp/libsignal-client"));
} catch (error) {
  process.stderr.write(
    "The materialised dependencies are missing. Run ./tools/build-local.sh first.\n",
  );
  throw error;
}

const keyFiles = [
  {
    label: "Updater",
    path: path.join(keyDirectory, "vesper-desktop-update.key"),
  },
  {
    label: "AppImage updater",
    path: path.join(keyDirectory, "vesper-desktop-appimage-update.key"),
  },
];

for (const keyFile of keyFiles) {
  try {
    await access(keyFile.path, constants.F_OK);
  } catch {
    continue;
  }
  throw new Error(
    `Refusing to replace existing signing material at ${keyFile.path}`,
  );
}

process.umask(0o077);
await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
await chmod(keyDirectory, 0o700);

for (const keyFile of keyFiles) {
  const privateKey = PrivateKey.generate();
  const privateKeyHex = Buffer.from(privateKey.serialize()).toString("hex");
  const publicKeyHex = Buffer.from(
    privateKey.getPublicKey().serialize(),
  ).toString("hex");

  if (!/^[0-9a-f]{64}$/u.test(privateKeyHex)) {
    throw new Error(`${keyFile.label} private key has an unexpected format`);
  }
  if (!/^[0-9a-f]{66}$/u.test(publicKeyHex)) {
    throw new Error(`${keyFile.label} public key has an unexpected format`);
  }

  const message = Buffer.from("Vesper update signing key self-test");
  const signature = privateKey.sign(message);
  if (!privateKey.getPublicKey().verify(message, signature)) {
    throw new Error(`${keyFile.label} keypair failed its signing self-test`);
  }

  await writeFile(keyFile.path, privateKeyHex, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${keyFile.label} public key: ${publicKeyHex}\n`);
}

process.stdout.write(
  `Private keys were written with mode 0600 under ${keyDirectory}\n`,
);
