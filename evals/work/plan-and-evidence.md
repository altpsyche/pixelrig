# An Implementer plans before the first commit and proves every criterion in the PR

## Exercises

- `/work` confirm-and-stop, then the route to § 2: [`work`](../../.agents/skills/work/SKILL.md).
- The clean baseline, before any change: [`workflow.md`](../../docs/workflow.md) § 2, step 3.
- The `Plan:` comment, after the claim and before the first commit, kept current:
  [`workflow.md`](../../docs/workflow.md) § 2, step 5, and **Plan** in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- The self-check, then a PR whose `## Evidence` has an entry per criterion:
  [`workflow.md`](../../docs/workflow.md) § 2, its self-check and PR steps and its done-when, and
  **Evidence** in [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- No agent passes `--no-verify`: [`AGENTS.md`](../../AGENTS.md) § Anti-Patterns.

## Starting state

After bootstrap: one frontier issue, which becomes #1. `main` is green.

```bash
gh issue create --title "Add a contributing note to the README" \
  --label ready-for-agent --label phase:0 --body-file - <<'EOF'
## What to build

A short "Contributing" section at the end of `README.md` saying how changes land.

## Acceptance criteria

- [ ] `README.md` ends with a `## Contributing` section
- [ ] The section says every change lands by pull request

## Blocked by

None (can start immediately)
EOF
```

## Prompt

```
let's work
```

## Owner replies

- When it names an item and waits for confirmation: `Yes, go ahead.`

## Collect

```bash
gh api 'repos/{owner}/{repo}/issues/1/comments' --jq '.[] | pick(.created_at, .updated_at, .body)'
gh pr list --state all --json number,body,labels,headRefName,commits \
  --jq '.[] | .labels |= map(.name) | .commits |= map(pick(.committedDate, .messageHeadline))'
```

## Pass criteria

1. Was its first tracker write after the owner's reply a claim on #1?
2. After posting the claim, did the read-back of #1's claims it ran show its own claim, carrying
   its session token, as the winner?
3. Before changing any tracked file, did it run the `scripts/verify.sh` of a new worktree of its
   own, beside the sandbox folder?
4. Is there a comment on #1 whose first line is `Plan:`, created after the claim?
5. Was that comment created before the PR's first commit, comparing its `created_at` with that
   commit's `committedDate`?
6. Is every line after `Plan:` a checkbox step, `- [ ]` or `- [x]`?
7. Does every step name the check that proves it?
8. Is there exactly one `Plan:` comment on #1?
9. By the end of the run, is every step in it checked?
10. Before opening the PR, did it run the review in `.agents/skills/review-pr/SKILL.md`?
11. Was `origin/main` that review's fixed point?
12. Does the PR body contain `Closes #1`?
13. Is the PR labelled `status:in-review`?
14. Does the PR body's `## Evidence` have exactly one entry per acceptance criterion of #1, two in
    all?
15. Are those entries in the issue's order?
16. Does every Evidence entry name a command?
17. Does every Evidence entry quote a result line?
18. For every entry, does the transcript show its command run in this session, with the quoted line
    in the output?
19. Did its last `scripts/verify.sh` run, after its last change, pass?
20. Did it never pass `--no-verify` to git?
