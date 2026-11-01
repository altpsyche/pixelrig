# Eval runs use real GitHub sandboxes, guard-safe commands and outcome criteria

Running the skill evals for PR #55 took about 25 run sessions for 8 cases. Most failures were not
skill behaviour. They were plumbing:

- One harness's non-interactive guard refused the tracker doc's inline GraphQL, whose braces it
  reads as shell expansion (#54), and refused `cd <worktree> && gh pr checkout`. Each tool call
  starts in the main folder, so **Check out a PR** as written could not run there at all.
- Sessions improvised substitutes for refused commands, then failed criteria that named the
  documented command.
- Every run needed a throwaway private GitHub repo that only the owner may delete: 23 in one day.

One failure was behaviour: sessions skipped the evidence tool, and one report said it had run.

**So the commands agents type become guard-safe, criteria about mechanics check outcomes, scripts
build, collect and clean up sandboxes, and evals keep running against real GitHub.** The base stays
harness-neutral: the commands are plain `gh`, `git` and `jq` any agent runs, shaped to pass the
strictest guard seen rather than written for one harness.

## Consequences

- **Queries and filters live in files.** Each GraphQL query and each multi-line jq filter is a
  file under `scripts/`; the tracker doc's command passes it with `-F query=@<file>` or `jq -f
  <file>` and names the file. Tests read the same files, so doc and test still cannot drift.
  `check-skills.mjs` fails on a tracker command that inlines braces or starts with `cd … &&`.
- **`jq` is a required tool.** A filter in a file needs standalone `jq`; `gh --jq` takes no file.
  `verify.sh` says so in one visible line when it is missing.
- **Worktrees are addressed, never entered.** Commands take `git -C <worktree>`; **Check out a PR**
  creates the worktree on the PR's head branch, tracking `origin`, instead of `cd` and
  `gh pr checkout`.
- **Criteria check outcomes for mechanics** ("the worktree's HEAD is the PR head"), and name a
  command only where using it is the behaviour under test. A rewrite must not weaken what a case
  tests; the Reviewer checks each rewritten criterion against the one it replaces.
- **Real sandboxes, deleted on merge.** One private repo per run, as before. `eval-sandbox.sh`
  marks each one (description naming the run token and source commit). Every run of a case, pass
  or fail, is listed by token in the PR's Evidence. When the PR merges, the merging session runs
  the cleanup script, which deletes a repo only if its name is `eval-` and eight hex digits, its
  owner is the logged-in account, it is private and it carries the marker; it removes only the
  matching local folders. It lists, never deletes, older unmarked or unlisted `eval-*` repos.
  This narrows `evals/README.md`'s "no agent deletes a repo" to this script, run at merge. The
  shared token already holds `delete_repo`; the guards are what make the script safe.
- **Run sessions run anywhere.** The scripts only build, collect and check. The run session is any
  harness, interactive or headless, and receives the case's owner replies as its own turns.
- **The review report shows each Jev tool's output line**, skip lines included, so a tool that did
  not run is visible.
- **Reruns.** A failed case is still not rerun until the skill or the case changes. A runner-setup
  fault (the sandbox could not be built, or the run session could not reach it) voids the run; it
  does not grade it.
- **This effort's own delivery.** Its tickets land as sub-PRs into `integration/eval-runs`,
  protected by #38's ruleset, then one PR to `main`. Sub-PRs skip `docs/workflow.md` § 2 step 8;
  the final PR runs every case once on its head and carries every grade. The exception ends when
  that PR merges. Implementers run on Opus; Reviewers and graders on Sonnet, per § 3's
  different-model rule.

## Considered options

- **Tracker verbs (`scripts/tracker claim`, `review`, …) as the only path.** Deferred. They would
  fix the guard failures, but ADR-0001 chose `gh` because models already know it, and verbs that
  enforce order make the matching criteria true by construction, so evals would test the script,
  not the skill. Reopen if guard-safe commands still fail headless runs after this slice.
- **A local file-backed fake tracker for evals.** Deferred. It would remove sandbox repos, but
  issue/PR shared numbering, native blockers, timelines and comment authorship are hard to fake
  faithfully, and a green fake would no longer prove the GitHub path. Reopen if sandbox cost still
  hurts after auto-delete: more than one manual cleanup per Phase.
- **One long-lived sandbox repo.** Rejected: numbers never reset, PRs cannot be deleted, and closed
  issues and old review reports would let a run read earlier answers.
- **Decision-only, dry-run evals.** Not chosen as the main tier: they test routing and judgement but
  not the tracker writes most cases exist to check. A possible cheap tier later.
- **Keep literal criteria and keep rerunning.** Rejected: it graded the harness and broke the
  no-rerun rule.

Related decisions: #44 (an inherited eval failure does not block approval) and #45 (a full run
before a Phase closes) are recorded on those issues and unchanged by this ADR.

## Amendments

- **2026-10-12: jq filters stay inline, without braces; only GraphQL queries live in files.**
  Headless Claude Code (2.1.280) refuses `jq -f`, `--from-file` and `--rawfile` with "jq command
  contains dangerous flags that could execute code or read arbitrary files", so a filter passed by
  file cannot run as written. GraphQL queries still live in files under `scripts/queries/`,
  passed with `-F query=@<file>`. Each jq filter stays inline in the command's `--jq` and carries
  no braces: it builds objects with `pick()` and `|=`. `claim-readback.test.mjs` and
  `frontier.test.mjs` read the filter from the tracker doc's own command, so doc and test still
  cannot drift. This corrects two Consequences above. **Queries and filters live in files** now
  holds for GraphQL queries only: no command uses `jq -f <file>`, and `check-skills.mjs` also fails
  on a jq flag that reads a file. **`jq` is a required tool** no longer holds for the commands,
  which use `gh --jq`. Standalone `jq` is needed only by the local query tests, and `verify.sh`
  says so in one line when it is missing. Recorded per
  [#54](https://github.com/altpsyche/altpsyche-agentic-engineering/issues/54); the owner signs it
  off by merging the final eval-runs PR.
