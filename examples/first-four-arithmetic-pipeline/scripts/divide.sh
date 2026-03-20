#!/usr/bin/env sh

if [ "$#" -lt 2 ]; then
  printf '%s\n' '{"operation":"divide","note":"placeholder command example expects two numeric args","result":null}'
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
}'
