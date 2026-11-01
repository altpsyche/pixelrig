#!/usr/bin/env bash
# PixelRig's project checks, run by scripts/verify.sh (and so by CI and the pre-push hook).
#   tools/check.sh                       Lua syntax, pure-Lua tests, clip/rig JSON, release gate,
#                                        release archive, tools/test.sh self-test
#   ASEPRITE=/path/to/aseprite tools/check.sh   plus the Aseprite batch tests
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Lua: every extension and test file compiles. Aseprite embeds Lua 5.4, so prefer luac5.4.
luac_bin="$(command -v luac5.4 || command -v luac || true)"
if [ -n "$luac_bin" ]; then
  "$luac_bin" -p ./*.lua tests/*.lua
else
  echo "verify: luac not found, Lua syntax check skipped (CI runs it)" >&2
fi

# Pure-Lua tests (tests/pure.lua; its header lists what they cover): no Aseprite, so CI runs them
# (#12). Only a Lua 5.4 interpreter, as Aseprite embeds.
lua_bin="$(command -v lua5.4 || true)"
if [ -z "$lua_bin" ] && command -v lua >/dev/null && [ "$(lua -e 'io.write(_VERSION)')" = "Lua 5.4" ]; then
  lua_bin="$(command -v lua)"
fi
if [ -n "$lua_bin" ]; then
  "$lua_bin" tests/pure.lua
else
  echo "verify: no Lua 5.4 interpreter, pure-Lua tests skipped (CI runs them)" >&2
fi

# Clips and rigs: every JSON file parses.
if command -v node >/dev/null; then
  node -e 'const fs = require("fs");
    for (const f of process.argv.slice(1)) {
      try { JSON.parse(fs.readFileSync(f, "utf8")); }
      catch (e) { console.error(`verify: ${f}: ${e.message}`); process.exit(1); }
    }' clips/*.json rigs/*.json
fi

# Release gate (tools/release-check.sh), which the Release workflow runs before it publishes: its
# own test, and every release's notes in docs/releases/ checked against their tag.
if command -v node >/dev/null && command -v git >/dev/null; then
  node --test tools/release-check.test.mjs
else
  echo "verify: node or git not found, release gate test skipped (CI runs it)" >&2
fi

# Release archive: package.json at its root, only the extension inside (tools/check-archive.sh).
if command -v zip >/dev/null && command -v unzip >/dev/null; then
  archive="$(tools/package.sh | grep '\.zip$')"
  tools/check-archive.sh "$archive"
  # Self-test: the guard refuses an archive carrying a file outside the extension.
  bad="$(mktemp -d)/bad.zip"
  cp "$archive" "$bad"
  zip -q "$bad" AGENTS.md
  if tools/check-archive.sh "$bad" 2>/dev/null; then
    echo "verify: tools/check-archive.sh accepted an archive with AGENTS.md in it" >&2
    exit 1
  fi
  rm -rf "$(dirname "$bad")"
else
  echo "verify: zip/unzip not found, package check skipped (CI runs it)" >&2
fi

# Self-test: tools/test.sh runs every Aseprite suite and fails at the end when any failed, naming
# each, so one failure never hides another (#12); with every suite passing it passes. A stub
# aseprite logs each suite it runs and fails them all when STUB_FAIL is set.
stub="$(mktemp -d)"
trap 'rm -rf "$stub"' EXIT
cat >"$stub/aseprite" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$(dirname "$0")/ran.log"
[ -z "${STUB_FAIL:-}" ]
STUB
chmod +x "$stub/aseprite"
if ! tools/test.sh "$stub/aseprite" "$stub/out" >/dev/null 2>&1; then
  echo "verify: tools/test.sh failed although every Aseprite suite passed" >&2
  exit 1
fi
rm -f "$stub/ran.log"
if failed="$(STUB_FAIL=1 tools/test.sh "$stub/aseprite" "$stub/out" 2>&1 >/dev/null)"; then
  echo "verify: tools/test.sh passed although every Aseprite suite failed" >&2
  exit 1
fi
ran="$(cat "$stub/ran.log" 2>/dev/null || true)"
if [ "$(grep -c 'headless\.lua' <<<"$ran")" != 1 ] || [ "$(grep -c 'ui_mock\.lua' <<<"$ran")" != 2 ] ||
  [ "$(grep -c '^FAIL suite ' <<<"$failed")" != 3 ]; then
  echo "verify: tools/test.sh did not run and report every failing Aseprite suite; it ran:" >&2
  echo "${ran:-nothing}" >&2
  echo "and reported: ${failed:-nothing}" >&2
  exit 1
fi

# Aseprite batch tests: build, render, apply (tests/headless.lua) and the dialog through a mock
# (tests/ui_mock.lua). Needs an Aseprite binary: $ASEPRITE, or aseprite on PATH. CI has none.
aseprite_bin="${ASEPRITE:-$(command -v aseprite || true)}"
if [ -n "$aseprite_bin" ]; then
  if ! test_log="$(tools/test.sh "$aseprite_bin" 2>&1)"; then
    grep -E 'FAIL|rror' <<<"$test_log" >&2 || echo "$test_log" >&2
    echo "verify: Aseprite tests failed" >&2
    exit 1
  fi
else
  echo "verify: no Aseprite binary (set ASEPRITE), Aseprite tests skipped" >&2
fi
