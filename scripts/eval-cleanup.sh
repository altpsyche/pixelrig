#!/usr/bin/env bash
# Deletes the eval sandboxes a merged PR used, per evals/README.md § Sandbox. The session that merges
# the PR runs it from the main clone's root, per docs/workflow.md § 5:
#
#   scripts/eval-cleanup.sh <pr>
#
# The PR body is untrusted text. From its `## Evidence` section only, it takes each word that follows
# `run ` and is eight lowercase hex digits, the token scripts/eval-sandbox.sh prints. It deletes the
# repo eval-<token> only when all of these hold, and says why when one does not:
#
#   - the PR is merged;
#   - the repo resolves to that exact name, owned by the account gh is logged in as;
#   - it is private;
#   - its description is exactly the marker eval-sandbox.sh sets:
#     eval-sandbox run <token> from <40-hex source commit>
#
# Beside the main clone it removes only the folders eval-<token> and eval-<token>-<n>, real folders
# and not links, and only for a listed token whose repo it deleted or that does not exist. Then it
# lists, never deletes, every other eval-* repo of the account older than 7 days, for the owner to
# decide. It exits 1 when a lookup or delete failed, after doing the rest. Needs gh, authenticated
# with the delete_repo scope, and git.
set -euo pipefail

usage() { echo "usage: scripts/eval-cleanup.sh <pr>" >&2; exit 2; }
[ $# -eq 1 ] || usage
[[ $1 =~ ^[1-9][0-9]*$ ]] || usage
pr="$1"

# The main clone, whether run from it or from one of its worktrees, and the folder that holds it.
# Its own step, so a failed read stops the script: dirname of nothing is `.`, the current folder.
# Only a main clone's common dir is <main clone>/.git; anything else, such as a bare repository,
# has no main clone to remove folders beside.
no_main_clone() {
  echo "eval-cleanup: run it from the main clone or one of its worktrees; no main clone found from $PWD" >&2
  exit 1
}
common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || no_main_clone
case "$common_dir" in /*/.git) ;; *) no_main_clone ;; esac
[ -d "$common_dir" ] && [ ! -L "$common_dir" ] || no_main_clone
main_clone="${common_dir%/.git}"
[ "$(git -C "$main_clone" rev-parse --is-bare-repository 2>/dev/null)" = false ] || no_main_clone
beside="$(dirname "$main_clone")"

me="$(gh api user --jq .login)"
[[ $me =~ ^[A-Za-z0-9-]+$ ]] || { echo "eval-cleanup: could not read the logged-in account" >&2; exit 1; }

state="$(gh pr view "$pr" --json state --jq .state)"
if [ "$state" != MERGED ]; then
  echo "eval-cleanup: PR #$pr is $state, not merged; nothing deleted" >&2
  exit 1
fi

# The Evidence section: from its heading to the next `## ` heading. Each word after `run`, split on
# anything but letters, digits and `_`, is a candidate; only eight lowercase hex digits is a token.
# The body is read first, so a failed read stops the script rather than reading as no runs.
body="$(gh pr view "$pr" --json body --jq .body)"
tokens=()
while IFS= read -r word; do
  if [[ $word =~ ^[0-9a-f]{8}$ ]]; then tokens+=("$word"); fi
done < <(
  printf '%s\n' "$body" | tr -d '\r' |
    awk '/^## /{ on = ($0 ~ /^## Evidence[ \t]*$/); next } on' |
    tr -cs '[:alnum:]_' '\n' |
    awk 'prev == "run" { print } { prev = $0 }' |
    sort -u
)

status=0

# Removes eval-<token> and eval-<token>-<n> beside the main clone: real folders only, never the main
# clone itself.
remove_folders() {
  local t="$1" d base
  for d in "$beside/eval-$t" "$beside/eval-$t"-*; do
    base="${d##*/}"
    [[ $base =~ ^eval-$t(-[0-9]+)?$ ]] || continue
    [ -d "$d" ] && [ ! -L "$d" ] && [ "$d" != "$main_clone" ] || continue
    rm -rf -- "$d"
    echo "eval-cleanup: removed $d"
  done
}

if [ ${#tokens[@]} -eq 0 ]; then
  echo "eval-cleanup: PR #$pr lists no run in its Evidence"
fi

errors="$(mktemp)"
trap 'rm -f "$errors"' EXIT

for t in ${tokens[@]+"${tokens[@]}"}; do
  name="eval-$t"
  if ! fields="$(gh repo view "$me/$name" --json nameWithOwner,visibility,description \
    --jq '[.nameWithOwner, .visibility, (.description // "")] | @tsv' 2>"$errors")"; then
    if grep -q 'Could not resolve to a Repository' "$errors"; then
      echo "eval-cleanup: no repo $me/$name"
      remove_folders "$t"
    else
      echo "eval-cleanup: could not look up $me/$name, kept it and its folders: $(head -n 1 "$errors")" >&2
      status=1
    fi
    continue
  fi
  IFS=$'\t' read -r nwo visibility description <<<"$fields"
  owner="${nwo%%/*}"
  repo="${nwo#*/}"
  why=
  if [ "$repo" != "$name" ] || ! [[ $repo =~ ^eval-[0-9a-f]{8}$ ]]; then
    why="it resolves to $nwo"
  elif [ "$owner" != "$me" ]; then
    why="it is owned by $owner, not $me"
  elif [ "$visibility" != PRIVATE ]; then
    why="it is $visibility, not PRIVATE"
  elif ! [[ $description =~ ^eval-sandbox\ run\ $t\ from\ [0-9a-f]{40}$ ]]; then
    why="its description is not the marker for run $t"
  fi
  if [ -n "$why" ]; then
    echo "eval-cleanup: kept $me/$name and its folders: $why"
    continue
  fi
  if gh repo delete "$nwo" --yes; then
    echo "eval-cleanup: deleted $nwo"
    remove_folders "$t"
  else
    echo "eval-cleanup: could not delete $nwo, kept its folders" >&2
    status=1
  fi
done

# Other eval-* repos older than 7 days: listed for the owner, never deleted.
if old="$(gh repo list "$me" --limit 1000 --json name,createdAt \
  --jq '(now - 604800 | todate) as $cutoff | .[] | select((.name | startswith("eval-")) and .createdAt < $cutoff) | [.name, .createdAt] | @tsv')"; then
  while IFS=$'\t' read -r name created; do
    [ -n "$name" ] || continue
    case " ${tokens[*]+"${tokens[*]}"} " in *" ${name#eval-} "*) continue ;; esac
    echo "eval-cleanup: older than 7 days, not deleted: $me/$name, created $created"
  done <<<"$old"
else
  echo "eval-cleanup: could not list $me's repos for older sandboxes" >&2
  status=1
fi

exit "$status"
