#!/usr/bin/env bash
# Downloads the H5P core + editor static assets into h5p-data/{core,editor}.
# These ship separately from @lumieducation/h5p-server and must exist on disk
# before the browser-side editor/player can load.
# Safe to re-run: skips download when target dirs already contain files.

set -euo pipefail

CORE_VERSION="wp-1.16.0"
EDITOR_VERSION="wp-1.16.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${H5P_DATA_DIR:-$ROOT_DIR/h5p-data}"
CORE_DIR="$DATA_DIR/core"
EDITOR_DIR="$DATA_DIR/editor"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fetch() {
  local name="$1" version="$2" repo="$3" dest="$4"
  if [ -d "$dest" ] && [ "$(ls -A "$dest" 2>/dev/null)" ]; then
    echo "[$name] already present at $dest — skipping"
    return
  fi
  echo "[$name] fetching $repo@$version"
  mkdir -p "$dest"
  local url="https://github.com/h5p/$repo/archive/refs/tags/$version.tar.gz"
  curl -fsSL "$url" -o "$TMP_DIR/$name.tar.gz"
  tar -xzf "$TMP_DIR/$name.tar.gz" -C "$TMP_DIR"
  # Tarball extracts to $repo-$version/ — move its contents into dest.
  cp -R "$TMP_DIR/$repo-$version"/* "$dest/"
  echo "[$name] installed to $dest"
}

mkdir -p "$DATA_DIR"
fetch "core"   "$CORE_VERSION"   "h5p-php-library"        "$CORE_DIR"
fetch "editor" "$EDITOR_VERSION" "h5p-editor-php-library" "$EDITOR_DIR"

echo "Done. Core → $CORE_DIR, editor → $EDITOR_DIR"
