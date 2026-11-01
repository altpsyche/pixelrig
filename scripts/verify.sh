#!/usr/bin/env bash
# Everything CI runs. Phase 0 appends the project's own checks at the end.
#
#   scripts/verify.sh
set -euo pipefail
# The tree this script lives in, whatever folder it is run from: a worktree's verify.sh checks that
# worktree when run by path from the main clone (docs/agents/issue-tracker.md § Conventions).
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Agent layer: skill frontmatter, doc links, commands a shell guard refuses, no harness-specific
# files, AGENTS.md budget, the tracker's claim read-back and frontier queries, this script's own
# test, the pre-push hook's own test, bootstrap.sh's ruleset step against a stub gh, the eval
# case parser over every case in evals/, the eval runner scripts, which build and collect every
# case's sandbox against a stub gh and a local remote, and the eval cleanup script against a stub
# gh. Plain Node, no packages; the query tests, the stub's list cases and the cleanup test also run
# jq, and skip without it outside CI, saying so in one line. Without Node on this machine it is
# skipped here; CI always runs it.
if command -v node >/dev/null; then
  command -v jq >/dev/null || echo "verify: jq not found, the tests that run it skipped (CI runs them)" >&2
  node scripts/check-skills.mjs
  node --test scripts/check-skills.test.mjs scripts/claim-readback.test.mjs \
    scripts/frontier.test.mjs scripts/verify.test.mjs scripts/install-hooks.test.mjs \
    scripts/bootstrap.test.mjs scripts/eval-case.test.mjs scripts/eval-runner.test.mjs \
    scripts/eval-cleanup.test.mjs
  # Jev tools (ADR-0002), against a fake local server: no key, no network.
  node --test scripts/jev/*.test.mjs
else
  echo "verify: node not found, agent-layer check and tests skipped (CI runs them)" >&2
fi

# Secrets: all history reachable in this clone, not just the tree, because a secret deleted in a
# later commit is still published. Known false positives go in .gitleaksignore with a reason. Skipped
# locally without gitleaks; CI always installs it.
if command -v gitleaks >/dev/null; then
  gitleaks git --redact --no-banner .
else
  echo "verify: gitleaks not found, secret scan skipped (CI runs it)" >&2
fi

# Project checks: add them here in Phase 0.
