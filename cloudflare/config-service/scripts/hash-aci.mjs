#!/usr/bin/env node
// Copyright 2026 Vesper contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';

const ACI_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const [aci, ...extra] = process.argv.slice(2);
if (!aci || extra.length > 0) {
  console.error('Usage: npm run hash-aci -- <ACI>');
  process.exitCode = 2;
} else {
  const normalized = aci.toLowerCase();
  if (!ACI_PATTERN.test(normalized)) {
    console.error('ACI must be a UUID');
    process.exitCode = 2;
  } else {
    console.log(createHash('sha256').update(normalized, 'utf8').digest('hex'));
  }
}
