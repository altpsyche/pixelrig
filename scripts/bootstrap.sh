#!/usr/bin/env bash
# One-time setup for a repo made from this template: switches on the pre-push hook in this clone,
# offers to save the optional Jev key, creates every label the workflow uses, so no agent ever
# invents a near-duplicate, then protects the default branch and every integration/* branch with a
# ruleset each. Idempotent (`--force` updates labels, each ruleset is updated by name), so rerun it
# after adding a phase to docs/idea.md § Roadmap.
#
#   scripts/bootstrap.sh
#
# Needs `gh`, authenticated, run inside the clone (gh infers the repo from `git remote -v`).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Local git config, so first: it needs no network, and a gh failure below must not skip it.
scripts/install-hooks.sh

# The optional Jev key (ADR-0002), offered on a terminal; set-key.sh --offer asks only when no key
# is set, and always exits 0, so no answer and no failure there stops the setup below.
if [ -t 0 ]; then scripts/jev/set-key.sh --offer || true; fi

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "Creating workflow labels on $repo"

label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null && echo "  $1"; }

# Triage roles: docs/agents/triage-labels.md.
label needs-triage    ededed "Owner needs to evaluate this issue"
label needs-info      d4c5f9 "Waiting on the reporter for more information"
label ready-for-agent  0e8a16 "Fully specified; an implementer model can start"
label ready-for-human fbca04 "Needs human hands"
label wontfix         ffffff "Will not be actioned"

# PR review state: docs/workflow.md § Where state lives.
label status:in-review          1d76db "Waiting for a Reviewer session"
label status:changes-requested  d93f0b "Review found open findings; fix round next"
label status:approved           0e8a16 "Zero open findings; owner merges"
label status:blocked            b60205 "Blocked by another item"

# Priority, set only by the owner; no label means normal: docs/agents/triage-labels.md.
label priority:high  d73a4a "Owner priority: picked before normal and low"
label priority:low   c2e0c6 "Owner priority: picked after normal"

# Phases: one per `### Phase N — Title` under docs/idea.md § Roadmap.
phases="$(awk '/^## /{r=tolower($0) ~ /roadmap/} r && /^### Phase [0-9]+/{print}' docs/idea.md)"
if [ -z "$phases" ]; then
  echo "No '### Phase N — Title' headings under docs/idea.md § Roadmap; no phase labels created." >&2
else
  while IFS= read -r line; do
    n="$(sed -E 's/^### Phase ([0-9]+).*/\1/' <<<"$line")"
    title="$(sed -E 's/^### Phase [0-9]+[[:space:]]*[—–-][[:space:]]*//' <<<"$line")"
    label "phase:$n" c5def5 "$title"
  done <<<"$phases"
fi

# Rulesets, each created or updated by name. One list call, and an id comes only from a list that
# succeeded: a refused call prints its error body on stdout, which is not an id. If the API refuses
# the list (a private repo on a plan without rulesets, auth, network), this warns once with gh's
# message and sets no ruleset, so only the prose rules hold.
rulesets_err="$(mktemp)"
trap 'rm -f "$rulesets_err"' EXIT
if rulesets="$(gh api "repos/$repo/rulesets" --jq '.[] | "\(.id) \(.name)"' 2>"$rulesets_err")"; then
  rulesets_listed=1
else
  rulesets_listed=0
  message="$(tr -s '\n' ' ' <"$rulesets_err")"
  message="${message% }"
  echo "Could not list rulesets, so no branch is protected: ${message:-gh gave no message}." \
    "On a private repo, a plan without rulesets is the usual cause." >&2
fi

# ruleset <name> <what it does, as a sentence with no final stop> <json>: PUTs the ruleset the list
# names <name>, else POSTs a new one. After a refused list it does nothing, since the warning above
# said why. A refused write warns for that ruleset and the setup goes on. Every ruleset goes through
# here, so each gets this guard.
ruleset() {
  local name="$1" what="$2" json="$3" id method endpoint
  [ "$rulesets_listed" = 1 ] || return 0
  id="$(awk -v name="$name" '{ id = $1; sub(/^[^ ]+ /, ""); if ($0 == name) { print id; exit } }' \
    <<<"$rulesets")"
  if [ -n "$id" ]; then
    method=PUT endpoint="repos/$repo/rulesets/$id"
  else
    method=POST endpoint="repos/$repo/rulesets"
  fi
  if gh api -X "$method" "$endpoint" --input - <<<"$json" >/dev/null; then
    echo "Ruleset $name: $what"
  else
    echo "Could not set ruleset $name, so this does not hold: $what." >&2
    echo "The gh error above says why; on a private repo," \
      "a plan without rulesets is the usual cause." >&2
  fi
}

# Protect the default branch: changes land only through a PR with `verify` green and one approving
# review, history stays linear and is never rewritten or deleted. The one bypass actor is the admin
# role, and it exists because every session shares the owner's account, which GitHub forbids from
# approving its own PR: the review verdict is the `status:approved` label (docs/workflow.md § 3),
# and the owner merges with the bypass. The bypass also lets that account push to the branch
# directly, so for agents "nothing is committed to main" stays a rule of the prose
# (docs/workflow.md § 2), not of this ruleset. Named `main` to match the ruleset this repo already
# had, so a run updates it in place.
admin_role_id=5 # GitHub's id for the repository admin role, as a RepositoryRole bypass actor
default_branch_name="main"
default_branch_ruleset="$(cat <<JSON
{
  "name": "$default_branch_name",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [{"actor_id": $admin_role_id, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "required_linear_history"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews_on_push": false,
      "required_reviewers": [],
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false,
      "require_extra_approval_for_unattributed_changes": true,
      "allowed_merge_methods": ["merge", "squash", "rebase"]}},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": true,
      "do_not_enforce_on_create": false,
      "required_status_checks": [{"context": "verify"}]}}
  ]
}
JSON
)"
ruleset "$default_branch_name" \
  "the default branch takes changes only by PR with verify green and one approval, admin bypass aside" \
  "$default_branch_ruleset"

# Protect integration branches (docs/workflow.md § Integration branches): an effort's sub-PRs land
# only by PR with `verify` green, and the history is never rewritten. No approval is required, since
# no session can approve its own account's PR; the `status:approved` label carries the verdict.
# No bypass actors, so agents and owner alike merge sub-PRs through the rules. No deletion rule:
# the branch is deleted once its integration PR merges, and with no bypass it would block the owner.
integration_name="integration-branches"
integration_ruleset="$(cat <<JSON
{
  "name": "$integration_name",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["refs/heads/integration/*"], "exclude": []}},
  "bypass_actors": [],
  "rules": [
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false}},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [{"context": "verify"}]}}
  ]
}
JSON
)"
ruleset "$integration_name" \
  "every integration/* branch takes changes only by PR with verify green, no bypass" \
  "$integration_ruleset"
