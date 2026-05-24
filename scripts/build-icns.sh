#!/usr/bin/env bash
# build-icns.sh — Build a macOS .icns from a 1024×1024 master PNG.
#
# macOS-only (uses iconutil + sips, both built in).
#
# Usage:
#   scripts/build-icns.sh <master-png> <output-icns>
#
# Example:
#   scripts/build-icns.sh build/icon.png      build/icon.icns
#   scripts/build-icns.sh build/icon-dark.png build/icon-dark.icns

set -euo pipefail

MASTER="${1:-}"
OUTPUT="${2:-}"

if [ -z "$MASTER" ] || [ -z "$OUTPUT" ]; then
  echo "Usage: $0 <master-png> <output-icns>" >&2
  echo "Example: $0 build/icon.png build/icon.icns" >&2
  exit 1
fi

if [ ! -f "$MASTER" ]; then
  echo "Master PNG not found: $MASTER" >&2
  exit 1
fi

WORKDIR=$(mktemp -d)
ICONSET="$WORKDIR/icon.iconset"
mkdir -p "$ICONSET"

# Generate every required size from the master.
# Apple's iconset expects pairs at 16, 32, 128, 256, 512 plus their @2x
# (i.e. 32, 64, 256, 512, 1024). The 1024 comes from the master itself.
for SIZE in 16 32 64 128 256 512; do
  sips -z "$SIZE" "$SIZE" "$MASTER" --out "$WORKDIR/_$SIZE.png" >/dev/null
done

# Drop into the iconset using Apple's naming convention.
cp "$WORKDIR/_16.png"  "$ICONSET/icon_16x16.png"
cp "$WORKDIR/_32.png"  "$ICONSET/icon_16x16@2x.png"
cp "$WORKDIR/_32.png"  "$ICONSET/icon_32x32.png"
cp "$WORKDIR/_64.png"  "$ICONSET/icon_32x32@2x.png"
cp "$WORKDIR/_128.png" "$ICONSET/icon_128x128.png"
cp "$WORKDIR/_256.png" "$ICONSET/icon_128x128@2x.png"
cp "$WORKDIR/_256.png" "$ICONSET/icon_256x256.png"
cp "$WORKDIR/_512.png" "$ICONSET/icon_256x256@2x.png"
cp "$WORKDIR/_512.png" "$ICONSET/icon_512x512.png"
cp "$MASTER"           "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUTPUT"
rm -rf "$WORKDIR"

echo "Built $OUTPUT"
