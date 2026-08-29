#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")
DIST_DIR="$ROOT_DIR/dist"
OUTPUT="$DIST_DIR/pro-test-game-$VERSION-xhs-minitool.zip"
TEMP_ZIP="$DIST_DIR/.pro-test-game-$VERSION.$$.zip"

mkdir -p "$DIST_DIR"
trap 'rm -f "$TEMP_ZIP"' EXIT HUP INT TERM

cd "$ROOT_DIR/game"
zip -X -j -9 "$TEMP_ZIP" index.html styles.css game.js >/dev/null
unzip -tq "$TEMP_ZIP"

SIZE=$(wc -c < "$TEMP_ZIP" | tr -d '[:space:]')
if [ "$SIZE" -gt 10485760 ]; then
  echo "Package exceeds the 10 MB limit: $SIZE bytes" >&2
  exit 1
fi

mv "$TEMP_ZIP" "$OUTPUT"
trap - EXIT HUP INT TERM

echo "Package: $OUTPUT"
echo "Size: $SIZE bytes"
shasum -a 256 "$OUTPUT"
