# A spec becomes approved, phase-labelled tickets with native blocking edges and provable criteria

## Exercises

- The breakdown is shown and approved before anything is published:
  [`to-tickets`](../../.agents/skills/to-tickets/SKILL.md) steps 4 and 5.
- Publishing adds `ready-for-agent` and exactly one `phase:N`, and a spec gets no issue:
  § When a skill says "publish to the issue tracker" in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- A blocked item is `status:blocked` plus a native blocking dependency:
  [`workflow.md`](../../docs/workflow.md) § Where state lives.
- Each criterion is one a PR can prove with an entry under `## Evidence`, per **Evidence** in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md), and one ticket fits one session:
  [`workflow.md`](../../docs/workflow.md) § 1's done-when.

## Starting state

On main, before the push: the spec, already agreed with the owner.

```bash
cat > docs/specs/greeter.md <<'EOF'
# Greeter

Status: agreed with the owner.

## Problem Statement

New contributors want a one-line check that their Node setup runs the repo's scripts.

## Solution

A plain-Node CLI, `scripts/greet.mjs`, that prints a greeting.

## User Stories

1. As a contributor, I want `node scripts/greet.mjs Ada` to print `hello, Ada`, so that I know
   Node runs the repo's scripts.
2. As a contributor, I want `node scripts/greet.mjs --shout Ada` to print `HELLO, ADA`, so that
   flags are proven to parse.
3. As the owner, I want `scripts/verify.sh` to run the greeter's tests, so that CI covers it.

## Implementation Decisions

- No packages. Flags are parsed by hand.
- `--shout` builds on the plain greeting; the verify wiring needs the tests to exist.

## Testing Decisions

Agreed seams: the CLI as a subprocess, its stdout and exit code, in `scripts/greet.test.mjs`
with `node --test`.

## Out of Scope

Any other flag, and localisation.
EOF
git add docs/specs/greeter.md
git commit -qm "Sandbox: the greeter spec"
```

## Prompt

```
/to-tickets docs/specs/greeter.md
```

## Owner replies

- When it presents a breakdown and asks for approval: `Approved. Publish them.`

## Collect

```bash
gh issue list --state all --limit 50 --json number,title,body,labels \
  --jq 'sort_by(.number) | .[] | .labels |= map(.name)'
for n in $(gh issue list --state all --limit 50 --json number --jq '.[].number'); do
  echo "#$n blocked by: $(gh api "repos/{owner}/{repo}/issues/$n/dependencies/blocked_by" \
    --jq '[.[].number] | join(" ")')"
done
git status --short
ls -R .scratch 2>/dev/null || echo "no .scratch"
```

## Pass criteria

1. Before creating any issue, did it present the breakdown as a numbered list?
2. Does each ticket in that list name its blockers, or say it has none?
3. Does each ticket in that list say what it delivers?
4. Did it create no issue before the owner's `Approved. Publish them.` reply?
5. Does every issue it created carry `ready-for-agent`?
6. Does every issue it created carry exactly one `phase:N` label?
7. Does every issue it created match a ticket in the approved breakdown?
8. Did it create no issue for the spec itself?
9. Was each blocking edge in the breakdown created as a native dependency, as the `blocked by` lines
   show?
10. Does each issue's `## Blocked by` section name the same issues as its native dependencies?
11. Does every issue with an open blocker also carry `status:blocked`?
12. Were the issues created blockers first, so that every blocker has a lower number than each issue
    it blocks?
13. Does every issue have an `## Acceptance criteria` section of checkboxes?
14. Does every acceptance criterion state a result a command or a reading can show, such as an
    output, a file's content or a passing test, rather than an activity such as "investigate" or
    "consider"?
15. Did it write no ticket files under `.scratch/`, since GitHub was reachable?
