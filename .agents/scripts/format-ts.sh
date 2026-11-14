#!/bin/bash
# Format TypeScript files if they exist
shopt -s nullglob globstar
ts_files=(src/**/*.ts)
files=("${ts_files[@]}")
if [ ${#files[@]} -gt 0 ]; then
  bunx prettier --write "${files[@]}"
fi
exit 0
