#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="scripts/_three-commands-output.txt"
{
  node scripts/v017-heal-evidence.mjs .
  echo ""
  tail -6 .verify-results.txt
  echo ""
  jq '.plans["swift-migration-v017-adversarial-gap-closure"].verifiedEvidence' impl-plans/PROGRESS.json
} > "$OUT" 2>&1
