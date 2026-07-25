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
const source = path.join(root, "branding", "vesper-icon.svg");
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const traySizes = [16, 32, 48, 256];
const execFileAsync = promisify(execFile);

const image = await loadImage(source);

async function render(size, drawBadge = false) {
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
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

const pngs = new Map();
for (const size of [...new Set([...pngSizes, ...icoSizes])]) {
  pngs.set(size, await render(size));
}

for (const size of pngSizes) {
  await write(`build/icons/png/${size}x${size}.png`, pngs.get(size));
}

await write("images/vesper-logo-desktop-linux.png", pngs.get(512));
await write("images/app-icon-with-error.png", await render(128, true));

for (const size of traySizes) {
  const data = pngs.get(size);
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
      pngs.get(size),
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
  const images = sizes.map((size) => ({ size, data: pngs.get(size) }));
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

const icnsTypes = new Map([
  [16, "icp4"],
  [32, "icp5"],
  [64, "icp6"],
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
]);
const icnsChunks = [];
for (const [size, type] of icnsTypes) {
  const data = pngs.get(size);
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

const sourceHashInput = await readFile(source);
console.log(
  `Generated Vesper icon overlays from ${sourceHashInput.length} source bytes.`,
);
