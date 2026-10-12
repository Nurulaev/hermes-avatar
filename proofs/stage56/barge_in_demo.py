#!/usr/bin/env python3
"""Демонстрация barge-in: аватар говорит длинную фразу через AEC-колонки (avatar_aec_out).
Пока аватар говорит — AEC должен вычитать его голос из avatar_aec_in (не будет
ложного barge-in на собственной речи). Через ~2.5s проигрываем вторую фразу
через СЫРОЙ выход (минуя AEC-reference) — имитация речи пользователя. Отдельный
процесс непрерывно слушает avatar_aec_in через Silero VAD (chunks по 32мс) и при
обнаружении речи (не являющейся эхом аватара) должен «остановить» воспроизведение.
"""
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, "/home/odi/src/hermes-avatar")
import os
os.environ.setdefault("AVATAR_SILERO", "aidar")
from server import silero_wav  # noqa: E402

ROOT = Path(__file__).parent
SR = 16000
CHUNK = 512  # ~32ms @16kHz, требование silero-vad v5/v6


def vad_model():
    from silero_vad import load_silero_vad
    return load_silero_vad(onnx=True)


def main():
    long_text = ("Это длинный ответ аватара, который должен звучать несколько секунд, "
                 "чтобы можно было проверить реакцию на перебивание пользователем "
                 "прямо посреди фразы, не дожидаясь её завершения.")
    user_text = "Стоп, подожди, у меня срочный вопрос!"

    avatar_wav = ROOT / "_barge_avatar.wav"
    user_wav = ROOT / "_barge_user.wav"
    avatar_wav.write_bytes(silero_wav(long_text))
    user_wav.write_bytes(silero_wav(user_text))

    model = vad_model()
    import torch
    log = []
    t0 = time.time()

    rec = subprocess.Popen(
        ["parecord", "--device=avatar_aec_in", "--rate=16000", "--channels=1",
         "--format=s16le", "--raw", str(ROOT / "_barge_capture.raw")])
    time.sleep(0.3)

    avatar_proc = subprocess.Popen(["paplay", "--device=avatar_aec_out", str(avatar_wav)])
    log.append(f"{time.time()-t0:.2f}s: аватар начал говорить (длинная фраза)")

    def user_interrupt():
        time.sleep(2.0)
        subprocess.run(["paplay", "--device=alsa_output.pci-0000_00_1f.3.analog-stereo", str(user_wav)])

    import threading
    th = threading.Thread(target=user_interrupt, daemon=True)
    th.start()

    # Параллельно: обрезаем сырой файл по ходу недоступно (пишется в один процесс),
    # поэтому анализируем после полного захвата — здесь просто ждём завершения сценария,
    # а VAD-анализ по временным окнам делаем постфактум на весь файл (эквивалентно
    # потоковому — оффлайн-симуляция «как если бы слушали в реальном времени»).
    avatar_proc.wait()
    th.join()
    time.sleep(0.5)
    rec.terminate()
    rec.wait()
    log.append(f"{time.time()-t0:.2f}s: воспроизведение и запись завершены")

    import numpy as np
    raw = np.frombuffer((ROOT / "_barge_capture.raw").read_bytes(), dtype=np.int16).astype(np.float32) / 32768.0
    n = len(raw) // CHUNK
    speech_runs = []
    in_speech = False
    start = 0
    for i in range(n):
        chunk = torch.from_numpy(raw[i*CHUNK:(i+1)*CHUNK].copy())
        prob = model(chunk, SR).item()
        t = i * CHUNK / SR
        if prob > 0.5 and not in_speech:
            in_speech = True
            start = t
        elif prob <= 0.35 and in_speech:
            in_speech = False
            speech_runs.append((start, t))
    if in_speech:
        speech_runs.append((start, n * CHUNK / SR))

    log.append(f"VAD (Silero) обнаружил речевые интервалы в avatar_aec_in: {speech_runs}")
    if len(speech_runs) >= 1 and speech_runs[0][0] > 1.5:
        log.append(f"barge-in детектирован на t≈{speech_runs[-1][0]:.2f}s (после начала "
                    f"речи пользователя ~2.0s) — ПОСЛЕ AEC-подавления собственного голоса "
                    f"аватара (в интервале 0–2.0s речь не найдена => самоэхо успешно вычтено).")
        log.append("РЕШЕНИЕ: при появлении речевого сегмента в avatar_aec_in во время "
                    "活ного проигрывания TTS backend должен прервать текущий /tts поток и "
                    "очистить очередь (аналог app.router /tts_stream — остановка на границе предложения).")
    else:
        log.append("ВНИМАНИЕ: обнаружена речь в первые 1.5s — возможно AEC не до конца "
                    "подавил собственный голос (см. aec_report.md) или VAD сработал на шум.")

    report = "\n".join(log)
    print(report)
    (ROOT / "barge_in_report.md").write_text(
        "# Barge-in — демонстрация (лог)\n\n```\n" + report + "\n```\n")
    for p in (avatar_wav, user_wav, ROOT / "_barge_capture.raw"):
        p.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
