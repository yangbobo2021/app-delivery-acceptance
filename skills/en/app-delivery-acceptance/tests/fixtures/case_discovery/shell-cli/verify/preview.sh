#!/bin/sh
set -eu
app="$PWD/bin/preview.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
output=$(sh "$app" --preview "$work/result.txt")
test "$output" = "would write $work/result.txt"
test ! -e "$work/result.txt"
