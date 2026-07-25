#!/usr/bin/env bash
# Copyright 2026 Vesper contributors
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

if [[ $# -ne 1 || ! -e "$1/.git" ]]; then
  echo "Usage: $0 /path/to/materialised/work" >&2
  exit 2
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

python3 "$ROOT/tools/transform.py" "$1"
