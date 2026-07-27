#!/usr/bin/env node
// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';

const ACI_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const acis = process.argv.slice(2);
if (acis.length === 0) {
  console.error('Usage: npm run developers-json -- <ACI> [ACI ...]');
  process.exitCode = 2;
} else {
  const hashes = acis.map(aci => {
    const normalized = aci.toLowerCase();
    if (!ACI_PATTERN.test(normalized)) {
      throw new Error('Each ACI must be a UUID');
    }
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  });
  console.log(JSON.stringify([...new Set(hashes)].sort()));
}
