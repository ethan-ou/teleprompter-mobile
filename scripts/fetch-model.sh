#!/usr/bin/env bash
# Fetch the on-device STT model and place it in Android assets.
# The model (~131MB) is NOT committed to git; run this once before building.
#
# Model: sherpa-onnx NeMo streaming FastConformer transducer (en, 480ms, int8).
# See docs/voice-asr-plan.md for the rationale.
set -euo pipefail

NAME="sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${NAME}.tar.bz2"
DEST="android/app/src/main/assets/models/fast-conformer-en-480ms"
TMP=".model-tmp"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$DEST/encoder.int8.onnx" ]; then
  echo "Model already present at $DEST — nothing to do."
  exit 0
fi

echo "Downloading $NAME (~100MB compressed)…"
mkdir -p "$TMP"
curl -fSL -o "$TMP/model.tar.bz2" "$URL"
tar xjf "$TMP/model.tar.bz2" -C "$TMP"

echo "Placing model files in $DEST…"
mkdir -p "$DEST"
for f in encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt; do
  cp "$TMP/$NAME/$f" "$DEST/$f"
done

rm -rf "$TMP"
echo "Done. Bundled $(du -sh "$DEST" | cut -f1) into Android assets."
