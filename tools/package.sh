#!/usr/bin/env bash
# Build installable extension packages into dist/.
#   pixelrig-v<version>.aseprite-extension  double-click (or Edit > Preferences > Extensions > Add Extension)
#   pixelrig-v<version>.zip                 same contents, for manual install
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$version" ] || { echo "version not found in package.json" >&2; exit 1; }

files=(package.json LICENSE README.md *.lua clips rigs)
name="pixelrig-v$version"
mkdir -p dist
rm -f "dist/$name.zip" "dist/$name.aseprite-extension"
# package.json must sit at the archive root for Aseprite's installer.
zip -q -r -X "dist/$name.zip" "${files[@]}"
cp "dist/$name.zip" "dist/$name.aseprite-extension"
echo "dist/$name.aseprite-extension"
echo "dist/$name.zip"
