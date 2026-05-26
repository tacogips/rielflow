#!/usr/bin/env sh

set -eu

mailbox_dir="${RIEL_MAILBOX_DIR:?RIEL_MAILBOX_DIR is required}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

if [ "$#" -lt 2 ]; then
  printf '%s\n' '{"operation":"multiply","note":"expected two numeric args","result":null}' > "$output_path"
  exit 0
fi

left="$1"
right="$2"

awk -v left="$left" -v right="$right" 'BEGIN {
  result = left * right;
  printf("{\"operation\":\"multiply\",\"operands\":[%s,%s],\"result\":%s}\n", left, right, result);
}' > "$output_path"
