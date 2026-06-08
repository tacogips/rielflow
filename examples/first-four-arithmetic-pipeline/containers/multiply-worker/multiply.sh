#!/usr/bin/env sh

set -eu

if [ "$#" -lt 2 ]; then
  printf '%s\n' '{"operation":"multiply","note":"expected two numeric args","result":null}'
  exit 0
fi

left="$1"
right="$2"

awk -v left="$left" -v right="$right" 'BEGIN {
  result = left * right;
  printf("{\"operation\":\"multiply\",\"operands\":[%s,%s],\"result\":%s}\n", left, right, result);
}'
