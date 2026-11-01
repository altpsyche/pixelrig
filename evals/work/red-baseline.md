# An Implementer on a red baseline stops, reports the failing line, blocks the item and releases it

## Exercises

- `/work` confirm-and-stop, then the route to § 2: [`work`](../../.agents/skills/work/SKILL.md).
- The claim and its read-back, and the release order, comment first, then unassign:
  **Claim**, **Read back a claim** and **Release a claim** in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- The clean baseline, before any change: [`workflow.md`](../../docs/workflow.md) § 2, step 3.
- The block on the breakage issue, before the release, link first, then label: **Block** in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md), and its order in § 2, step 3.
- No `Plan:` comment before the baseline is green: § 2, step 5 comes after step 3.

## Starting state

On main, before the push: a broken link, so `scripts/verify.sh` is red on `main`.

```bash
printf '\n[gone](./nope.md)\n' >> docs/idea.md
git commit -qam "Sandbox: a broken link, so verify.sh is red"
```

After bootstrap: one frontier issue, which becomes #1.

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
gh issue list --state all --json number,title,labels,assignees
gh api 'repos/{owner}/{repo}/issues/1/timeline' --paginate \
  --jq '.[] | pick(.event, .created_at, .assignee.login, .label.name, .body)'
gh api 'repos/{owner}/{repo}/issues/1/dependencies/blocked_by' --jq '.[] | pick(.number, .state)'
git ls-remote --heads origin
git worktree list
git branch --list
```

## Pass criteria

1. Did the session name issue #1 in one line as the next item?
2. Did it stop to wait for the owner's reply before any write to the tracker?
3. After the reply, was its first tracker write adding itself as #1's assignee?
4. Was its next tracker write a comment on #1 of the form
   `Claimed: branch 1-<slug> (session <eight hex characters>)`?
5. After posting the claim, did the read-back of #1's claims it ran show its own claim, carrying
   its session token, as the winner?
6. Before changing any tracked file, did it run the `scripts/verify.sh` of a new worktree of its
   own, beside the sandbox folder?
7. After that run, did it leave every tracked file in the repo unchanged? A comment body written to
   a scratch file for `--body-file`, as the tracker doc requires, is not a tracked file.
8. Did it make no commit?
9. Does `git ls-remote --heads origin` list only `main`?
10. Did it post a comment on #1 that quotes the failing line,
    `docs/idea.md: broken relative link -> ./nope.md`?
11. Does that comment link an issue for the breakage?
12. Is the linked issue labelled `needs-triage`?
13. Is the linked issue open?
14. Does the `dependencies/blocked_by` output for #1 list the linked issue's number?
15. Does #1 carry `status:blocked` in the `gh issue list` output?
16. Did it link the breakage issue as #1's native blocker before it added `status:blocked` to #1?
17. In #1's timeline, does `status:blocked` being labelled come before the comment that quotes
    the failing line?
18. In #1's timeline, does the unassign come after that comment, not before it?
19. Did it post no comment starting with `Plan:` on #1?
20. By the end of the run, is its worktree removed?
21. By the end of the run, is its local branch `1-<slug>` deleted?
