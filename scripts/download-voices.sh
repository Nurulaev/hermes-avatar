#!/usr/bin/env bash
# Скачивает русские голоса Piper TTS (CC0 / MIT, проект rhasspy/piper-voices),
# которые .gitignore исключает из репозитория из-за размера (~60 МБ каждый).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p voices

BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU"
VOICES=(denis dmitri ruslan)

for v in "${VOICES[@]}"; do
  for ext in onnx onnx.json; do
    dest="voices/ru_RU-${v}-medium.${ext}"
    if [ -f "$dest" ]; then
      echo "skip (exists): $dest"
      continue
    fi
    url="${BASE}/${v}/medium/ru_RU-${v}-medium.${ext}"
    echo "downloading $url -> $dest"
    curl -fL "$url" -o "$dest"
  done
done

echo "Готово. Голоса лежат в voices/."
