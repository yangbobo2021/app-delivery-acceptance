#!/bin/sh
if [ "$1" = "--preview" ]; then
  printf 'would write %s\n' "$2"
else
  printf 'saved\n' > "$1"
fi
