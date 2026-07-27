#!/usr/bin/env node
// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createCanvas,
  loadImage,
} from "../work/node_modules/@napi-rs/canvas/index.js";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const overlay = path.join(root, "overlay");
const linuxSource = path.join(root, "branding", "vesper-icon.svg");
const check = process.argv[2] === "--check";
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const traySizes = [16, 32, 48, 256];
const execFileAsync = promisify(execFile);

if (process.argv.length > (check ? 3 : 2)) {
  process.stderr.write("Usage: node tools/generate-icons.mjs [--check]\n");
  process.exit(2);
}

function expectBrandTokens(label, sourceText, tokens) {
  for (const token of tokens) {
    if (!sourceText.includes(token)) {
      throw new Error(`${label} is missing ${JSON.stringify(token)}`);
    }
  }
}

const linuxSourceData = await readFile(linuxSource);
const linuxSourceText = linuxSourceData.toString("utf8");
expectBrandTokens("Vesper Linux application icon", linuxSourceText, [
  '<stop offset="0" stop-color="#6341FF"/>',
  '<stop offset="1" stop-color="#613FFF"/>',
  '<circle cx="512.0" cy="512.0" r="512.0"',
  "M778.85 378.89L662.34 562.14",
]);

expectBrandTokens(
  "Vesper titlebar icon",
  await readFile(path.join(overlay, "images", "titlebar_icon.svg"), "utf8"),
  [
    '<stop offset="0" stop-color="#6341FF"/>',
    '<stop offset="1" stop-color="#613FFF"/>',
    "M778.85 378.89L662.34 562.14",
  ],
);
const linuxImage = await loadImage(linuxSource);

async function render(image, size, drawBadge = false) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size, size);

  if (drawBadge) {
    const radius = size * 0.22;
    const x = size - radius * 1.2;
    const y = size - radius * 1.2;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = "#e00052";
    context.fill();
    context.fillStyle = "#fff";
    context.font = `700 ${Math.round(size * 0.3)}px Inter, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", x, y + size * 0.015);
  }

  return canvas.toBuffer("image/png");
}

async function write(relativePath, data) {
  const target = path.join(overlay, relativePath);
  if (check) {
    const existing = await readFile(target);
    if (!existing.equals(data)) {
      throw new Error(`Generated Vesper icon is stale: ${relativePath}`);
    }
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

const linuxPngs = new Map();
for (const size of pngSizes) {
  linuxPngs.set(size, await render(linuxImage, size));
}

for (const size of pngSizes) {
  await write(`build/icons/png/${size}x${size}.png`, linuxPngs.get(size));
}

await write("images/vesper-logo-desktop-linux.png", linuxPngs.get(512));
await write(
  "images/app-icon-with-error.png",
  await render(linuxImage, 128, true),
);
for (const size of traySizes) {
  const data = linuxPngs.get(size);
  const name = `signal-tray-icon-${size}x${size}-base.png`;
  await write(`images/tray-icons/base/${name}`, data);
  await write(`images/tray-icons/${name}`, data);
}

const trayGenerationRoot = await mkdtemp(
  path.join(tmpdir(), "vesper-tray-icons-"),
);
try {
  await mkdir(path.join(trayGenerationRoot, "scripts", "utils"), {
    recursive: true,
  });
  await mkdir(path.join(trayGenerationRoot, "images", "tray-icons", "base"), {
    recursive: true,
  });
  await cp(
    path.join(root, "work", "scripts", "generate-tray-icons.mjs"),
    path.join(trayGenerationRoot, "scripts", "generate-tray-icons.mjs"),
  );
  await cp(
    path.join(root, "work", "scripts", "utils", "assert.mjs"),
    path.join(trayGenerationRoot, "scripts", "utils", "assert.mjs"),
  );
  await cp(
    path.join(root, "work", "fonts"),
    path.join(trayGenerationRoot, "fonts"),
    {
      recursive: true,
    },
  );
  await symlink(
    path.join(root, "work", "node_modules"),
    path.join(trayGenerationRoot, "node_modules"),
    "dir",
  );
  for (const size of traySizes) {
    const name = `signal-tray-icon-${size}x${size}-base.png`;
    await writeFile(
      path.join(trayGenerationRoot, "images", "tray-icons", "base", name),
      linuxPngs.get(size),
    );
  }
  await execFileAsync(process.execPath, [
    path.join(trayGenerationRoot, "scripts", "generate-tray-icons.mjs"),
  ]);

  const alertDirectory = path.join(
    trayGenerationRoot,
    "images",
    "tray-icons",
    "alert",
  );
  for (const name of await readdir(alertDirectory)) {
    await write(
      `images/tray-icons/alert/${name}`,
      await readFile(path.join(alertDirectory, name)),
    );
  }
} finally {
  await rm(trayGenerationRoot, { recursive: true });
}

console.log(
  `${check ? "Verified" : "Generated"} Vesper Linux icon overlays from ${
    linuxSourceData.length
  } source bytes.`,
);
