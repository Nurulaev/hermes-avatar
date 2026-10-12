#!/usr/bin/env python3
"""Этап 7 — мост озвучки: отдельный read-only SSE-клиент /events на :8765.

Не трогает static/vrm.html и server.py (во избежание коллизий с параллельными
воркерами Ф2/Ф3/Ф4) — слушает уже существующий SSE-канал /events (куда льёт
POST /push), сам синтезирует TTS через существующий POST /tts и проигрывает
звук через paplay. Так cron- и Telegram-уведомления, отправленные обычным
POST /push, звучат из колонок даже если окно Electron не в фокусе/прячется.

Лог: ~/src/hermes-avatar/proofs/stage7/voice_bridge.log (одна строка на событие).
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import urllib.request

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
LOG_PATH = "/home/odi/src/hermes-avatar/proofs/stage7/voice_bridge.log"


def log(line: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    msg = f"[{ts}] {line}"
    print(msg, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


def synth_and_play(text: str) -> None:
    if not text.strip():
        return
    req = urllib.request.Request(
        f"{BASE}/tts",
        data=json.dumps({"text": text}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        wav = resp.read()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav)
        path = f.name
    log(f"TTS ok ({len(wav)}B) -> играю: {text!r}")
    subprocess.run(["paplay", path], check=False)


def handle_message(msg: dict) -> None:
    mtype = msg.get("type")
    if mtype == "say":
        text = " ".join(p.get("text", "") for p in msg.get("parts", []) if p.get("text"))
        log(f"событие say получено: {text!r}")
        synth_and_play(text)
    elif mtype == "emotion":
        log(f"событие emotion: {msg.get('emotion')}")
    elif mtype == "viz":
        log("событие viz получено (без звука)")
    elif mtype == "clear":
        log("событие clear получено")


def run_forever() -> None:
    log("voice_bridge стартовал, подключаюсь к /events")
    while True:
        try:
            req = urllib.request.Request(f"{BASE}/events", headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                log("подключён к SSE /events")
                buf = b""
                while True:
                    chunk = resp.read(1)
                    if not chunk:
                        break
                    buf += chunk
                    if buf.endswith(b"\n\n"):
                        for line in buf.decode("utf-8", "ignore").splitlines():
                            if line.startswith("data: "):
                                try:
                                    handle_message(json.loads(line[6:]))
                                except Exception as e:  # noqa: BLE001
                                    log(f"ошибка разбора события: {e!r}")
                        buf = b""
        except Exception as e:  # noqa: BLE001
            log(f"соединение с /events упало ({e!r}), переподключаюсь через 3с")
            time.sleep(3)


if __name__ == "__main__":
    run_forever()
