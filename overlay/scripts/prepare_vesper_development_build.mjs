// Copyright 2026 amber
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check

import fs from "node:fs";
import _ from "lodash";
import packageJson from "../package.json" with { type: "json" };

/** @type {ReadonlyArray<readonly [string, string, string]>} */
const Values = [
  ["name", "vesper-desktop", "vesper-desktop-development"],
  ["productName", "Vesper", "Vesper Development"],
  ["desktopName", "vesper.desktop", "vesper-development.desktop"],
  ["build.appId", "systems.amber.vesper", "systems.amber.vesper.development"],
  ["build.linux.desktop.entry.StartupWMClass", "vesper", "vesper-development"],
  [
    "build.linux.executableName",
    "vesper-desktop",
    "vesper-desktop-development",
  ],
  [
    "build.protocols.name",
    "vesper-url-schemes",
    "vesper-development-url-schemes",
  ],
];

for (const [path, expected, replacement] of Values) {
  const actual = _.get(packageJson, path);
  if (actual !== expected) {
    throw new Error(`${path} was ${actual}; expected ${expected}`);
  }
  _.set(packageJson, path, replacement);
}

const schemes = packageJson.build.protocols.schemes;
if (
  !Array.isArray(schemes) ||
  schemes.length !== 3 ||
  schemes[0] !== "vesper" ||
  schemes[1] !== "vespercaptcha" ||
  schemes[2] !== "sgnl"
) {
  throw new Error("Unexpected production protocol schemes");
}
// Only installed production builds claim Signal's global fallback scheme.
packageJson.build.protocols.schemes = [
  "vesper-development",
  "vespercaptcha-development",
];

fs.writeFileSync("./package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

const productionConfig = JSON.parse(
  fs.readFileSync("./config/production.json", "utf8"),
);
for (const key of ["challengeUrl", "registrationChallengeUrl"]) {
  const url = new URL(productionConfig[key]);
  url.searchParams.set("scheme", "vespercaptcha-development");
  productionConfig[key] = url.href;
}
fs.writeFileSync(
  "./config/production.json",
  `${JSON.stringify(productionConfig, null, 2)}\n`,
);
