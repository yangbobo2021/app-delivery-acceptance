#!/bin/sh
set -eu
usage='preview shows planned writes'
printf '%s' "$usage" | rg preview
