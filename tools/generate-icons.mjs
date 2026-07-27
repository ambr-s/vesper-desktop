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
const squircleSource = path.join(root, "branding", "vesper-icon-squircle.svg");
const check = process.argv[2] === "--check";
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const traySizes = [16, 32, 48, 256];
const icnsTypes = new Map([
  [16, "icp4"],
  [32, "icp5"],
  [64, "icp6"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
]);
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

const squircleSourceData = await readFile(squircleSource);
const squircleSourceText = squircleSourceData.toString("utf8");
expectBrandTokens("Vesper Windows/macOS application icon", squircleSourceText, [
  '<stop offset="0" stop-color="#6341FF"/>',
  '<stop offset="1" stop-color="#613FFF"/>',
  '<rect width="1024" height="1024" rx="229"',
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
expectBrandTokens(
  "Vesper macOS icon",
  await readFile(
    path.join(overlay, "build", "icons", "mac", "AppIcon.icon", "icon.json"),
    "utf8",
  ),
  [
    '"srgb:0.38824,0.25490,1.00000,1.00000"',
    '"srgb:0.38039,0.24706,1.00000,1.00000"',
  ],
);

const linuxImage = await loadImage(linuxSource);
const squircleImage = await loadImage(squircleSource);

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

    // Draw the mark directly so generated icons do not depend on whichever
    // sans-serif font happens to be installed on the build host.
    context.strokeStyle = "#fff";
    context.lineCap = "round";
    context.lineWidth = radius * 0.18;
    context.beginPath();
    context.moveTo(x, y - radius * 0.46);
    context.lineTo(x, y + radius * 0.1);
    context.stroke();
    context.beginPath();
    context.arc(x, y + radius * 0.45, radius * 0.09, 0, Math.PI * 2);
    context.fillStyle = "#fff";
    context.fill();
  }

  return canvas.toBuffer("image/png");
}

function iconComposerForeground(sourceText) {
  const withoutDefinitions = sourceText.replace(/<defs>[\s\S]*?<\/defs>/, "");
  const withoutBackground = withoutDefinitions.replace(/<rect\b[^>]*\/>/, "");
  if (withoutBackground === sourceText || withoutBackground.includes("<rect")) {
    throw new Error("Could not isolate the macOS icon foreground");
  }
  return withoutBackground;
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

const squirclePngs = new Map();
for (const size of [...new Set([...icoSizes, ...icnsTypes.keys()])]) {
  squirclePngs.set(size, await render(squircleImage, size));
}

for (const size of pngSizes) {
  await write(`build/icons/png/${size}x${size}.png`, linuxPngs.get(size));
}

await write("images/vesper-logo-desktop-linux.png", linuxPngs.get(512));
await write(
  "images/app-icon-with-error.png",
  await render(linuxImage, 128, true),
);
await write(
  "build/icons/mac/AppIcon.icon/Assets/logo.svg",
  Buffer.from(iconComposerForeground(squircleSourceText)),
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

function makeIco(sizes) {
  const images = sizes.map((size) => ({
    size,
    data: squirclePngs.get(size),
  }));
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const ico = makeIco(icoSizes);
await write("build/icons/win/icon.ico", ico);
await write("build/icon.ico", ico);
await write("build/installerIcon.ico", ico);
await write("build/installerHeaderIcon.ico", ico);

const icnsChunks = [];
for (const [size, type] of icnsTypes) {
  const data = squirclePngs.get(size);
  const chunk = Buffer.alloc(8 + data.length);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32BE(chunk.length, 4);
  data.copy(chunk, 8);
  icnsChunks.push(chunk);
}
const icnsLength =
  8 + icnsChunks.reduce((total, chunk) => total + chunk.length, 0);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(icnsLength, 4);
await write("build/dmg/icon.icns", Buffer.concat([icnsHeader, ...icnsChunks]));

console.log(
  `${check ? "Verified" : "Generated"} Vesper icon overlays from ${
    linuxSourceData.length + squircleSourceData.length
  } source bytes.`,
);
