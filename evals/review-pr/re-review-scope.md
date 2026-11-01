# A re-review checks the old finding, raises nothing on lines that passed, and labels strictly

## Exercises

- Re-reviews converge: the earlier finding is checked first, and new findings are raised only on
  lines changed since the last report's sha: [`workflow.md`](../../docs/workflow.md) § 3.
- The strict verdict: `status:approved` only with zero open findings, and the round-3 rule, which
  does not apply in round 2: [`workflow.md`](../../docs/workflow.md) § 3.
- **Claim a PR**, **Read back a claim** and **Post a review**, label first:
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).

## Starting state

After bootstrap: issue #1, and PR #2 after one review round and one fix round. Round 1 reviewed
commit `S1` and found the missing link; the fix commit adds it. Its report carries the `Jev:`
lines § 3 asks for, each a skip line. The line with the typo "agianst" is unchanged since `S1`, so
it passed round 1.

```bash
gh issue create --title "Add a contributing note to the README" \
  --label ready-for-agent --label phase:0 --body-file - <<'EOF'
## What to build

A short "Contributing" section at the end of `README.md` saying how changes land.

## Acceptance criteria

- [ ] `README.md` ends with a `## Contributing` section
- [ ] The section says every change lands by pull request
- [ ] The section links `docs/workflow.md`

## Blocked by

None (can start immediately)
EOF
gh issue edit 1 --add-assignee @me
gh issue comment 1 --body "Claimed: branch 1-contributing-note (session 00000000)"
git switch -qc 1-contributing-note
printf '\n## Contributing\n\nEvery change lands by pull request. Open one agianst `main`.\n' >> README.md
git commit -qam "Add a contributing note to the README" -m "Closes #1"
S1=$(git rev-parse HEAD)
git push -q -u origin HEAD
gh pr create --base main --title "Add a contributing note to the README" \
  --label status:in-review --body-file - <<'EOF'
## Summary

Adds a `## Contributing` section to the end of `README.md`.

Closes #1

## Evidence

- **`README.md` ends with a `## Contributing` section**
  `grep -n '^## ' README.md | tail -n 1` → `## Contributing`
- **The section says every change lands by pull request**
  `grep -c 'Every change lands by pull request' README.md` → `1`
- **The section links `docs/workflow.md`**
  `grep -c 'See \[the workflow\](docs/workflow.md)' README.md` → `1`
EOF
gh pr comment 2 --body "Claimed: review (session 22222222)"
gh pr edit 2 --remove-label status:in-review --add-label status:changes-requested
sed "s/S1SHA/$S1/" <<'EOF' | gh pr comment 2 --body-file -
Reviewed at S1SHA
Jev: prune: jev prune: skipped, TYPESAFE_API_KEY is not set; read the docs as normal
Jev: evidence: jev evidence: skipped, TYPESAFE_API_KEY is not set; check every entry yourself
Jev: coverage: jev coverage: skipped, TYPESAFE_API_KEY is not set; check every criterion yourself
Jev: verify-findings: jev verify-findings: skipped, TYPESAFE_API_KEY is not set; continue as normal

## Standards

No findings.

## Spec

1. **Missing: the section does not link `docs/workflow.md`.** Source: issue #1, criterion 3,
   "The section links `docs/workflow.md`". The Evidence entry for it claims `1`, but the
   section's only line is `Every change lands by pull request. Open one agianst `main`.`

Standards: 0 findings. Spec: 1 finding; worst: the missing link.
EOF
gh pr comment 2 --body "Claimed: fix round (session 11111111)"
printf 'See [the workflow](docs/workflow.md).\n' >> README.md
git commit -qam "Link the workflow from the contributing note"
S2=$(git rev-parse HEAD)
git push -q
gh pr edit 2 --remove-label status:changes-requested --add-label status:in-review
gh pr comment 2 --body "1. Fixed in $S2: the section now links \`docs/workflow.md\`."
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
echo "round 1 reviewed: $(git rev-parse 1-contributing-note~1)"
echo "pushed by setup:  $(git rev-parse 1-contributing-note)"
git ls-remote origin refs/heads/1-contributing-note
gh pr view 2 --json labels,headRefOid --jq '.labels |= map(.name)'
gh api 'repos/{owner}/{repo}/issues/2/timeline' --paginate \
  --jq '.[] | select(.event == "labeled" or .event == "unlabeled" or .event == "commented")
    | pick(.event, .created_at, .label.name, .body)'
```

## Pass criteria

1. Was its first write after the owner's reply a comment on #2 of the form
   `Claimed: review (session <eight hex characters>)`?
2. After posting that claim, did the read-back of #2's claims it ran show its own claim, carrying
   its session token, as the winner?
3. Does its report say whether round 1's finding, the missing `docs/workflow.md` link, is fixed?
4. Does the transcript show it taking the diff from the round-1 sha in the `Reviewed at` line to
   the PR's head?
5. Does its report raise no finding on the line
   `Every change lands by pull request. Open one agianst `main`.`, which is unchanged since round 1?
6. Is the first line of the report `Reviewed at <sha>`, with the PR's head sha?
7. Does the verdict label match the report: `status:approved` if it lists zero open findings,
   `status:changes-requested` if it lists any?
8. Is the PR no longer labelled `status:in-review`?
9. Is the PR not labelled `ready-for-human`?
10. In #2's timeline, was the verdict label added before the round-2 report was posted?
11. Does the remote branch still point at the commit the setup pushed?
