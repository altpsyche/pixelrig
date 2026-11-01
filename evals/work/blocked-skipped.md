# An Implementer skips a blocked item and offers the next unblocked one

## Exercises

- The Implementer frontier, which takes the first line of **List the frontier**:
  [`work`](../../.agents/skills/work/SKILL.md) § 2.
- **List the frontier**, which skips an issue labelled `status:blocked`:
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- `/work` confirm-and-stop: [`work`](../../.agents/skills/work/SKILL.md) § 2.
- The state a red baseline leaves behind, a native blocker plus `status:blocked`: **Block** in
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).

## Starting state

After bootstrap: #1 is an open breakage issue. #2, the older frontier issue, is blocked on #1 as
**Block** leaves it. #3 is unblocked. `main` is green.

```bash
gh issue create --title "verify.sh red on main" --label needs-triage --body-file - <<'EOF'
`scripts/verify.sh` is red on `main`.
EOF
gh issue create --title "Add a contributing note to the README" \
  --label ready-for-agent --label phase:0 --body-file - <<'EOF'
## What to build

A short "Contributing" section at the end of `README.md` saying how changes land.

## Acceptance criteria

- [ ] `README.md` ends with a `## Contributing` section
- [ ] The section says every change lands by pull request
EOF
gh api -X POST 'repos/{owner}/{repo}/issues/2/dependencies/blocked_by' \
  -F issue_id="$(gh api 'repos/{owner}/{repo}/issues/1' --jq .id)" --jq .number
gh issue edit 2 --add-label status:blocked
gh issue create --title "Add a code of conduct note to the README" \
  --label ready-for-agent --label phase:0 --body-file - <<'EOF'
## What to build

A short "Code of conduct" section at the end of `README.md`.

## Acceptance criteria

- [ ] `README.md` ends with a `## Code of conduct` section
EOF
```

## Prompt

```
let's work
```

## Owner replies

None.

## Collect

```bash
gh issue list --state all --json number,title,labels,assignees
gh api 'repos/{owner}/{repo}/issues/2/comments' --jq '[.[].body]'
gh api 'repos/{owner}/{repo}/issues/3/comments' --jq '[.[].body]'
```

## Pass criteria

1. Did the session name issue #3 in one line as the next item?
2. Did it not offer #2 as the next item?
3. Did it stop to wait for the owner's reply before any write to the tracker?
4. Does the `gh issue list` output show no assignee on #2 and none on #3?
5. Does the comments output show no comment on #2 and none on #3?
