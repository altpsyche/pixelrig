# TDD at the spec's agreed seam: no second ask, red before green, one slice at a time

## Exercises

- The spec's agreed seams count as `/tdd`'s confirmation, so the session does not stop to ask:
  § Where the skills' open questions are answered in
  [`domain.md`](../../docs/agents/domain.md).
- Tests at the seam only, red before green, one slice at a time, and expected values from an
  independent source: [`tdd`](../../.agents/skills/tdd/SKILL.md), and
  [`workflow.md`](../../docs/workflow.md) § 2, step 6: the check that proves the work is written
  before the work.

## Starting state

On main, before the push: a spec whose seam the owner agreed.

```bash
cat > docs/specs/slug.md <<'EOF'
# Slug helper

Status: agreed with the owner.

## Problem Statement

Branch names are built from ticket titles by hand, and they come out inconsistent.

## Behaviour

`slugify(title)` returns the title's letters and digits, lowercased, in runs joined by single
hyphens. Every other character separates runs. There is no leading or trailing hyphen.

- `slugify("Add a contributing note")` is `"add-a-contributing-note"`
- `slugify("  Fix: CI's   cache!! ")` is `"fix-ci-s-cache"`
- `slugify("")` is `""`

## Testing Decisions

Seam agreed with the owner during planning: `slugify`, the named export of `scripts/slug.mjs`,
tested with `node --test` in `scripts/slug.test.mjs`. No other seam.
EOF
git add docs/specs/slug.md
git commit -qm "Sandbox: the slug helper spec"
```

After bootstrap: a branch to work on.

```bash
git switch -qc slug-helper
```

## Prompt

```
Use /tdd to build the slug helper in docs/specs/slug.md. Commit to the current branch.
```

## Owner replies

None. Every question gets the fallback reply.

## Collect

```bash
git log --format='%h %s' main..slug-helper
git diff --stat main slug-helper
cat scripts/slug.test.mjs
cat scripts/slug.mjs
node --test scripts/slug.test.mjs 2>&1 | tail -n 8
```

## Pass criteria

1. Did it write its first test without asking the owner to confirm the seam?
2. Does every test import `slugify` from `scripts/slug.mjs`?
3. Does every test assert only on what `slugify` returns?
4. Did it add no test file other than `scripts/slug.test.mjs`?
5. For every test, does the transcript show it run and fail before the code that makes it pass was
   written?
6. Did it write at least one test after writing some implementation, rather than every test before
   any implementation?
7. Is every expected value written as a literal, with none computed in the test?
8. Does the last test run in the collected output report `fail 0`?
9. Is `scripts/slug.test.mjs` committed on `slug-helper`?
10. Is `scripts/slug.mjs` committed on `slug-helper`?
