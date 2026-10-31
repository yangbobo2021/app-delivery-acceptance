#!/bin/sh
set -eu
umask 077
skill=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cache=${ACCEPTANCE_RUNTIME_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/app-delivery-acceptance/runtime}
case "$cache" in /*) ;; *) echo 'Absolute runtime cache required' >&2; exit 1;; esac
case "$cache/" in "$skill/"*) echo 'Runtime cache must be outside the managed Skill' >&2; exit 1;; esac
node_program=''
if command -v node >/dev/null 2>&1 && [ -z "${ACCEPTANCE_BOOTSTRAP_FORCE_NODE:-}" ]; then
  if node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; then node_program=$(command -v node); fi
fi
if [ -z "$node_program" ]; then
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) platform=darwin-arm64; digest=aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a;;
    Darwin/x86_64) platform=darwin-x64; digest=d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52;;
    Linux/aarch64) platform=linux-arm64; digest=95c264150aceb7f3437a29fd6984924f5f8d1511ea3cbd6c508b83f6c555dae2;;
    Linux/x86_64) platform=linux-x64; digest=361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9;;
    *) echo 'No pinned runtime for this platform' >&2; exit 1;;
  esac
  name=node-v24.22.2-$platform
  mkdir -p "$cache/downloads" "$cache/tools"
  cache=$(CDPATH= cd -- "$cache" && pwd -P)
  case "$cache/" in "$skill/"*) echo 'Runtime cache resolves inside managed Skill' >&2; exit 1;; esac
  archive=$cache/downloads/$name.tar.gz
  checksum(){ if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1; else LC_ALL=C shasum -a 256 "$1" | cut -d ' ' -f 1; fi; }
  if [ ! -f "$archive" ]; then
    temporary=$archive.$$.download
    curl --fail --location --silent --show-error --connect-timeout 20 --max-time 300 "https://nodejs.org/dist/v24.22.2/$name.tar.gz" --output "$temporary"
    [ "$(checksum "$temporary")" = "$digest" ] || { echo 'Runtime download checksum mismatch; retain for inspection' >&2; exit 1; }
    mv "$temporary" "$archive"
  fi
  [ "$(checksum "$archive")" = "$digest" ] || { echo 'Cached runtime archive checksum mismatch' >&2; exit 1; }
  target=$cache/tools/$name
  if [ ! -d "$target" ]; then
    claim=$target.lock
    mkdir "$claim" || { echo 'Runtime preparation owner exists; inspect before retrying' >&2; exit 1; }
    printf '%s\n' "$$" > "$claim/owner"
    stage=$cache/tools/.$name.$$.stage
    mkdir "$stage"
    tar -xzf "$archive" -C "$stage"
    mv "$stage/$name" "$target"
    rmdir "$stage"
    [ "$(cat "$claim/owner")" = "$$" ] || { echo 'Runtime preparation ownership changed' >&2; exit 1; }
    rm "$claim/owner"; rmdir "$claim"
  fi
  [ ! -L "$target" ] && [ ! -L "$target/bin/node" ] || { echo 'Runtime cache is a link' >&2; exit 1; }
  # Compare the executable to the pinned archive before executing cached code.
  expected=$cache/downloads/.$name.$$.node
  tar -xOf "$archive" "$name/bin/node" > "$expected"
  [ "$(checksum "$target/bin/node")" = "$(checksum "$expected")" ] || { echo 'Cached Node executable changed' >&2; exit 1; }
  rm "$expected"
  node_program=$target/bin/node
fi
command -v git >/dev/null 2>&1 || { echo 'Git is required on this host; no compatible portable Git is configured' >&2; exit 1; }
ACCEPTANCE_RUNTIME_PATH_PREFIX=$(dirname -- "$node_program")
PATH=$ACCEPTANCE_RUNTIME_PATH_PREFIX:$PATH
export PATH ACCEPTANCE_RUNTIME_PATH_PREFIX
exec "$node_program" "$skill/scripts/setup.mjs"
