#!/usr/bin/env bash
# Runs one eval case's `## Collect` commands in its sandbox, one by one, and appends each command and
# its output to the run's transcript, for the grader (evals/README.md § Running a case, step 6).
#
#   <checkout>/scripts/eval-collect.sh <case> <token> <transcript>
#
# <case> is resolved as eval-sandbox.sh resolves it; the sandbox is ../eval-<token> beside this
# checkout, as eval-sandbox.sh built it. Under a `## Collect, run <token>` heading, each command
# gets its own fenced block: `$ ` and the command as the case writes it, then its output, stdout and
# stderr together, then `(exit <n>)` when it did not exit 0. A failing command is recorded, not
# fatal: its output is evidence too. A case it cannot parse, a malformed token or a missing sandbox
# appends nothing and exits 1.
set -euo pipefail
shopt -s inherit_errexit

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ $# -eq 3 ] || { echo "usage: scripts/eval-collect.sh <case> <token> <transcript>" >&2; exit 2; }
case "$1" in /*) case_file="$1" ;; *) case_file="$root/$1" ;; esac
token="$2"
transcript="$(realpath -m -- "$3")"

[[ "$token" =~ ^[0-9a-f]{8}$ ]] || { echo "eval-collect: the token must be eight hex digits, got: $token" >&2; exit 1; }
sandbox="$(dirname "$root")/eval-$token"
[ -d "$sandbox" ] || { echo "eval-collect: no sandbox at $sandbox; the run is void (evals/README.md § Running a case)" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
node "$root/scripts/eval-case.mjs" collect "$case_file" >"$work/commands"

printf '\n## Collect, run %s\n' "$token" >>"$transcript"
while IFS= read -r -d '' command; do
  status=0
  (cd "$sandbox" && bash -c "$command") </dev/null >"$work/output" 2>&1 || status=$?
  # The fence outgrows every backtick run in the command or its output, so neither can close it.
  longest="$( { printf '%s\n' "$command"; cat "$work/output"; } | { grep -oE '`+' || true; } | awk '{ if (length > n) n = length } END { print n + 0 }')"
  fence="$(printf '%*s' "$(( longest < 3 ? 3 : longest + 1 ))" '' | tr ' ' '`')"
  {
    printf '\n%sconsole\n$ %s\n' "$fence" "$command"
    cat "$work/output"
    [ -z "$(tail -c 1 "$work/output")" ] || echo
    [ "$status" -eq 0 ] || echo "(exit $status)"
    echo "$fence"
  } >>"$transcript"
done <"$work/commands"
echo "eval-collect: appended the Collect output of eval-$token to $transcript"
