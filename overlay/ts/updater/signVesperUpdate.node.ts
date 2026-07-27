// Copyright 2026 amber
// SPDX-License-Identifier: AGPL-3.0-only
import packageJson from '../../package.json' with { type: 'json' };
import { writeSignature } from './signature.node.ts';

async function main(): Promise<void> {
  const [, , updatePath, privateKeyPath] = process.argv;
  if (!updatePath || !privateKeyPath) {
    process.stderr.write(
      'Usage: node --import=tsx ts/updater/signVesperUpdate.node.ts UPDATE_PACKAGE PRIVATE_KEY_FILE\n'
    );
    process.exitCode = 2;
    return;
  }

  await writeSignature(updatePath, packageJson.version, privateKeyPath);
  process.stdout.write(`Wrote updater signature for ${updatePath}\n`);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
})();
