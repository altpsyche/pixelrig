#!/usr/bin/env bash
# Link this checkout into Aseprite's user extensions folder.
# Aseprite skips symlinked extension directories (it checks d_type == DT_DIR),
# so we create a real directory and symlink each top-level entry inside it.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${ASEPRITE_USER_DIR:-$HOME/.config/aseprite}/extensions/pixelrig"
rm -rf "$dest"
mkdir -p "$dest"
for f in "$root"/package.json "$root"/*.lua "$root"/clips "$root"/rigs; do
  ln -s "$f" "$dest/"
done
echo "Linked $root -> $dest. Restart Aseprite."
