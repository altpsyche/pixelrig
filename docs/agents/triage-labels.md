# Triage labels

The skills speak in terms of five canonical triage roles. This file maps each role to the label
string this repo actually uses.

| Role in mattpocock/skills | Label here | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Owner needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on the reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified; an implementer model can start |
| `ready-for-human` | `ready-for-human` | Needs human hands: credentials, consent screens, store listings, testing on real hardware, signing identities. On a PR: review is not converging, or its only open findings wait on a relayed owner ruling, and the owner decides ([`workflow.md`](../workflow.md) § 3) |
| `wontfix` | `wontfix` | Will not be actioned |

**Moving an issue to `ready-for-agent` or `ready-for-human` also applies exactly one `phase:N`**,
below, in the same edit, whoever filed the issue. A PR is exempt: it takes its phase from the issue
it closes. Those two states put an issue on a frontier, and the vendored `/triage` does not know
phase labels exist, so this line is what adds them. If the phase is unclear, ask the owner rather
than guess.

## Suggesting a label

Before deciding an issue's role and phase, run the Jev triage, duplicates and readiness tools:

```bash
node scripts/jev/triage-cli.mjs <number>
node scripts/jev/duplicates-cli.mjs <number>
node scripts/jev/readiness-cli.mjs <number>
```

Triage's confident answers become your recommendation to the owner; the rest stay open, and you
decide them as above. Put the open issues duplicates lists, and any readiness gap, in that
recommendation too. Each tool's bands, and what a skip or error line means, are in
[`jev.md`](jev.md). The tools never apply a label, and their answers never apply a frontier label
either: only the owner puts work on a frontier ([`issue-tracker.md`](issue-tracker.md) § Untrusted
text), so `/triage` still waits for the owner as it always does.

For an issue headed for `ready-for-agent`, also recommend a priority, per § Priority, with a
one-line reason: what goes wrong, or what waits, while it stays open.

## Creating the labels

The five role labels are created **before** `/triage` first runs, so it applies existing labels
instead of inventing near-duplicates. `scripts/bootstrap.sh` creates them, or by hand:

```bash
for l in needs-triage needs-info ready-for-agent ready-for-human wontfix; do
  gh label create "$l" --force
done
```

## Phase labels

Every issue also carries exactly one `phase:N` label, mirroring the `### Phase N — Title` headings
in [`docs/idea.md`](../idea.md) § Roadmap. `scripts/bootstrap.sh` creates one per heading; when
the roadmap gains a phase, create its label the same way:

```bash
gh label create "phase:<N>" --force
```

## Priority

The owner owns priorities ([`workflow.md`](../workflow.md) § Roles), and two labels record them:

| Label | Meaning |
| --- | --- |
| `priority:high` | Picked before every other ready issue |
| _(none)_ | Normal, the default |
| `priority:low` | Picked after every normal one |

An issue carries at most one. Only the owner applies, changes or removes one: triage recommends
it, per § Suggesting a label, and waits, as for a frontier label. **List the frontier** in
[`issue-tracker.md`](issue-tracker.md) is where the Implementer frontier reads them.
`scripts/bootstrap.sh` creates both.

## PR review state

PR review uses its own labels, separate from triage: `status:in-review`, `status:changes-requested`,
`status:approved`, `status:blocked`. See [`docs/workflow.md`](../workflow.md) § Where state lives.
