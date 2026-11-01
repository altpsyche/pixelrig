#!/usr/bin/env bash
# Builds the sandbox for one eval case, exactly as evals/README.md § Sandbox defines it: a private
# GitHub repo whose main is one commit holding this checkout's tree without the case folders, with
# the case's Starting state blocks run as written at their steps. evals/README.md stays the
# definition; this script types it for the runner.
#
#   <checkout>/scripts/eval-sandbox.sh <case>
#
# <case> is a path relative to this checkout's root, such as evals/work/red-baseline.md, or an
# absolute one. The checkout is the branch under test, everything committed. The sandbox is
# ../eval-<token> beside it, and the repo's description marks it as a sandbox, naming the run token
# and the source commit, so the cleanup at merge can prove it is one:
#
#   eval-sandbox run <token> from <40-hex source commit>
#
# It names the token and sandbox on stderr as soon as the token exists. Its last lines are
# `token: <token>`, `path: <sandbox>` and `prompt:` followed by the prompt. Any failure stops it:
# the run is void, not graded (evals/README.md § Running a case). A failure once the repo may exist
# prints `token:` and `path:` again on stderr, with a note to list the token in the PR's Evidence
# as void. Needs gh, authenticated, git, node and openssl.
set -euo pipefail
shopt -s inherit_errexit # a parse that fails inside $(…) stops the script too

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ $# -eq 1 ] || { echo "usage: scripts/eval-sandbox.sh <case>" >&2; exit 2; }
case "$1" in /*) case_file="$1" ;; *) case_file="$root/$1" ;; esac

# Read the whole case before anything is built, so a case the parser cannot read builds nothing.
parse() { node "$root/scripts/eval-case.mjs" "$1" "$case_file"; }
parse check
before_push="$(parse before-push; echo .)"
after_bootstrap="$(parse after-bootstrap; echo .)"
prompt="$(parse prompt; echo .)"

if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "eval-sandbox: $root has uncommitted changes; commit everything first, since the sandbox is built from HEAD" >&2
  exit 1
fi

# A step's block, run as one script in the sandbox, as the runner would type it there, with the
# runner's T and S set. It stops at the first command that fails.
step() {
  local block="${1%.}"
  [ -n "$block" ] || return 0
  T="$T" S="$source_sha" bash -e -o pipefail -c "$block" </dev/null
}

T="$(openssl rand -hex 4)"
source_sha="$(git -C "$root" rev-parse HEAD)"
sandbox="$(dirname "$root")/eval-$T"
echo "eval-sandbox: run $T, sandbox $sandbox" >&2

# From `gh repo create` on, a marked repo may exist. If anything after it fails, the run is void,
# and the repo must still be named, so the runner lists its token in the PR's Evidence and the
# cleanup at merge finds it.
void_note() {
  local status=$?
  [ "$status" -eq 0 ] && return
  printf 'token: %s\npath: %s\n' "$T" "$sandbox" >&2
  echo "eval-sandbox: eval-$T exists on GitHub, or may if gh repo create failed, but its setup" \
    "failed, so the run is void; list token $T in the PR's Evidence as void" >&2
  exit "$status"
}

mkdir "$sandbox"
git -C "$root" archive HEAD -- . ':(exclude,glob)evals/*/**' | tar -x -C "$sandbox"
cd "$sandbox"
git init -q -b main
git add -A && git commit -qm "Sandbox"
step "$before_push"
trap void_note EXIT
gh repo create "eval-$T" --private --source . --remote origin --push \
  --description "eval-sandbox run $T from $source_sha"
scripts/bootstrap.sh </dev/null
step "$after_bootstrap"
trap - EXIT

printf 'token: %s\npath: %s\nprompt:\n%s' "$T" "$sandbox" "${prompt%.}"
