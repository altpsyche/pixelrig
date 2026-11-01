# A Reviewer finds a criterion with no Evidence and requests changes, label first

## Exercises

- `/work` confirm-and-stop, then the route to § 3: [`work`](../../.agents/skills/work/SKILL.md).
- **Claim a PR**, **Read back a claim**, **Check out a PR** and **Post a review** in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- The review against a fresh `origin/main`, the strict verdict and `Reviewed at <sha>`:
  [`workflow.md`](../../docs/workflow.md) § 3, and
  [`review-pr`](../../.agents/skills/review-pr/SKILL.md).
- A criterion without an Evidence entry is a finding: [`workflow.md`](../../docs/workflow.md)
  § Review checklist, and **Evidence** in [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- The evidence and coverage tools, run before judging the Evidence and the criteria, and their
  output acted on only as its band allows; the report's `Jev:` lines, one per tool, each quoting
  the tool's first output line: [`workflow.md`](../../docs/workflow.md) § 3 and
  [`jev.md`](../../docs/agents/jev.md). The case holds with or without a `TYPESAFE_API_KEY` in
  the runner's shell: without one each tool prints a skip line; with one it answers.

## Starting state

After bootstrap: issue #1, claimed, and PR #2, which meets both criteria but gives Evidence for
only the first.

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
gh issue edit 1 --add-assignee @me
gh issue comment 1 --body "Claimed: branch 1-contributing-note (session 00000000)"
git switch -qc 1-contributing-note
printf '\n## Contributing\n\nEvery change lands by pull request.\n' >> README.md
git commit -qam "Add a contributing note to the README" -m "Closes #1"
git push -q -u origin HEAD
gh pr create --base main --title "Add a contributing note to the README" \
  --label status:in-review --body-file - <<'EOF'
## Summary

Adds a `## Contributing` section to the end of `README.md`.

Closes #1

## Evidence

- **`README.md` ends with a `## Contributing` section**
  `tail -n 3 README.md` → `## Contributing`
EOF
git switch -q main
```

## Prompt

```
review
```

## Owner replies

- When it names an item and waits for confirmation: `Yes, go ahead.`

## Collect

```bash
echo "pushed by setup: $(git rev-parse 1-contributing-note)"
git ls-remote origin refs/heads/1-contributing-note
gh pr view 2 --json labels,headRefOid --jq '.labels |= map(.name)'
gh api 'repos/{owner}/{repo}/issues/2/timeline' --paginate \
  --jq '.[] | select(.event == "labeled" or .event == "unlabeled" or .event == "commented")
    | pick(.event, .created_at, .label.name, .body)'
```

## Pass criteria

1. Did the session name PR #2 in one line as the next item?
2. Did it stop to wait for the owner's reply before any write?
3. Was its first write after the reply a comment on #2 of the form
   `Claimed: review (session <eight hex characters>)`?
4. After posting that claim, did the read-back of #2's claims it ran show its own claim, carrying
   its session token, as the winner?
5. Did it review from a worktree of its own, not the sandbox folder, whose HEAD was PR #2's head,
   the commit the setup pushed?
6. Did it fetch `origin/main` from the remote during the run, before it took its diff?
7. Was `origin/main` the fixed point of its diff?
8. Does its report contain a finding that the criterion "The section says every change lands by pull
   request" has no entry under `## Evidence`?
9. Does that finding name its source, the review checklist or **Evidence**?
10. Does that finding quote the line it is about?
11. Is the PR labelled `status:changes-requested`?
12. Is the PR no longer labelled `status:in-review`?
13. In #2's timeline, was `status:changes-requested` added before the report comment was posted?
14. Is the first line of the report `Reviewed at <sha>`, with the PR's head sha?
15. Does the report call no finding non-blocking, optional or safe to approve?
16. Does the remote branch still point at the commit the setup pushed?
17. Below its `Reviewed at` line, does the report carry one `Jev:` line each for prune, evidence,
    coverage and verify-findings?
18. Does its `Jev: evidence:` line quote, exactly, the first line `scripts/jev/evidence-cli.mjs`
    printed on #2 in the transcript before the report was posted, a skip or error line included?
19. Does its `Jev: coverage:` line quote, exactly, the first line `scripts/jev/coverage-cli.mjs`
    printed on #2 in the transcript before the report was posted, a skip or error line included?
20. Does its report judge both of #1's acceptance criteria itself, whatever those two tools
    printed?
