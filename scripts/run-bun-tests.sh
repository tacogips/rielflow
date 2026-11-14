#!/usr/bin/env bash
set -euo pipefail

# Bun's test runner does not load vitest `env`; keep `vitest.config.ts` in sync when adding test-only env.
watch_mode="false"
declare -a passthrough_args=()

for arg in "$@"; do
  if [[ "$arg" == "--watch" ]]; then
    watch_mode="true"
    continue
  fi

  passthrough_args+=("$arg")
done

mapfile -t test_files < <(rg --files scripts packages -g '*.test.ts' -g '*.test.tsx' | sort)

if [[ "${#test_files[@]}" -eq 0 ]]; then
  echo "error: no Bun test files were found under scripts/ or packages/" >&2
  exit 1
fi

declare -a command=("bun" "test")

if [[ "$watch_mode" == "true" ]]; then
  command+=("--watch")
fi

command+=("${passthrough_args[@]}")
command+=("${test_files[@]}")

exec "${command[@]}"
