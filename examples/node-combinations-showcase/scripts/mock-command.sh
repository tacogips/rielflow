#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"
printf '%s\n' '{"lane":"command","summary":"node-combinations-showcase command lane placeholder"}' > "$output_path"
