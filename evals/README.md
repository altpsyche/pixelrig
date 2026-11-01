# Skill evals

A skill change is proven like code. Each case here is one Markdown file that any agent, in any
harness, on any model, can run, and that a different session grades. When a PR must run them is in
[`docs/workflow.md`](../docs/workflow.md) § 2; this file owns the case format, the sandbox, and how
a case is run and graded.

Cases live at `evals/<skill>/<case>.md`, outside the skill folders, so vendored skills stay
byte-identical to upstream. `scripts/check-skills.mjs` fails if `<skill>` names no folder in
[`.agents/skills/`](../.agents/skills/README.md).

## Three sessions

- **Runner**: the Implementer whose PR needs the case, or the owner. It builds the sandbox, starts
  the run session, plays the owner from the case's script, and collects the result.
- **Run session**: a fresh session, in any harness, interactive or headless, on any model,
  started in the sandbox. Of the case it sees only the prompt and the scripted replies, and it is
  not told it is an eval. Each reply reaches it as its own user turn, never relayed through
  another agent: a session rightly takes no agent's message as the owner's approval. So a subagent
  whose replies arrive from the agent that started it cannot be the run session. A separate
  interactive session qualifies, and so does a headless session resumed with each reply as its
  next prompt.
- **Grader**: a fresh session that is neither of the other two, on a different model when one is
  available, for the reason in [`docs/workflow.md`](../docs/workflow.md) § 3. It sees only the case
  file and the transcript.

## Case format

A case has these sections, in this order:

- **`# <title>`**: the behaviour under test, in one line.
- **`## Exercises`**: the rules the case tests, each linking to the one file that owns it. This is
  for the grader and for whoever edits the case; the run session never sees it.
- **`## Starting state`**: what the sandbox holds before the prompt, as commands the runner runs
  exactly. `On main, before the push` runs at the marked step of § Sandbox; `After bootstrap` runs
  once the sandbox is up. Either may be absent.
- **`## Prompt`**: the text the runner pastes into the run session, verbatim, in a fenced block.
- **`## Owner replies`**: each scripted reply and the moment it is given. To anything else the
  run session asks, the runner gives the fallback reply in § Running a case, and nothing more.
- **`## Collect`**: commands the runner runs in the sandbox after the run. Their output goes to the
  grader with the transcript. Like every command in the docs, they inline no braces, so a jq
  filter keeps fields with `pick(…)` and `|=`, read no jq filter from a file, and never chain onto
  a `cd`; `scripts/check-skills.mjs` fails on each, per
  [ADR-0003](../docs/adr/0003-eval-runs-real-sandboxes-guard-safe-commands.md).
- **`## Pass criteria`**: numbered yes/no questions, each ending in `?`.

A pass criterion:

- asks one thing, and `yes` is the pass;
- is answerable from the transcript and the collected output alone, by quoting a line of either;
- asks what the session did, never what it meant or how well it did it.

## Sandbox

A run claims issues, comments and pushes, so a case never runs in this repo or a real project. It
runs in a throwaway private GitHub repo whose `main` is one commit: the tree of the branch under
test, with no history and without the case folders. From a checkout of that branch, with
everything committed, at its root, run:

```bash
T=$(openssl rand -hex 4)       # names this run
S=$(git rev-parse HEAD)        # the source commit
mkdir "../eval-$T"
git archive HEAD -- . ':(exclude,glob)evals/*/**' | tar -x -C "../eval-$T"
cd "../eval-$T"
git init -q -b main
git add -A && git commit -qm "Sandbox"
# Here: the case's "On main, before the push" commands, if any.
gh repo create "eval-$T" --private --source . --remote origin --push \
  --description "eval-sandbox run $T from $S"
scripts/bootstrap.sh </dev/null   # no terminal, so no Jev key prompt
# Then: the case's "After bootstrap" commands.
```

These steps are the definition. `scripts/eval-sandbox.sh` types them for the runner, running the
case's Starting state blocks as written at their steps:

```bash
<checkout>/scripts/eval-sandbox.sh evals/<skill>/<case>.md
```

The case path is relative to the checkout's root. It reads the case through
`scripts/eval-case.mjs`, which refuses a case it cannot parse before anything is built, and runs
each Starting state block with `T` and `S` set, as they are when typed by hand. The script names
the token and the sandbox's path as soon as the token exists, stops at the first command that
fails, and its last lines print the token, the sandbox's path and the prompt. A failure once the
repo may exist prints the token and path again, with a note that the run is void. When a step
and the script disagree, the step wins and the script is fixed.

The runner types the steps in its own shell, so it enters the sandbox with `cd`; the run
session's commands, and a case's Collect commands, never do.

The description marks the repo as a sandbox: `eval-sandbox run <T> from <S>`, the run's token
and the full sha of the source commit, the `sandbox from` commit of the grade. It is what lets a
script tell a sandbox from a real repo by more than its name
([ADR-0003](../docs/adr/0003-eval-runs-real-sandboxes-guard-safe-commands.md)).

No history comes with the tree, so no commit or object in the sandbox holds a case: the run
session cannot read the pass criteria there. This file stays, since the docs link it. The run
session can still reach this repo itself through `gh` or the web, so a transcript that shows it
opening a case file, anywhere, voids the run; the runner runs it again in a new sandbox.
`scripts/bootstrap.sh` creates the labels and switches on the pre-push hook. On a free private
repo it also warns that it could not protect `main`; that is expected here. With stdin not a
terminal it skips its Jev key offer, so the sandbox never gets a `.env`. A key in the runner's own
shell still reaches the run session; no case depends on whether one is set.

The sandbox outlives the run, so the grader's quotes can be checked against it. It is deleted when
the PR whose `## Evidence` lists its run merges: the session that merged it runs
`scripts/eval-cleanup.sh <pr>`, per [`docs/workflow.md`](../docs/workflow.md) § 5. That script is
the only way an agent deletes a repo. It deletes `eval-<T>` only when every guard holds: the PR is
merged and its Evidence lists `run <T>`, with `<T>` eight lowercase hex digits; the repo resolves to
that exact name, owned by the account `gh` is logged in as; it is private; and its description is
the marker above, for that run. Beside the main clone it removes only the folders `eval-<T>` and
`eval-<T>-<n>`. It lists, never deletes, every other `eval-*` repo older than 7 days; the owner
decides about each, and deletes one by hand with `gh repo delete <owner>/eval-<T> --yes`.

## Running a case

1. Build the sandbox, with the case's starting state, per § Sandbox, by hand or with
   `scripts/eval-sandbox.sh`. If it cannot be built, or the run session cannot reach it, the run
   is void: it is not graded, and running the case in a new sandbox is not a rerun. A void run whose
   repo was created is still listed by its token in the PR's Evidence, as void, so the cleanup at
   merge deletes it.
2. Start the run session with the sandbox folder as its working directory, and paste the prompt.
3. Give each scripted reply at its moment. To anything else, reply only: `I'm not available.
   Follow the repo's docs and decide.` Never hint, correct or explain.
4. Stop when the run session says it is done, or ends a turn waiting on a reply the script does
   not have.
5. Save the transcript to `.scratch/evals/<skill>-<case>-<T>.md` in your own worktree: every
   message, every command and its output, as the harness exports it, or copied by hand where it
   cannot.
6. Run the case's `## Collect` commands in the sandbox, and append each command and its output to
   the same file. `scripts/eval-collect.sh` does it, each command in its own fenced block under a
   `## Collect, run <T>` heading, with `(exit <n>)` after a command that failed:

   ```bash
   <checkout>/scripts/eval-collect.sh evals/<skill>/<case>.md <T> <transcript>
   ```

## Grading a case

Hand the grader the case file and the transcript file, and nothing else. If the transcript shows
the run session opening a case file, the grader answers no criterion and its grade is
`Verdict: void`, per § Sandbox. Otherwise, for each pass criterion it answers `yes`, `no` or
`unsure`, with the quote from the transcript or the collected output that decides it. An answer
with no quote is `no`. The owner answers each `unsure`; until then the case has not passed. A case
passes only when every criterion is `yes`. Before answering, the grader may run the Jev grade
tool on the same two files, `node scripts/jev/grade-cli.mjs <case> <transcript>`, for advice on
each criterion. What its answers ask of the grader, and what a skip or error line means, is in
[`docs/agents/jev.md`](../docs/agents/jev.md). The grade looks like:

```
Grade: evals/work/red-baseline.md, run 1a2b3c4d, sandbox from 9f8e7d6
1. yes: "<quote>"
2. no: "<quote>"
Verdict: fail 1/2 (no: 2)
```

The last line is `Verdict: pass N/N`, `Verdict: void`, or `Verdict: fail K/N` with the criteria
that were not `yes` in brackets, as `no:` and `unsure:` lists. `sandbox from` names the commit of
the branch under test that the sandbox's tree came from.

The grade goes in the PR's `## Evidence`, per **Evidence** in
[`docs/agents/issue-tracker.md`](../docs/agents/issue-tracker.md). A failed case is not rerun until
it passes: fix the skill, or fix the case in its own commit with the reason, then run it again.
