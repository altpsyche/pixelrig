#!/usr/bin/env bash
# Headless render test. Usage: tools/test.sh /path/to/aseprite [outdir]
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
aseprite="${1:?path to aseprite binary}"
out="${2:-$root/tests/out}"
mkdir -p "$out"
"$aseprite" -b --script-param root="$root" --script-param out="$out" --script "$root/tests/headless.lua"

"$aseprite" -b --script-param root="$root" --script-param out="$out" --script "$root/tests/ui_mock.lua"
# Again with a Dialog that has no tabs, like Aseprite v1.3-rc6 (#40).
"$aseprite" -b --script-param root="$root" --script-param out="$out" --script-param notabs=1 --script "$root/tests/ui_mock.lua"
echo "Sheets written to $out"
