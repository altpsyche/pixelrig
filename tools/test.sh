#!/usr/bin/env bash
# Headless render test. Usage: tools/test.sh /path/to/aseprite [outdir]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
aseprite="${1:?path to aseprite binary}"
out="${2:-$root/tests/out}"
mkdir -p "$out"
"$aseprite" -b --script-param root="$root" --script-param out="$out" --script "$root/tests/headless.lua"
echo "Sheets written to $out"
