#!/usr/bin/env bash
# Convert the recorded screencast (output/video.webm) into an optimized
# gif suitable for embedding in README.md.
#
# Two-pass palette generation gives much better quality than a naive
# single-pass conversion. Output is scaled down to keep file size sane.
#
# Usage: bash scripts/screencast/to-gif.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
IN="$DIR/output/video.webm"
PALETTE="$DIR/output/palette.png"
OUT="$DIR/output/termbook-demo.gif"

# Scale to 960px wide (from 1280) — keeps text readable, halves file size.
# 12 fps — terminal motion doesn't need 30 fps, and gif compresses better.
FILTERS="fps=12,scale=960:-1:flags=lanczos"

echo "[gif] generating palette…"
ffmpeg -y -i "$IN" -vf "$FILTERS,palettegen=max_colors=128" "$PALETTE" \
    -loglevel error

echo "[gif] encoding gif…"
ffmpeg -y -i "$IN" -i "$PALETTE" \
    -lavfi "$FILTERS [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5" \
    "$OUT" -loglevel error

echo "[gif] done: $OUT"
ls -lh "$OUT"
