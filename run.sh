#!/usr/bin/env bash
# Запуск аватара Гермеса: сервер + окно Chromium во весь экран.
cd "$(dirname "$0")"
PORT="${AVATAR_PORT:-8765}"
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  nohup ~/.hermes/hermes-agent/venv/bin/python server.py > avatar.log 2>&1 &
  for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
fi
exec chromium --app="http://127.0.0.1:$PORT/${AVATAR_PATH:-}?auto=1" --start-fullscreen \
  --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required \
  --user-data-dir="$HOME/.config/hermes-avatar-browser" >/dev/null 2>&1
