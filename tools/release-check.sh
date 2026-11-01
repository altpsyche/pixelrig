#!/usr/bin/env bash
# The release gate, run by .github/workflows/release.yml before it publishes a tag. Fails when:
#   - the tag is not v<version> of package.json,
#   - the tag's commit is not on <main-ref> (default origin/main),
#   - docs/releases/<tag>.md is missing, its first line is not "# PixelRig <tag>", or its body
#     names another version (a vX.Y.Z other than the tag; a version written without the v is
#     not checked).
# On success it prints the notes body, without the heading, for `gh release create --notes-file`.
#   tools/release-check.sh <tag> [<main-ref>]
#   tools/release-check.sh --notes-only <tag>    the notes checks alone (tools/release-check.test.mjs)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

notes_only=""
if [ "${1:-}" = "--notes-only" ]; then notes_only=1; shift; fi
tag="${1:?usage: tools/release-check.sh [--notes-only] <tag> [<main-ref>]}"
main_ref="${2:-origin/main}"
fail() { echo "release-check: $*" >&2; exit 1; }

if [ -z "$notes_only" ]; then
  version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
  [ "v$version" = "$tag" ] || fail "tag $tag does not match package.json version $version"
  commit="$(git rev-parse --verify -q "$tag^{commit}")" || fail "tag $tag not found"
  git rev-parse --verify -q "$main_ref^{commit}" >/dev/null \
    || fail "$main_ref not found; run git fetch origin first"
  git merge-base --is-ancestor "$commit" "$main_ref" 2>/dev/null \
    || fail "tag $tag is not on $main_ref; release only from a commit on main"
fi

notes="docs/releases/$tag.md"
[ -f "$notes" ] || fail "$notes is missing; write the release notes for $tag there"
heading="# PixelRig $tag"
[ "$(head -n 1 "$notes")" = "$heading" ] || fail "$notes: first line must be \"$heading\""
# The body, from the first non-blank line after the heading.
body="$(tail -n +2 "$notes" | sed '/./,$!d')"
[ -n "$body" ] || fail "$notes has a heading and no notes"
# Every vX.Y.Z in the body must be the tag itself, as in notes copied forward from the last
# release. A token is the tag when it is the tag followed by nothing that would lengthen the
# version: no letter, digit or "-", and no "." before a digit (v0.2.0 is not v0.2.0-beta or
# v0.2.0.1, but is the version in pixelrig-v0.2.0.zip).
while read -r token; do
  rest="${token#"$tag"}"
  if [ "$rest" = "$token" ] || [[ "$rest" =~ ^([[:alnum:]-]|\.[0-9]) ]]; then
    fail "$notes names another version: $(grep -oE '^v[0-9]+\.[0-9]+\.[0-9]+(-[[:alnum:]]+|\.[0-9]+)*' <<<"$token")"
  fi
done < <(grep -oE '(^|[^[:alnum:].])v[0-9]+\.[0-9]+\.[0-9]+[[:alnum:].-]*' <<<"$body" | sed 's/^[^v]*//')
printf '%s\n' "$body"
