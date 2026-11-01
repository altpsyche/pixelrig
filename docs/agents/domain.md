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

Distinctions agents most often blur:

- **Clip** vs **sprite animation** — a clip is motion data with no pixels; the sprite's frames are
  the artist's. Never "animation" for a clip.
- **Pose** vs **skeleton** — a pose is channel values; a skeleton is the pose solved to joint
  positions.
- **Key pose** vs **key** — a key pose is a named moment of the whole clip that owns
  spacing; a key is one channel's value at one time.
- **Key pose** vs **drawing role** — a key pose belongs to a clip (motion data); a drawing role
  (key, breakdown, inbetween) belongs to one of the artist's drawings. Neither is a "mark" in prose.
- **Drawing** vs **cel** — a drawing is one frame of the artist's animation; a cel is one layer's
  image in that frame.
- **Exposure** vs **duration** — an exposure is a whole number of base frames; a duration is the
  frame's milliseconds in Aseprite. The exposure sheet derives one from the other.
- **Ghost** vs **ghost layer** — the ghost is the rendered figure; the ghost layer is the
  reference layer that holds it.
- **Range** vs **tag** — a range is where a ghost lives: all frames or one tag. PixelRig's own
  key pose tags are never a range.
- **Preview** vs **apply** — preview renders in the dialog only; apply writes to the sprite.
- **Near / far** vs **left / right** — sides are relative to the viewer, not the body.

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
