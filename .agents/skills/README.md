# Agent skills

Vendored from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) at commit
`7a030a8b0dcaa601bb0dda9aaf174affb3d61145` (v1.3.1). They are kept as ordinary files so every
model, in every harness, reads the same version.

Every agent, in every harness, starts at the root `AGENTS.md`, which points at this folder. A
skill is used by reading its `SKILL.md` and following it; `/name` in any doc is shorthand for
exactly that. There is deliberately no harness-specific folder or wiring of any kind: every agent
gets the same base and takes the same path. See
[ADR-0001](../../docs/adr/0001-agentic-development-workflow.md).

Who runs which skill is defined in [`docs/workflow.md`](../../docs/workflow.md). Repo config
the skills read lives in [`docs/agents/`](../../docs/agents/). Eval cases for the loop's core
skills live in [`evals/`](../../evals/README.md), outside these folders, so vendored skills stay
byte-identical.

## Included

| Planning | Building | Reviewing | Shared / reference |
|---|---|---|---|
| [`grill-with-docs`](./grill-with-docs/SKILL.md), [`grill-me`](./grill-me/SKILL.md), [`to-spec`](./to-spec/SKILL.md), [`to-tickets`](./to-tickets/SKILL.md), [`triage`](./triage/SKILL.md), [`research`](./research/SKILL.md) | [`implement`](./implement/SKILL.md), [`tdd`](./tdd/SKILL.md), [`diagnosing-bugs`](./diagnosing-bugs/SKILL.md), [`pr`](./pr/SKILL.md), [`prototype`](./prototype/SKILL.md), [`wizard`](./wizard/SKILL.md) | [`review-pr`](./review-pr/SKILL.md), [`retro`](./retro/SKILL.md) | [`grilling`](./grilling/SKILL.md), [`domain-modeling`](./domain-modeling/SKILL.md), [`codebase-design`](./codebase-design/SKILL.md), [`handoff`](./handoff/SKILL.md), [`writing-for-agents`](./writing-for-agents/SKILL.md) |

**Local skill (not upstream):** [`work`](./work/SKILL.md) is the session-start router behind
"let's work". It picks the role, picks the next item from the tracker, confirms with the owner,
then hands off to the skills above.

## Deliberately left out

Trimmed to keep context load down. Any of these can be vendored later by re-copying from the
pinned commit above.

- `wayfinder` — the roadmap in `docs/idea.md` charts the phases; vendor it when there is fog to map.
- `improve-codebase-architecture` — vendor once there is code to scan.
- `implement-spec` — overlaps `implement`; revisit if parallel worktree subagents become routine.
- `setup-ts-deep-modules` — a one-shot dependency-cruiser setup; run it once the frontend exists.
- `ask-matt` — upstream's router for its own flows; [`work`](./work/SKILL.md) replaces it here.
- `setup-matt-pocock-skills` — a one-shot that wrote `docs/agents/`. Those files are customised
  now, and re-running it would overwrite them.
- `teach`, `to-questionnaire`, `wait-what`, `scaffold-exercises`, `migrate-to-shoehorn`,
  `setup-pre-commit`, `git-guardrails-claude-code`, and everything under `in-progress/`.

## Local changes — re-apply after updating from upstream

1. `engineering/code-review` is vendored as **`review-pr`**, which says what it reviews and is not
   mistaken for the built-in review commands some harnesses ship. The rename is applied to the
   frontmatter `name` and the cross-references in `implement` and `tdd`.
2. Upstream's "call the Skill tool with X" becomes a relative link to `../X/SKILL.md`, to read
   and follow, in `grill-me`, `grill-with-docs`, `triage`, `tdd`, `retro` and `handoff`. A skill
   tool is a harness feature, and this repo assumes none, so a skill names another by its file.
   `scripts/check-skills.mjs` checks the links. After an update,
   `grep -rn --include=SKILL.md "Skill tool" .agents/skills` must print nothing.
3. Upstream's per-harness `agents/` folder in each skill (display names and invocation policy for
   one harness) is not vendored. `scripts/check-skills.mjs` fails if one comes back. The
   `disable-model-invocation` and `argument-hint` frontmatter keys stay: any agent can read them,
   and the first says the owner, not the model, starts that skill.

`scripts/check-skills.mjs` also fails on a skill command a non-interactive shell guard refuses,
per [ADR-0003](../../docs/adr/0003-eval-runs-real-sandboxes-guard-safe-commands.md): inline
braces, a jq flag that reads a file, or a `cd` chained to another command. None does at the pinned
commit; if an update brings one in, rewrite it and list the rewrite above as a local change.

**Known upstream wording, deliberately not patched:**

- `retro` and `writing-for-agents` still name `CLAUDE.md` beside `AGENTS.md`, which this repo
  bans. They treat the two as alternatives: here `AGENTS.md` always exists and `CLAUDE.md` never
  does, so they edit `AGENTS.md`, and `scripts/check-skills.mjs` fails if any agent creates a
  `CLAUDE.md`.
- Five lines in four skills still name `setup-matt-pocock-skills`, which is not vendored. Four say
  to run it if the tracker config is missing: `to-spec`, `to-tickets`, `triage` and `review-pr`.
  The fifth, in `to-tickets`, says publishing "depends on the tracker `/setup-matt-pocock-skills`
  configured". The config is always present here, in [`docs/agents/`](../../docs/agents/), so
  none of those four lines fires, and the fifth means the tracker
  `docs/agents/issue-tracker.md` names.

Everything else is byte-identical to upstream. This repo uses lowercase `docs/`, `docs/adr/`,
`docs/agents/`, and `GLOSSARY.md`, which are the upstream defaults, so **no path rewrites are
needed**. Keep it that way: a capitalised `Docs/` would reintroduce a rewrite on every update.
