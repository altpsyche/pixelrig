# Agentic development workflow

This project is built primarily by coding agents driven by one human owner, across several
harnesses. We standardise on the open conventions the ecosystem converged on: a root `AGENTS.md`
(stewarded by the Agentic AI Foundation) as the always-loaded context file, and
[Agent Skills](https://agentskills.io/) `SKILL.md` folders for task-specific instruction. Rather
than symlink a global skill install, we **vendor** the skill suite at a pinned commit into
`.agents/skills/` as ordinary files, so every harness and every model reads one version and a skill
change is a reviewable diff. We keep the upstream lowercase `docs/`, `docs/adr/`, `docs/agents/`
layout precisely because those are the skills' defaults, which means zero path rewrites on update.

## Consequences

- Updating the skill suite is a deliberate, reviewable commit, not an implicit `git pull` of a global
  install. [`docs/agents/`](../agents/) and [`.agents/skills/README.md`](../../.agents/skills/README.md)
  record what was vendored and which local changes must be re-applied.
- `AGENTS.md` is the only context file. A harness that does not load it on its own is pointed at
  it by the person running it, outside the repo; the repo carries no per-harness copy or symlink.
- Work is spec-driven: idea → grill → spec → tickets → implement test-first → two-axis review. The
  loop is defined once, in [`docs/workflow.md`](../workflow.md).
- The tracker must be machine-readable, because agents claim and close their own work. That is why
  GitHub issues, not prose, hold state. Agents reach it through the `gh` CLI, not a GitHub MCP
  server: models already know `gh`, and a server's tool definitions cost context in every session.
- **Every agent gets the same base.** The template holds nothing for one harness: no
  harness-specific folder, config, hook or skill path. `.agents/skills/` is the only skills path,
  every agent reads a skill's file because `AGENTS.md` says to, and skills name each other by
  relative link, not by a harness's skill tool. `scripts/check-skills.mjs` fails on any
  harness-specific file, so the rule holds without anyone remembering it.

## Considered options

- **Symlink `~/.claude/skills` into the repo.** Rejected: the repo's behaviour would depend on
  machine state that is invisible in review, and it breaks for a contributor or a fresh CI runner.
- **Ship as a Claude Code plugin only.** Rejected: the project is meant to be built by whatever
  agent the contributor has, and a plugin manifest privileges one vendor.
- **Add per-harness wiring** (a harness's own skills path, settings, hooks or plugin manifest).
  Rejected: agents would start from different bases, and each harness adds a path to keep in step,
  for native features that `AGENTS.md` already covers by pointer.
- **Write bespoke skills instead of vendoring.** Rejected: the vendored suite is battle-tested, and
  the writing-for-agents discipline it encodes is the expensive part to reproduce.

## Amendments

- **2026-10-12: a git hook is not harness-specific.** "No harness-specific folder, config, hook or
  skill path" above means a hook inside a harness, wired through that harness's own settings. A git
  hook belongs to git: it runs the same whichever harness, model or person pushes, so it gives
  every agent the same base rather than splitting it. The template ships one,
  [`.githooks/pre-push`](../../.githooks/pre-push), which checks a clean tree: it refuses a push
  while the tree holds any change or untracked file, so `scripts/verify.sh` checks the committed
  HEAD. An agent never skips it with `--no-verify`; the owner may, as the person accountable for
  the push. Recorded per [the agentic guardrails spec](../specs/agentic-guardrails-2026.md)
  § Pre-push hook; the owner signs it off by merging.
