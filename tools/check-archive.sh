#!/usr/bin/env bash
# Checks a release archive holds only the extension, with package.json at its root.
# The allowlist mirrors the files tools/package.sh ships; change both together.
#   tools/check-archive.sh dist/pixelrig-v<version>.zip
set -euo pipefail
archive="${1:?path to a release archive}"
listing="$(unzip -Z1 "$archive")"
grep -qx 'package.json' <<<"$listing" || { echo "verify: $archive has no package.json at its root" >&2; exit 1; }
allowed='^(package\.json|LICENSE|README\.md|[^/]+\.lua|clips/|clips/[^/]+\.json|rigs/|rigs/[^/]+\.json)$'
if extra="$(grep -Ev "$allowed" <<<"$listing")"; then
  echo "verify: $archive ships files that are not the extension:" >&2
  echo "$extra" >&2
  exit 1
fi
