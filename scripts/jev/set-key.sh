#!/usr/bin/env bash
# Saves your TypeSafe key where every Jev tool finds it (ADR-0002): TYPESAFE_API_KEY in the file
# `node scripts/jev/env-file.mjs path` names, by default the gitignored .env at the root of the
# main clone, which serves the clone and every sibling worktree. Reads the key without echoing it,
# writes it single-quoted so a `#` or a space in it survives, replaces any earlier
# TYPESAFE_API_KEY line, keeps every other line, and leaves the file readable by you only. It
# refuses a file inside a repo that does not ignore it. Rerun it to change the key; an empty answer
# changes nothing.
#
# With --offer, as scripts/bootstrap.sh calls it, it first asks whether to add a key at all, and
# only when neither the shell nor the file has one. It always exits 0 then, since the key is
# optional and setup goes on without it.
#
#   scripts/jev/set-key.sh [--offer]
#   printf '%s\n' "$KEY" | scripts/jev/set-key.sh   # no terminal: answers are read from stdin
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = --offer ]; then
  if ! command -v node >/dev/null || node "$here/env-file.mjs" has-key; then exit 0; fi
  [ -t 0 ] && printf 'Add a TypeSafe key for the optional Jev tools now? [y/N] '
  IFS= read -r answer || answer=
  case "$answer" in
    [yY]*) "$0" || echo "No key saved; run scripts/jev/set-key.sh later." >&2 ;;
    *) echo "Skipped; run scripts/jev/set-key.sh later." ;;
  esac
  exit 0
fi

if ! file="$(node "$here/env-file.mjs" path)"; then
  echo "set-key: no key file in use (TYPESAFE_ENV_FILE=none, or not in a repo); nothing written." >&2
  exit 1
fi
dir="$(dirname "$file")"

if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
  ! git -C "$dir" check-ignore -q "$file"; then
  echo "set-key: $file is not gitignored; refusing to write a key there. Add .env to .gitignore." >&2
  exit 1
fi

if [ -t 0 ]; then
  echo "Paste your TypeSafe API key (input hidden), then Enter:"
  IFS= read -rs key || true
  echo
else
  IFS= read -r key || true
fi
# Trim the ends only: a paste often carries a newline or spaces around the key, never inside it.
key="${key#"${key%%[![:space:]]*}"}"
key="${key%"${key##*[![:space:]]}"}"
if [ -z "$key" ]; then
  echo "set-key: no key given; $file is unchanged."
  exit 0
fi
if [[ "$key" == *"'"* ]]; then
  echo "set-key: a key with a single quote cannot be stored safely; $file is unchanged." >&2
  exit 1
fi

umask 077
tmp="$(mktemp "$dir/.env.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
if [ -f "$file" ]; then
  grep -v '^[[:space:]]*\(export[[:space:]]\+\)\?TYPESAFE_API_KEY[[:space:]]*=' "$file" >"$tmp" || true
fi
printf "TYPESAFE_API_KEY='%s'\n" "$key" >>"$tmp"
chmod 600 "$tmp"
mv "$tmp" "$file"
trap - EXIT

echo "Saved TYPESAFE_API_KEY to $file (mode 600)."
# %q quotes the path, so the command pastes as is from a clone whose path has a space in it.
printf 'Check it with one live call: echo hello | node %q\n' "$here/injection-cli.mjs"
