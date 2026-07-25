// Copyright 2026 amber
// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import packageJson from '../../package.json' with { type: 'json' };
import configuration from '../../config/default.json' with { type: 'json' };
import { hexToBinary, verifySignature } from './signature.node.ts';

const [, , updatePath] = process.argv;
if (!updatePath) {
  process.stderr.write(
    'Usage: node --import=tsx ts/updater/verifyVesperUpdate.node.ts UPDATE_PACKAGE\n'
  );
  process.exit(2);
}

const signature = hexToBinary(
  await readFile(`${updatePath}.sig`, { encoding: 'utf8' })
);
const publicKey = hexToBinary(configuration.updatesPublicKey);
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
