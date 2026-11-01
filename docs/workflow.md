# Development & Review Workflow

How work moves from idea to merged change. Skills live in
[`.agents/skills/`](../.agents/skills/README.md); the human is the index that reaches for them.

Session start is [`/work`](../.agents/skills/work/SKILL.md): it picks the role and the next item,
confirms both with the owner, then runs the role's step below. See § Starting a session.

## Roles

| Role | Owns | Never does |
|---|---|---|
| **Owner** (human) | Priorities, ADRs, merging, anything on the `ready-for-human` list | Waits on an agent for a decision it could make |
| **Planner** | Sharpening the idea, the spec, the ticket breakdown | Does the implementation work |
| **Implementer** | One ticket, test-first, on a branch | Touches an unrelated file, or merges |
| **Reviewer** | Two-axis review of the diff since a fixed point | Edits the branch under review |

One agent may hold several roles in a session, but never Implementer and Reviewer for the same diff.
A review by the author of the change is not a review: the Implementer's own `/review-pr` at the end
of `/implement` is a self-check, and the review is § 3, run by another session.

In the steps below, a bold name that opens a numbered step or follows "then" or "per" (**Claim**,
**Read back a claim** and the rest) is a command in
[`docs/agents/issue-tracker.md`](agents/issue-tracker.md), which holds its exact form.

## The loop

```
idea → grill → spec → tickets → implement (tdd) → review → fix rounds → merge → retro
        ↑                                                                      ↓
        └──────────────── environment improves ────────────────────────────────┘
```

The last arrow is the point. A `retro` that changes nothing about the environment is a status report.

## Steps

### 1. Plan (Planner)

Reach for `/grill-with-docs` when a repo exists to leave a paper trail in, `/grill-me` when it does
not. It interrogates a frontier of decisions one round at a time, writing terms to `GLOSSARY.md` and
hard-to-reverse choices to `docs/adr/` as they land.

Then `/to-spec` synthesises what was already discussed into `docs/specs/<slug>.md`. It does not
interview; the grilling already did. Then `/to-tickets` cuts the spec into **tracer-bullet** tickets,
each declaring its blocking edges, and publishes them to the tracker with `ready-for-agent` or
`ready-for-human`.

**Done when:** every ticket is small enough for one session, its blockers are declared, and the owner
has confirmed the spec's testing seams.

### 2. Implement (Implementer) — `/implement`

1. **Claim** the issue as the first write, then **Read back a claim**, so two sessions never
   collide. If you do not hold it, back off as that command says.
2. **Branch** as `<n>-<slug>` in a new **Worktree** based on a freshly fetched `origin/main`, or
   `origin/integration/<name>` for a ticket in an integration effort (§ Integration branches).
   Nothing is committed to `main` or to an integration branch.
3. Clean baseline: before any change, run the fresh worktree's `scripts/verify.sh` by path, per
   the Conventions in [`docs/agents/issue-tracker.md`](agents/issue-tracker.md), so breakage you
   inherit is never mistaken for yours. If it is red, do not start. Find the issue for
   the breakage; when none exists, file one per **Create**, labelled `needs-triage`. The fix is
   its own ticket, not part of this one. Then, in this order, per **Block** and **Release a
   claim**: link the breakage issue as the item's native blocker, add `status:blocked`, then
   release the claim with a comment that quotes the failing line and links the breakage issue.
   `/work`'s frontier skips an issue labelled `status:blocked`, so the next session does not pick
   it, hit the same red and release it again; **Unblock** in § 5 returns it when the breakage
   issue closes. When the item is a PR, as in § 4, step 3, skip the block: **List PRs** does not
   read `status:blocked`. Only the release applies.
4. Read `AGENTS.md` and the ADRs that touch the area. To find them, run the prune tool on the
   issue first, per [`docs/agents/jev.md`](agents/jev.md).
5. **Plan**: post the `Plan:` comment before the first commit, so intent is reviewable before the
   work. Before posting it, run the Jev readiness tool on the draft,
   `node scripts/jev/readiness-cli.mjs <n> --plan <file>`, and fix each gap it flags in the plan,
   or raise a gap in the ticket with the owner ([`jev.md`](agents/jev.md)). A session resuming the
   ticket reads it first and starts at its first unchecked step. At the end of each session, edit
   it in place so its checked steps are the ones committed.
6. Build with `/implement`, driving `/tdd` at the seams agreed during planning: the check that
   proves the work is written before the work. On a bug ticket, which reports something broken
   rather than asking for something new, run `/diagnosing-bugs` first for its reproduction loop.
   The failing check that loop ends with becomes the first `/tdd` slice.
   - Red before green. One slice at a time: one check, the minimal work that passes it, repeat. For
     code the check is a test; elsewhere it is whatever the spec agreed proves the slice done.
   - The worktree's `scripts/verify.sh`, run by path, runs regularly, and once more at the end.
   - Look at the real result for anything a person will see or use. A green check is not evidence
     it works in front of them.
   - Commit to the branch; one concern per commit.
7. Self-check: `/implement` closes with `/review-pr` against `origin/main`, or a sub-PR's base
   per § 3, on every diff, however small: read `.agents/skills/review-pr/SKILL.md` and run it.
   Reading the diff yourself is not the self-check. Fix what it finds; it is not the review
   (§ Roles).
8. Evals, so a skill change is proven like code: when the diff touches `.agents/skills/<name>/`,
   run every case in `evals/<name>/`; when it touches `AGENTS.md`, every case in `evals/`. Run
   each, and have another session grade it, per [`evals/README.md`](../evals/README.md). A skill
   with no folder in `evals/` has no case to run. A grade holds for the commit it ran on: a later
   commit to those paths, in a fix round too, needs a fresh run.
9. **Open a PR** whose body, written by `/pr` with its Evidence per **Evidence**, says
   `Closes #<n>`, labelled `status:in-review`. Without that label no Reviewer finds it.

**Done when:** the ticket's own acceptance criteria pass, each with an entry in the PR's
`## Evidence` per **Evidence** in [`docs/agents/issue-tracker.md`](agents/issue-tracker.md),
`scripts/verify.sh` is green, every eval case step 8 requires has passed with its grade in that
`## Evidence`, every source you made stale is corrected in the same commit, and a PR whose body
says `Closes #<n>` is open and labelled `status:in-review`. On a red baseline, done is
step 3's block and release instead.

### 3. Review (Reviewer) — `/review-pr`

Run by a session that did not write the diff (§ Roles). When a second model is available, the
Reviewer runs on a different one from the author: a fresh session of the same model shares its
blind spots, as an author grading its own work is lenient.

1. **Claim a PR** with `Claimed: review`, then **Read back a claim**.
2. **Check out a PR** in its own worktree.
3. Run `/review-pr` with a freshly fetched `origin/main` as the fixed point, not `main`: a stale
   local `main` adds already-merged commits to the diff. A sub-PR's fixed point is its base, freshly
   fetched, `origin/integration/<name>`, not `origin/main`, which would add every sub-PR already
   merged into the integration branch (§ Integration branches). Its git commands take
   `git -C <worktree>`, per **Check out a PR**. On a re-review, scope new findings
   from the last report's sha, per "Re-reviews converge" below. Two axes, run as parallel sub-agents
   where the harness allows, per the paragraph after them, and reported side by side:
   - **Standards** — does the diff follow `AGENTS.md`, the checklist below, the ADRs that touch it,
     and `CODING_STANDARDS.md` once `/retro` has created it? To find those ADRs, run the prune
     tool on the PR first, per [`docs/agents/jev.md`](agents/jev.md). The checklist is applied in
     full. Before checking the PR's `## Evidence`, run the evidence tool on it, per
     [`docs/agents/jev.md`](agents/jev.md), and check the claims it flags first.
   - **Spec** — does it faithfully implement the originating spec, no more and no less? The spec
     is the issue in the PR's `Closes #<n>`. When the PR closes no issue, review this axis against
     the PR body, say so in the report, and flag the missing issue as a finding; do not stop to
     ask. Before judging the criteria, run the coverage tool on the PR, per
     [`docs/agents/jev.md`](agents/jev.md), and check the criteria it flags first.

   Both axis reports are in hand before step 4 starts: no finding is verified or posted while an
   axis is still running. A Reviewer that delegates the axes waits for both, running them in the
   foreground where its harness offers the choice. When its harness cannot run sub-agents, or
   cannot wait for them, the Reviewer runs both axes itself, one after the other, and says so in
   the report. A Reviewer never stops while it holds a claim with no report: if it must stop
   before posting, it releases the claim per **Release a claim**.
4. Before posting, check each draft finding against its cited source with the verify-findings
   tool, per [`docs/agents/jev.md`](agents/jev.md). Then set the verdict and post the report, per
   **Post a review**. The report is a PR comment that opens with `Reviewed at <sha>`, per
   "Re-reviews converge" below. Below that line comes one `Jev:` line per tool this review runs:
   prune, evidence, coverage and verify-findings. Each names the tool and quotes its first output
   line exactly as printed, a skip or error line included, as in
   `Jev: evidence: jev evidence: skipped, TYPESAFE_API_KEY is not set; check every entry yourself`.
   A tool that did not run has no line to quote, so a missing line shows it. With no draft
   findings there is nothing to check, so verify-findings does not run and its line reads
   `Jev: verify-findings: no findings`. Every finding names its source and quotes the line it is
   about. The Reviewer never pushes to the branch. A finding that stays in the chat does not exist.

**The verdict is strict.** `status:approved` means the report has zero open findings. Any finding at
all, including a judgement call, a low-severity edge case or a nit, sets `status:changes-requested`.
There is no "non-blocking" finding and no "approve, but consider…": a finding worth writing down is
worth a fix round. Severity orders the list; it does not decide the verdict. The one exception is a
finding that waits on the owner, per **Relayed owner rulings** below.

**Relayed owner rulings.** Every session and the owner share one account, so a Reviewer cannot tell
an owner's ruling from an agent's claim of one, whoever posted it. A finding answered with a relayed
owner ruling, per § 4, step 4, is neither accepted nor held: it waits on the owner. A constitution
violation never waits on a relayed ruling: it blocks the merge outright, per § Review checklist and
**Re-reviews converge**, so it keeps the PR in `status:changes-requested` whatever the answer. Any
other open finding still sets `status:changes-requested`, and the waiting one is carried over, not
raised again. When the only open findings are waiting ones, the verdict is `ready-for-human` in
place of `status:changes-requested`, and the report names each. The owner's merge is the ruling, and
closing the PR rejects it.

**Re-reviews converge.** Every report opens with `Reviewed at <sha>`, the head it reviewed. A
re-review first checks each earlier finding is either fixed, closed by a dispute the reviewer
accepted, or waiting on a relayed owner ruling. It then raises new findings only on lines changed
since that sha (`git diff <sha>..HEAD`), plus any constitution violation anywhere, which always
blocks. Code that passed one round is not re-litigated in the next. If round 3 still ends in
changes requested, the reviewer sets `ready-for-human` instead of `status:changes-requested` and
says why in the report: the loop is not converging, and the owner decides whether to merge,
rescope or close. A round's number is one more than the count of earlier reports on the PR.

**Done when:** the PR carries the verdict label this section sets, and the report, opening with
`Reviewed at <sha>` and its `Jev:` lines, is posted on the PR after it, every finding naming its
source and quoting its line. A Reviewer that must stop before posting is done when it has released
the claim, per step 3.

### 4. Fix rounds (Implementer)

The issue is already claimed and the branch and PR exist, so a fix round skips § 2's claim, branch
and PR steps.

1. **Claim a PR** with `Claimed: fix round`, then **Read back a claim**.
2. **Check out a PR** in its own worktree, on the same branch.
3. Before any change, run the worktree's `scripts/verify.sh` by path, per § 2, step 3. The
   branch carries your own work, so red here is yours to fix in this round, unless it is
   inherited. To tell, run the base's `scripts/verify.sh`, on `origin/main` or a sub-PR's base, in
   its own worktree per **Check the base**, and compare failing lines. A failing line is a line of
   the output, stdout or stderr, that starts with `✖` (a failed test) or `error` (a
   `check-skills.mjs` error), minus what differs between runs: a leading time of day such as
   `6:25AM`, which gitleaks prints, and a trailing parenthesised duration such as `(0.68ms)`,
   which Node's test runner adds. Order does not count, and a `warning` or `skipped` line is not
   one. A red run that prints none, as a gitleaks finding does, takes its last line as its failing
   line. A branch failing line the base does not print is yours, whatever else is red on the
   base; when all of them are yours, fix them in this round. When the base prints any of them,
   that red is inherited, and the branch cannot go green until the base is fixed, so § 2's
   clean-baseline rule applies, with the PR as the item: the release comment quotes the shared
   lines and lists the branch's other failing lines, which the next round fixes.
4. Address every finding, whatever its severity. A finding may be disputed, with a reason and a
   source; "it works" and "it is minor" are not disputes. The reviewer either accepts the dispute,
   which closes the finding, or holds it, which keeps the PR in changes requested. Scope creep found
   in review becomes a new ticket, not a bigger diff: an Implementer never widens a PR to close
   another ticket on its own. When the owner has ruled on a finding, for instance to widen the PR,
   accept a failing grade or leave a file as it is, the answer is a relayed owner ruling, not a
   dispute: the answer names the ruling, and where and when the owner gave it. The Reviewer cannot
   verify it, so the finding waits on the owner, per § 3, **Relayed owner rulings**. A constitution
   violation never waits: no relayed ruling answers it, so it is fixed or disputed. A fix that
   touches an eval case's paths reruns that case, per § 2, step 8.
5. **Return a PR for review**. Its comment answers each finding: fixed in `<sha>`, naming the test
   for a behaviour change, disputed with a reason and a source, or answered with a relayed owner
   ruling. A finding already waiting on the owner from an earlier round is listed as still waiting.

**Done when:** every finding is fixed, disputed or answered with a relayed owner ruling,
`scripts/verify.sh` is green, the branch is pushed, the PR is back on `status:in-review`, and the
answering comment is posted after the label.
On a red baseline that step 3 counts as inherited, done is § 2, step 3's release instead, with
no block.

### 5. Merge and learn (Owner)

The owner merges. The default branch's ruleset, set by
[`scripts/bootstrap.sh`](../scripts/bootstrap.sh), requires one approving review, which no session
can give: every session shares the owner's account, and GitHub forbids approving your own PR. So
the `status:approved` label carries the verdict, and the owner merges with the ruleset's one bypass,
the admin role. Agents run as that account and hold the bypass too; none merges on its own, only
when the owner directs it (§ Roles). Then `/retro` looks back over the session and proposes changes
to the **environment** rather than the work: pointers in `AGENTS.md`, a deterministic check where a
mistake was mechanical, a standard where it was a judgement call.

**Unblocking.** When an issue closes, the session closing it removes `status:blocked` from every
issue whose native blockers are now all closed, per **Unblock** in
[`docs/agents/issue-tracker.md`](agents/issue-tracker.md). When a merge closes the issue, that is
whoever merged it: the owner, or the session the owner merged through.

**Sub-PRs.** `Closes #<n>` closes an issue only when its PR merges into the default branch, so a
sub-PR into an integration branch (§ Integration branches) leaves its issue open. The session that
merges a sub-PR closes its issue with a comment linking the PR, per **Close**, then runs **Unblock**
for it.

**Eval sandboxes.** Every eval run leaves a private sandbox repo, per
[`evals/README.md`](../evals/README.md) § Sandbox, and the PR's `## Evidence` lists each run by its
token. When the PR merges, the session that merged it, the owner or the session the owner merged
through, runs `scripts/eval-cleanup.sh <pr>` from the main clone's root. It deletes each listed
run's sandbox that every guard proves is one, and its folders beside the main clone. It prints a
`kept` line, with the reason, for a listed run whose repo it did not delete, and an
`older than 7 days, not deleted` line for every other `eval-*` repo it found; the owner decides
about each. A PR that lists no run leaves nothing to clean up.

**Done when:** the issue is closed with a comment linking the PR, every issue it unblocked has lost
`status:blocked`, `scripts/eval-cleanup.sh` has run for a PR whose Evidence lists eval runs, and
every accepted retro action has either landed or become its own issue.

## Integration branches

An effort too large for one PR to `main`, such as a spec whose tickets land in waves, collects
its tickets on `integration/<name>`, cut from `main`. Each ticket is still one issue, one worktree,
one branch and one PR, but that PR, a sub-PR, targets the integration branch: § 2 branches from
`origin/integration/<name>` and opens the PR with `--base integration/<name>`, per **Branch** and
**Open a PR**. § 3 reviews a sub-PR against its base, and § 5 says who closes its issue. Once every
sub-PR has merged, one PR from `integration/<name>` to `main` takes the whole effort through the
loop, and the branch is deleted when it merges.

**Protected by a ruleset.** The `integration-branches` ruleset that
[`scripts/bootstrap.sh`](../scripts/bootstrap.sh) sets covers every `integration/*` branch: changes
land only by PR with `verify` green, and its history is never rewritten. It requires no approving
review and has no bypass actor, so the owner merges an approved sub-PR, by hand or through a
session, without one, and no one, agent or owner, pushes to the branch directly. It has no deletion
rule, so the branch can be deleted after its integration PR merges.

**Fix rounds land by PR.** A fix round on a sub-PR pushes to the sub-PR's own branch, per § 4. A
fix round on the integration PR to `main` lands through a small PR into `integration/<name>`, like
any sub-PR, never by a push to the integration branch.

## Review checklist

Applied in full on every review. Each line is a hard rule, not a judgement call.

**Correctness**

- Every acceptance criterion in the spec is demonstrably met.
- Every acceptance criterion has an entry in the PR's `## Evidence`, per **Evidence** in
  [`docs/agents/issue-tracker.md`](agents/issue-tracker.md). A criterion without one is a finding.
- Every eval case § 2, step 8 requires has a passing grade in the PR's `## Evidence`, run on the
  last commit that touched its paths. A missing, failing or stale grade is a finding.
- A behaviour change has a check that fails without it. Name the check.
- No check asserts an implementation detail, and no expected value is recomputed the way the work
  computes it.

**The constitution** — a violation here blocks the merge outright

<!-- TEMPLATE: replace with this project's constitution from AGENTS.md. -->

- No secret, credential, or personal or confidential data is committed, logged, or shared beyond
  where the owner put it.
- <The project's other non-negotiables.>

**Domain**

<!-- TEMPLATE: the field's hard rules, added as Phase 0 lands: a build or lint for code, a style
guide for writing, a protocol or citation standard for research, a clinical or regulatory rule for
care work. -->

- `scripts/verify.sh` is green, including every check Phase 0 added to it.
- Nothing destructive or irreversible without an ADR.

**Craft**

- The co-located `.md` is updated in the same commit.
- One concern per commit.
- No new system or major part without an ADR.
- `AGENTS.md` is still under 200 lines and still true.

## Where state lives

**The tracker is the state.** Nothing about an item's status lives only in a chat log or a `.md` file.

| State | Representation |
|---|---|
| Needs evaluation | `needs-triage` |
| Blocked on the reporter | `needs-info` |
| Specified, agent can start | `ready-for-agent` |
| Needs human hands | `ready-for-human` |
| Won't action | `wontfix` |
| In review | `status:in-review` |
| Changes requested | `status:changes-requested` |
| Approved, not merged | `status:approved` |
| Blocked by another item | `status:blocked` + a native blocking dependency |
| Owner priority | `priority:high` or `priority:low`; none means normal |
| Phase | one `phase:N` label, mirroring `docs/idea.md` § Roadmap |

Label definitions and creation commands: [`docs/agents/triage-labels.md`](agents/triage-labels.md).
Tracker operations: [`docs/agents/issue-tracker.md`](agents/issue-tracker.md).

## Starting a session

The words that start a session are listed once, in the `description` of
[`/work`](../.agents/skills/work/SKILL.md). When the owner says one without naming a ticket, follow
`/work`: it picks the role and the next item, and waits for the owner's confirmation before
anything is claimed.

## Ending a session

Before ending a session, in this order:

1. The tracker reflects reality: claimed items claimed, and finished work handed on. An
   Implementer's `Plan:` comment is current, per § 2, and its PR is open and labelled
   `status:in-review`; the PR a Reviewer checked carries its verdict.
   The merge, or for a sub-PR the session that merges it, closes the issue, per § 5; an
   Implementer or Reviewer never closes it.
2. The Working Agreement in `AGENTS.md` holds for everything this session committed.
3. This session's worktree is removed, per **Worktree** in
   [`docs/agents/issue-tracker.md`](agents/issue-tracker.md).
