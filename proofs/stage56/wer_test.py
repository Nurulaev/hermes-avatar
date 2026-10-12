#!/usr/bin/env python3
"""WER-тест: 10 русских фраз -> Silero TTS -> колонки (avatar_aec_out) ->
встроенный микрофон через PipeWire AEC (avatar_aec_in) -> whisper (faster-whisper CUDA) -> WER.
Акустический loopback на реальном железе (без участия пользователя).
"""
import io
import subprocess
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, "/home/odi/src/hermes-avatar")
import os
os.environ.setdefault("AVATAR_SILERO", "aidar")
import urllib.request
from server import silero_wav  # noqa: E402

ROOT = Path(__file__).parent
AVATAR_URL = os.environ.get("AVATAR_URL", "http://127.0.0.1:8765")
PHRASES = [
    "Привет, меня зовут Гермес.",
    "Сегодня хорошая погода для прогулки.",
    "Сколько будет два плюс два?",
    "Поставь таймер на пять минут.",
    "Открой список задач на сегодня.",
    "Включи белый шум на телефоне.",
    "Напиши письмо на почту завтра утром.",
    "Сервер перезапустился без ошибок.",
    "Проверь баланс на бирже и пришли отчёт.",
    "Спокойной ночи, увидимся утром.",
]


def norm(s: str) -> str:
    import re as _re
    s = _re.sub(r"\d+", lambda m: __import__("num2words").num2words(int(m[0]), lang="ru"), s)
    s = s.replace("Hermes", "Гермес").replace("hermes", "гермес")
    return " ".join(s.lower().replace("ё", "е").strip(".,!?;:\"'").split())


def play_and_record(wav_bytes: bytes, out_raw: Path, pad_s: float = 0.5):
    with wave.open(io.BytesIO(wav_bytes)) as w:
        dur = w.getnframes() / w.getframerate()
    # Примечание: AEC (avatar_aec_in) целенаправленно вычитает именно этот сигнал
    # как эхо динамиков — для измерения WER пайплайна STT записываем с «сырого»
    # устройства (так ведёт себя реальная речь пользователя, которая не является
    # эталонным сигналом AEC и не подавляется).
    device = os.environ.get("WER_CAPTURE_DEVICE", "alsa_input.pci-0000_00_1f.3.analog-stereo")
    rec = subprocess.Popen(
        ["parecord", f"--device={device}", "--rate=16000", "--channels=1",
         "--format=s16le", "--raw", str(out_raw)])
    time.sleep(0.3)
    tmp = out_raw.with_suffix(".play.wav")
    tmp.write_bytes(wav_bytes)
    subprocess.run(["paplay", "--device=avatar_aec_out", str(tmp)])
    time.sleep(max(pad_s, 1.2))
    rec.terminate()
    rec.wait()
    tmp.unlink(missing_ok=True)


def raw16_to_wav(raw_path: Path) -> bytes:
    data = raw_path.read_bytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(data)
    return buf.getvalue()


def wer(ref: str, hyp: str) -> float:
    r, h = ref.split(), hyp.split()
    dp = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        dp[i][0] = i
    for j in range(len(h) + 1):
        dp[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            if r[i - 1] == h[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[-1][-1] / max(1, len(r))


def stt_via_http(wav_bytes: bytes) -> str:
    req = urllib.request.Request(f"{AVATAR_URL}/stt", data=wav_bytes, method="POST",
                                  headers={"Content-Type": "audio/wav"})
    with urllib.request.urlopen(req, timeout=60) as r:
        import json
        return json.loads(r.read())["text"]


def main():
    results = []
    for i, phrase in enumerate(PHRASES):
        wav = silero_wav(phrase)
        raw = ROOT / f"wer_{i:02d}.raw"
        play_and_record(wav, raw)
        audio_wav = raw16_to_wav(raw)
        t = time.time()
        hyp = stt_via_http(audio_wav)
        dt = time.time() - t
        w = wer(norm(phrase), norm(hyp))
        results.append((phrase, hyp, w, dt))
        print(f"[{i}] REF: {phrase!r}\n    HYP: {hyp!r}\n    WER={w:.2f} stt={dt:.2f}s\n")
        raw.unlink(missing_ok=True)
    avg = sum(r[2] for r in results) / len(results)
    with open(ROOT / "wer_report.md", "w") as f:
        f.write("# WER-отчёт — акустический loopback (Silero TTS -> колонки -> сырой ALC256 вход -> /stt production, whisper large-v3-turbo CUDA)\n\n")
        f.write("Примечание: голос эталона синтезирован (Silero), не человеческая речь — оценка качества STT-пайплайна и акустики, не замена реального теста с пользователем. AEC-источник (avatar_aec_in) не использован намеренно: он подавляет этот же сигнал как эхо колонок (см. aec_report.md) — для живой речи пользователя подавления не будет.\n\n")
        f.write(f"Средний WER: **{avg*100:.1f}%** на {len(results)} фразах.\n\n")
        f.write("| # | Эталон | Распознано | WER |\n|---|---|---|---|\n")
        for i, (ref, hyp, w, dt) in enumerate(results):
            f.write(f"| {i} | {ref} | {hyp} | {w*100:.0f}% |\n")
    print(f"\nСРЕДНИЙ WER: {avg*100:.1f}%")


if __name__ == "__main__":
    main()
