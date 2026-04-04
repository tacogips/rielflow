#!/usr/bin/env sh

set -eu

mailbox_dir="${DIVEDRA_MAILBOX_DIR:?DIVEDRA_MAILBOX_DIR is required}"
output_path="${mailbox_dir}/outbox/output.json"

mkdir -p "$(dirname "$output_path")"

if [ "$#" -lt 2 ]; then
  printf '%s\n' '{"operation":"divide","note":"expected two numeric args","result":null}' > "$output_path"
  exit 0
fi

dividend="$1"
divisor="$2"

awk -v dividend="$dividend" -v divisor="$divisor" 'BEGIN {
  if (divisor == 0) {
    printf("{\"operation\":\"divide\",\"error\":\"division by zero\"}\n");
    exit 0;
  }
  result = dividend / divisor;
  printf("{\"operation\":\"divide\",\"operands\":[%s,%s],\"result\":%s}\n", dividend, divisor, result);
}' > "$output_path"
