#!/bin/bash
cd "$(dirname "$0")"
bash scripts/heal-v017-parity-evidence.sh
echo "EXIT_CODE=$?"
