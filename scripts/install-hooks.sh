#!/usr/bin/env bash
# Switches on the repo's git hooks in .githooks/ by pointing core.hooksPath at it. core.hooksPath is
# local git config, so it does not travel with a clone: run this once per clone. Worktrees share
# their clone's config, and the relative path resolves in each one, so a worktree whose checkout
# predates .githooks/ has no hook. It replaces .git/hooks and any global core.hooksPath for this
# clone. scripts/bootstrap.sh calls it. Idempotent.
#
#   scripts/install-hooks.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
echo "Git hooks on: core.hooksPath is .githooks"
