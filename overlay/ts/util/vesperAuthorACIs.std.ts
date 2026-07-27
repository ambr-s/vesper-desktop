// Copyright 2026 amber
// SPDX-License-Identifier: AGPL-3.0-only

let vesperAuthorAciHashes: ReadonlySet<string> = new Set();

/**
 * Hashed account identifiers returned by Vesper's cached config response.
 */
export function getVesperAuthorAciHashes(): ReadonlySet<string> {
  return vesperAuthorAciHashes;
}

export function setVesperAuthorAciHashes(hashes: ReadonlyArray<string>): void {
  vesperAuthorAciHashes = new Set(hashes);
}
