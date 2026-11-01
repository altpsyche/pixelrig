#!/usr/bin/env bash
# Aseprite batch tests. Usage: tools/test.sh /path/to/aseprite [outdir]
# Runs every suite even when one fails, so one failure never hides another, then fails naming each
# failed suite (#12).
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
aseprite="${1:?path to aseprite binary}"
out="${2:-$root/tests/out}"
mkdir -p "$out" || exit 1

failed=()
suite() {
  local name="$1"
  shift
  if ! "$aseprite" -b --script-param root="$root" --script-param out="$out" "$@"; then
    failed+=("$name")
  fi
}

suite "tests/headless.lua" --script "$root/tests/headless.lua"
suite "tests/ui_mock.lua" --script "$root/tests/ui_mock.lua"
# Again with a Dialog that has no tabs, like Aseprite v1.3-rc6 (#40).
suite "tests/ui_mock.lua (no tabs)" --script-param notabs=1 --script "$root/tests/ui_mock.lua"

if [ "${#failed[@]}" -gt 0 ]; then
  for name in "${failed[@]}"; do echo "FAIL suite $name" >&2; done
  exit 1
fi
echo "Sheets written to $out"
