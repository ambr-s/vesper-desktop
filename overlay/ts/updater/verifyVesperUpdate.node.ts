// Copyright 2026 amber
// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import packageJson from '../../package.json' with { type: 'json' };
import configuration from '../../config/default.json' with { type: 'json' };
import { hexToBinary, verifySignature } from './signature.node.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const appImage = args[0] === '--appimage';
  if (appImage) {
    args.shift();
  }
  const [updatePath] = args;
  if (!updatePath || args.length !== 1) {
    process.stderr.write(
      'Usage: node --import=tsx ts/updater/verifyVesperUpdate.node.ts [--appimage] UPDATE_PACKAGE\n'
    );
    process.exitCode = 2;
    return;
  }

  const signature = hexToBinary(
    await readFile(`${updatePath}.sig`, { encoding: 'utf8' })
  );
  const publicKey = hexToBinary(
    appImage
      ? configuration.appImageUpdatesPublicKey
      : configuration.updatesPublicKey
  );
  const valid = await verifySignature(
    updatePath,
    packageJson.version,
    signature,
    publicKey
  );
  if (!valid) {
    throw new Error('Updater signature verification failed');
  }
  process.stdout.write(`Verified updater signature for ${updatePath}\n`);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
})();
