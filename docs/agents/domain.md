# Domain docs

How the engineering skills consume this project's domain documentation. This repo is
**single-context**.

## Before exploring, read these

- **[`AGENTS.md`](../../AGENTS.md)** — conventions, anti-patterns, the ADR index, and the precedence
  order to apply when sources disagree.
- **[`docs/idea.md`](../idea.md) § Core Concepts** — the authoritative vocabulary until
  `GLOSSARY.md` exists.
- **`GLOSSARY.md`** at the repo root, *if it exists*. It is created lazily by `/domain-modeling` the
  first time a term is resolved. If it does not exist, **proceed silently**: do not flag its absence
  and do not create it upfront.
- **[`docs/adr/`](../adr/)** — read the ADRs that touch the area you are about to work in.
- **The co-located `.md`** beside the work you touch, which describes how that part works.
- **[`docs/specs/`](../specs/)** — what was agreed to be built, and its testing seams.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a test name, a type name), use the term as
`docs/idea.md` § Core Concepts and the work define it. Do not drift to synonyms. If a synonym is
genuinely better, `/domain-modeling` changes the model and the vocabulary together, in one commit.

<!-- TEMPLATE: once terms settle, list the distinctions agents most often blur here, e.g.
- **Term A** vs **Term B** — what separates them. Never "synonym". -->

## Where the skills' open questions are answered

Two vendored skills leave a step to the project. This repo answers them here:

- **`/tdd` asks you to confirm the seams with the user before writing a test.** The testing seams
  in the spec, which the owner confirmed during planning ([`workflow.md`](../workflow.md) § 1),
  count as that confirmation. Test at them without stopping to ask again. A seam the spec does not
  name still needs the owner.
- **`/research` saves its notes "where the repo already keeps such notes".** That place is
  `.scratch/research/`, one Markdown file per question. It is scratch: a finding that matters is
  promoted to an ADR, a spec or an issue.

## Flag conflicts

If your output contradicts an ADR or a decided constraint, say so explicitly rather than silently
overriding it:

> _Contradicts ADR-0001 (skills are vendored, not installed globally), but worth reopening because…_

Under `AGENTS.md`, adding a system requires an ADR, and an ADR outranks co-located docs and `AGENTS.md`.
