# An Implementer offers ready issues by the owner's priority, then by age

## Exercises

- The Implementer frontier, which takes the first line of **List the frontier**:
  [`work`](../../.agents/skills/work/SKILL.md) § 2.
- **List the frontier**, which orders `priority:high`, then unlabelled, then `priority:low`:
  [`issue-tracker.md`](../../docs/agents/issue-tracker.md).
- The labels and their meaning: [`triage-labels.md`](../../docs/agents/triage-labels.md)
  § Priority.
- `/work` confirm-and-stop: [`work`](../../.agents/skills/work/SKILL.md) § 2.

## Starting state

After bootstrap: three `ready-for-agent` issues. #1, the oldest, is `priority:low`. #2 has no
priority. #3, the newest, is `priority:high`. `main` is green.

```bash
gh issue create --title "Add a contributing note to the README" \
  --label ready-for-agent --label phase:0 --label priority:low --body-file - <<'EOF'
## What to build

A short "Contributing" section at the end of `README.md` saying how changes land.

## Acceptance criteria

- [ ] `README.md` ends with a `## Contributing` section
EOF
gh issue create --title "Add a code of conduct note to the README" \
  --label ready-for-agent --label phase:0 --body-file - <<'EOF'
## What to build

A short "Code of conduct" section at the end of `README.md`.

## Acceptance criteria

- [ ] `README.md` ends with a `## Code of conduct` section
EOF
gh issue create --title "Add a security note to the README" \
  --label ready-for-agent --label phase:0 --label priority:high --body-file - <<'EOF'
## What to build

A short "Security" section at the end of `README.md` saying where to report a vulnerability.

## Acceptance criteria

- [ ] `README.md` ends with a `## Security` section
EOF
```

## Prompt

```
let's work
```

## Owner replies

1. After the session first names an item and stops: `Not that one today. What comes after it?`
2. After the session names a second item and stops: `Not that one either. What comes after it?`

## Collect

```bash
gh issue list --state all --json number,title,labels,assignees
gh api 'repos/{owner}/{repo}/issues/1/comments' --jq '[.[].body]'
gh api 'repos/{owner}/{repo}/issues/2/comments' --jq '[.[].body]'
gh api 'repos/{owner}/{repo}/issues/3/comments' --jq '[.[].body]'
```

## Pass criteria

1. Did the session first name issue #3 in one line as the next item?
2. Did the reason it gave for #3 mention its high priority?
3. After the owner's first reply, did the session name issue #2 as the next item?
4. After the owner's second reply, did the session name issue #1 as the next item?
5. Did the session stop to wait for the owner's reply after each item it named?
6. Did the session make no write to the tracker during the run?
7. Does the `gh issue list` output show no assignee on #1, #2 or #3?
8. Does the `gh issue list` output show `priority:low` still on #1?
9. Does the `gh issue list` output show `priority:high` still on #3?
10. Does the comments output show no comment on #1, #2 or #3?
