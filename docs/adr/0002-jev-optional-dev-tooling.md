# Jev answers closed-set workflow questions, optionally

Many workflow steps ask a closed question: which label fits, which docs govern this work, does this
quote support this finding, does this output prove this claim. A thinking model spends many tokens
on each of these. TypeSafe's Jev answers typed questions in milliseconds and for a fraction of the
cost. It has three kinds:

- a **Choice** picks one option from a set and reports its confidence;
- a **Score** places an answer on an ordered scale of two to ten levels;
- a **Noul** gives the probability that a yes/no statement is true.

**So the repo's tooling asks Jev those questions, through plain-Node scripts any agent runs, and
every script works without it.** With no `TYPESAFE_API_KEY`, or when a request fails, a script
prints one line and exits 0, and the agent does the step itself, as before. The base stays the
same for every agent and every model: Jev is a tool scripts call, not a harness or a model an agent
runs on.

## Consequences

- **A new outbound destination, `api.typesafe.ai`.** This ADR is what authorises it. Nothing else
  in the repo calls it.
- **No packages.** Scripts call the HTTP API with Node's built-in `fetch`, not the SDK. They retry
  429 and 529 with backoff themselves, and read a base-URL override so tests can run against a
  fake local server.
- **One pinned model, one constants file.** Thresholds are calibrated against one model version,
  so the scripts name `jev-1.13.0`, never an alias. Every threshold lives in one constants file;
  retuning is one reviewed edit.
- **Advisory, in bands.** A confident answer may act: apply a label, skip a doc, keep a finding.
  The middle band hands the question back to the agent. Jev never sets a review verdict, never
  decides that work is done, and never judges a constitution item.
- **Never in CI.** The key lives only in the owner's shell, never in a CI secret. That keeps it out
  of reach of workflows that read untrusted issue or PR text. CI tests every script against a fake
  server instead, which proves both the contract and the clean fallback.
- **Known weak spots are designed around.** Jev favours the first option, reads negations
  literally and can be swayed by injected text. So options are ordered deliberately, questions are
  phrased positively, and a script checks text exactly before it asks Jev about it.

## Considered options

- **The SDK, as `errand-knight` does.** Rejected: it brings back `package.json` and an install
  step. The HTTP contract is small enough to call directly.
- **A skill-suggestion router**, from TypeSafe's cookbook. Rejected: it needs a hook that runs
  before every turn, which only some harnesses have, so agents would start from different bases.
- **Jev in CI with a repo secret.** Rejected: a secret reachable from PR workflows is exactly what
  injected issue text goes after, and the fake-server tests already cover CI's job.
- **Gate on Jev where it is confident.** Rejected: a cheap judge's false positive would block work
  with no session re-deciding. Advisory bands cost one re-read in the worst case.

## Amendments

- **2026-10-12: the key may live in a gitignored `.env`.** "The key lives only in the owner's
  shell" above means on the owner's machine and never in a CI secret, which still holds. Exporting
  it in a shell profile was the only way to set it, which every new user had to work out. So a
  tool now also reads `TYPESAFE_*` from the gitignored `.env` at the main clone's root, which
  every worktree finds, and [`scripts/jev/set-key.sh`](../../scripts/jev/set-key.sh) writes it.
  A key in the shell wins. How it is found is
  [`scripts/jev/README.md`](../../scripts/jev/README.md) § The client. Recorded per
  [#27](https://github.com/altpsyche/altpsyche-agentic-engineering/issues/27); the owner
  signs it off by merging.
