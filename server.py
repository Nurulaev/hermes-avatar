#!/usr/bin/env python3
"""Hermes Avatar — локальный сервер: STT (faster-whisper) → Hermes API → TTS (edge-tts)."""
import asyncio
import io
import json
import os
import re
import time
from pathlib import Path

import aiohttp
import numpy as np
from aiohttp import web

ROOT = Path(__file__).parent
PORT = int(os.environ.get("AVATAR_PORT", "8765"))
HERMES_URL = os.environ.get("HERMES_URL", "http://127.0.0.1:8642/v1/chat/completions")
VOICE = os.environ.get("AVATAR_VOICE", "ru-RU-DmitryNeural")
WHISPER_MODEL = os.environ.get("AVATAR_WHISPER", "large-v3-turbo")

EMOTIONS = ["нейтрально", "радость", "грусть", "удивление", "задумчивость", "злость", "смущение"]  # legacy-метки [радость]
# Э3: 12 смешиваемых эмоций (РЕШЕНИЕ, имена фиксированы) — тег [эмо:имя 0.7]; жесты — [жест:имя]
EMO12 = ["радость", "грусть", "злость", "страх", "удивление", "отвращение", "интерес", "скука",
         "смущение", "гордость", "усталость", "нейтраль"]
EMO_LEGACY = {"нейтрально": "нейтраль", "задумчивость": "интерес"}
GESTURES = ["nod", "shake", "wave", "shrug", "point", "cross_arms", "explain", "think", "celebrate", "fist", "beatL", "beatR"]
MOTIONS = ["nod", "shake", "bow", "lookAround", "turnLeft", "turnRight", "stretch", "idle", "talk"]
SYSTEM = (
    "Ты — Гермес, говоришь голосом через аватар на экране. Отвечай по-русски, коротко и разговорно "
    "(1–3 предложения), без markdown, списков, эмодзи и ссылок — текст будет озвучен. "
    "Начинай КАЖДЫЙ ответ с тега эмоции [эмо:имя сила], сила 0.1–1, например [эмо:радость 0.7]. Имена: "
    + ", ".join(EMO12)
    + ". Эмоции смешиваются: можно поставить два тега подряд ([эмо:интерес 0.6][эмо:радость 0.3]); "
    "внутри ответа меняй эмоцию новым тегом. Жесты тела — [жест:имя] перед фразой, редко, по смыслу: "
    + ", ".join(GESTURES[:10]) + ". "
    "Вокруг твоей головы на экране — пространство мыслей: ты можешь рисовать там то, о чём говоришь. "
    "Теги визуализации НЕ озвучиваются, ставь тег перед фразой, к которой он относится. Форматы: "
    "[виз: мысль | короткая фраза]; [виз: иконки | 🚀 Ракета; 🌕 Луна; 🛰 Спутник]; "
    "[виз: схема | Идея -> Код -> Тесты -> Деплой]; [виз: список | пункт; пункт; пункт]; "
    "[виз: число | 384 400 км | до Луны]; [виз: график | Python 30; JS 25; Go 10 | заголовок]; "
    "[виз: код | одна-две строки кода]; "
    "[виз: svg | <svg viewBox='0 0 200 140' xmlns='http://www.w3.org/2000/svg'>...</svg>] — собственный простой рисунок, "
    "яркие цвета на тёмном фоне, без текста мельче 12px; "
    "[виз: mermaid | graph TD; A-->B; B-->C] — блок-схема/диаграмма mermaid (разделяй строки символом ;); "
    "[виз: картинка | URL | подпись] — показать картинку по ссылке (например, из image_generate); "
    "[виз: очистить]. "
    "Используй 1–3 визуализации, когда они помогают: числа, сравнения, процессы, предметы, планы, объяснения. "
    "На простую реплику без содержания — без визуализаций. Эмодзи разрешены только внутри тегов."
)


def _api_key() -> str:
    key = os.environ.get("API_SERVER_KEY", "")
    if key:
        return key
    env = Path.home() / ".hermes" / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("API_SERVER_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    return ""


API_KEY = _api_key()
history: list[dict] = []
_whisper = None


def _preload_cuda_libs():
    """cuBLAS/cuDNN из pip-пакетов nvidia-* — подгружаем явно, без LD_LIBRARY_PATH."""
    import ctypes, glob
    try:
        import nvidia.cublas, nvidia.cudnn
        for pkg in (nvidia.cublas, nvidia.cudnn):
            for so in sorted(glob.glob(os.path.join(pkg.__path__[0], "lib", "*.so*"))):
                try:
                    ctypes.CDLL(so, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass
    except ImportError:
        pass


# Подсказка словаря: имена и термины, которые whisper иначе коверкает
STT_PROMPT = os.environ.get("AVATAR_STT_PROMPT",
    "Гермес, привет. Hermes, VPS, VPN, Telegram, Obsidian, Python, сервер, скрипт, задача, аватар.")
# Типичные галлюцинации whisper на тишине/шуме (наследие YouTube-субтитров)
HALLU = re.compile(r"(следующ\w* видео|подписывайтесь|ставьте лайк|субтитр|продолжение следует|"
                   r"спасибо за просмотр|редактор субтитров|DimaTorzok)", re.I)


def get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        import numpy as np
        _preload_cuda_libs()
        try:
            m = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="int8_float16")
            list(m.transcribe(np.zeros(16000, dtype=np.float32), language="ru")[0])  # проверка cuBLAS
            _whisper = m
            print(f"[stt] whisper {WHISPER_MODEL} on CUDA")
        except Exception as e:  # noqa: BLE001
            print(f"[stt] CUDA недоступна ({e}); CPU")
            # turbo на CPU медленный — для CPU откат на small
            _whisper = WhisperModel(os.environ.get("AVATAR_WHISPER_CPU", "small"), device="cpu",
                                    compute_type="int8", cpu_threads=8)
    return _whisper


def transcribe(data: bytes) -> str:
    segs, _ = get_whisper().transcribe(
        io.BytesIO(data), language="ru", beam_size=5, condition_on_previous_text=False,
        initial_prompt=STT_PROMPT, temperature=(0.0, 0.2, 0.4),
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 300},
        no_speech_threshold=0.5, log_prob_threshold=-1.0, compression_ratio_threshold=2.2)
    out = []
    for s in segs:
        t = s.text.strip()
        if not t or (s.no_speech_prob > 0.6 and s.avg_logprob < -0.7) or HALLU.search(t):
            print(f"[stt] отброшено: {t!r} (ns={s.no_speech_prob:.2f}, lp={s.avg_logprob:.2f})")
            continue
        out.append(t)
    return " ".join(out).strip()


async def stt(request: web.Request):
    data = await request.read()
    t = time.time()
    text = await asyncio.to_thread(transcribe, data)
    print(f"[stt] {time.time()-t:.2f}s: {text!r}")
    return web.json_response({"text": text})


VIZ_SVG = r"\[виз:\s*(?:svg|рисунок)\s*\|\s*(<svg[\s\S]*?</svg>)\s*\]"
EMO_TAG = r"\[эмо:\s*([а-яё]+)\s*([01](?:[.,]\d+)?)?\s*\]"
GEST_TAG = r"\[жест:\s*([A-Za-z_]+)\s*\]"
TOKEN = re.compile(VIZ_SVG + r"|\[виз:([^\]]*)\]|" + EMO_TAG + "|" + GEST_TAG + r"|(\[[^\]]{2,20}\])", re.I)


def parse_viz(body: str) -> dict:
    f = [x.strip() for x in body.split("|")]
    t = f[0].lower() if f and f[0] else "мысль"
    if len(f) == 1:
        return {"type": "мысль", "args": [f[0]]}
    return {"type": t, "args": f[1:]}


def split_emotions(raw: str):
    """'[радость] [виз: число | 42 | ответ] Привет!' → [{emotion, text, viz:[...]}, ...]"""
    parts, emo, pending, pos = [], "нейтрально", [], 0
    emo_p, gest_p = [], []          # Э3: [эмо:имя w] / [жест:имя] — применяются в начале следующей фразы

    def flush(txt):
        nonlocal pending, emo_p, gest_p
        txt = re.sub(r"[*_`#>]+", "", txt).strip()
        if txt:
            parts.append({"emotion": emo, "text": txt, "viz": pending, "emo": emo_p, "gestures": gest_p})
            pending, emo_p, gest_p = [], [], []

    for m in TOKEN.finditer(raw):
        flush(raw[pos:m.start()])
        pos = m.end()
        if m.group(1):
            pending.append({"type": "svg", "args": [m.group(1)]})
        elif m.group(2) is not None:
            pending.append(parse_viz(m.group(2)))
        elif m.group(3):
            name = EMO_LEGACY.get(m.group(3).lower(), m.group(3).lower())
            if name in EMO12:
                w = float((m.group(4) or "1").replace(",", "."))
                emo_p.append({"name": name, "weight": max(0.0, min(1.0, w))})
                emo = name
        elif m.group(5):
            if m.group(5) in GESTURES:
                gest_p.append(m.group(5))
        else:
            tag = m.group(6)[1:-1].strip().lower()
            if tag in EMOTIONS:
                emo = tag
                emo_p.append({"name": EMO_LEGACY.get(tag, tag), "weight": 1.0})
            else:
                flush(m.group(3))
    flush(raw[pos:])
    if pending or emo_p or gest_p:
        if parts:
            parts[-1]["viz"] += pending
            parts[-1]["emo"] += emo_p
            parts[-1]["gestures"] += gest_p
        else:
            parts.append({"emotion": emo, "text": "", "viz": pending, "emo": emo_p, "gestures": gest_p})
    return parts or [{"emotion": emo, "text": raw.strip(), "viz": [], "emo": [], "gestures": []}]


# ---------- внешний канал: /push → SSE /events → страница ----------
_listeners: set = set()


async def events(request: web.Request):
    resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
    await resp.prepare(request)
    q: asyncio.Queue = asyncio.Queue()
    _listeners.add(q)
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), 20)
                await resp.write(f"data: {json.dumps(msg, ensure_ascii=False)}\n\n".encode())
            except asyncio.TimeoutError:
                await resp.write(b": ping\n\n")
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        _listeners.discard(q)
    return resp


async def push(request: web.Request):
    """{"say": "[радость] [виз: ...] текст"} — сказать и показать; {"viz": [...]} / {"show": "[виз: ...]"} — только показать;
    {"clear": true}; {"emotion": "радость"}."""
    b = await request.json()
    if b.get("clear"):
        msg = {"type": "clear"}
    elif b.get("say"):
        msg = {"type": "say", "parts": split_emotions(b["say"])}
    elif b.get("show"):
        msg = {"type": "viz", "viz": [v for p in split_emotions(b["show"]) for v in p["viz"]]}
    elif b.get("viz"):
        msg = {"type": "viz", "viz": b["viz"]}
    elif b.get("emotion"):
        msg = {"type": "emotion", "emotion": b["emotion"]}
    elif b.get("toolcall"):
        # Ф4: живой стрим tool-calls Hermes — {"toolcall": {"stage": "think|search|read|write|exec|tool|output|done|error", "label": "..."}}
        tc = b["toolcall"]
        msg = {"type": "toolcall", "stage": tc.get("stage", "tool"), "label": tc.get("label")}
    else:
        return web.json_response({"ok": False, "error": "say | show | viz | clear | emotion | toolcall"}, status=400)
    for q in list(_listeners):
        q.put_nowait(msg)
    return web.json_response({"ok": True, "listeners": len(_listeners), "msg": msg})


# ---------- Э3: управление телом аватара (контракт в комментарии t_f3e9fc39) ----------
MOTION_DIR = Path(__file__).parent / "assets" / "motions"


def _broadcast(msg) -> int:
    for q in list(_listeners):
        q.put_nowait(msg)
    return len(_listeners)


async def api_gestures(request: web.Request):
    vrma = sorted(f"/assets/motions/{p.name}" for p in MOTION_DIR.glob("*.vrma")) if MOTION_DIR.exists() else []
    return web.json_response({"gestures": GESTURES, "motions": MOTIONS + vrma, "emotions": EMO12})


async def api_gesture(request: web.Request):
    b = await request.json()
    name = (b.get("name") or "").strip()
    if name not in GESTURES:
        return web.json_response({"ok": False, "error": "unknown_gesture", "available": GESTURES}, status=404)
    if not _listeners:
        return web.json_response({"ok": False, "error": "avatar_not_connected"}, status=503)
    _broadcast({"type": "gesture", "name": name})
    return web.json_response({"ok": True, "name": name})


async def api_motion(request: web.Request):
    """{"name": "bow"} — встроенное движение; {"url": "/assets/motions/x.vrma", "loop": false} — файл VRMA."""
    b = await request.json()
    name, url = (b.get("name") or "").strip(), (b.get("url") or "").strip()
    vrma = sorted(f"/assets/motions/{p.name}" for p in MOTION_DIR.glob("*.vrma")) if MOTION_DIR.exists() else []
    if not ((name and name in MOTIONS) or (url and url in vrma)):
        return web.json_response({"ok": False, "error": "motion_not_found", "available": MOTIONS + vrma}, status=404)
    if not _listeners:
        return web.json_response({"ok": False, "error": "avatar_not_connected"}, status=503)
    _broadcast({"type": "motion", "name": name or None, "url": url or None, "loop": bool(b.get("loop"))})
    return web.json_response({"ok": True, **({"name": name} if name else {"url": url})})


async def chat(request: web.Request):
    body = await request.json()
    user = (body.get("text") or "").strip()
    if not user:
        return web.json_response({"parts": []})
    history.append({"role": "user", "content": user})
    msgs = [{"role": "system", "content": SYSTEM}] + history[-20:]
    t = time.time()
    async with aiohttp.ClientSession() as s:
        async with s.post(
            HERMES_URL,
            json={"model": "hermes-agent", "messages": msgs, "stream": False},
            headers={"Authorization": f"Bearer {API_KEY}"},
            timeout=aiohttp.ClientTimeout(total=300),
        ) as r:
            js = await r.json(content_type=None)
    try:
        reply = js["choices"][0]["message"]["content"] or ""
    except Exception:  # noqa: BLE001
        reply = "[смущение] Что-то пошло не так с моим мозгом. " + json.dumps(js, ensure_ascii=False)[:120]
    history.append({"role": "assistant", "content": reply})
    print(f"[llm] {time.time()-t:.1f}s: {reply[:120]!r}")
    return web.json_response({"parts": split_emotions(reply), "raw": reply})


_silero = None
SILERO_SPEAKER = os.environ.get("AVATAR_SILERO", "aidar")
_LAT = {"a": "эй", "b": "би", "c": "си", "d": "ди", "e": "и", "f": "эф", "g": "джи", "h": "эйч", "i": "ай",
        "j": "джей", "k": "кей", "l": "эл", "m": "эм", "n": "эн", "o": "оу", "p": "пи", "q": "кью", "r": "ар",
        "s": "эс", "t": "ти", "u": "ю", "v": "ви", "w": "дабл ю", "x": "икс", "y": "уай", "z": "зед"}
_WORDS = {"hermes": "гермес", "telegram": "телеграм", "obsidian": "обсидиан", "python": "пайтон",
          "linux": "линукс", "github": "гитхаб", "chrome": "хром", "chromium": "хромиум", "ok": "окей",
          "api": "эй пи ай", "ai": "эй ай", "gpu": "джи пи ю", "cpu": "си пи ю"}


def norm_ru(text: str) -> str:
    """Silero читает только кириллицу: цифры → слова, латиница → транскрипция."""
    from num2words import num2words
    text = re.sub(r"(\d+)[.,](\d+)", lambda m: f"{num2words(int(m[1]), lang='ru')} и {num2words(int(m[2]), lang='ru')}", text)
    text = re.sub(r"\d+", lambda m: num2words(int(m[0]), lang="ru"), text)
    text = text.replace("%", " процентов").replace("&", " и ").replace("+", " плюс ")

    def lat(m):
        w = m[0]
        if w.lower() in _WORDS:
            return _WORDS[w.lower()]
        if w.isupper() or len(w) <= 3:
            return " ".join(_LAT[c] for c in w.lower())
        return w  # длинные латинские слова — как есть (silero их пропустит)
    return re.sub(r"[A-Za-z]+", lat, text)


def silero_wav(text: str) -> bytes:
    global _silero
    import wave
    import torch
    if _silero is None:
        torch.set_num_threads(6)
        _silero, _ = torch.hub.load("snakers4/silero-models", "silero_tts", language="ru",
                                    speaker="v5_ru", trust_repo=True)
    a = _silero.apply_tts(text=norm_ru(text), speaker=SILERO_SPEAKER, sample_rate=48000,
                          put_accent=True, put_yo=True)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
        w.writeframes((a.clamp(-1, 1) * 32767).short().numpy().tobytes())
    return buf.getvalue()


_piper = None
PIPER_VOICE = os.environ.get("AVATAR_PIPER", "ru_RU-dmitri-medium")


def piper_wav(text: str) -> bytes:
    global _piper
    import wave
    from piper import PiperVoice
    if _piper is None:
        _piper = PiperVoice.load(str(ROOT / "voices" / f"{PIPER_VOICE}.onnx"))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        _piper.synthesize_wav(text, w)
    return buf.getvalue()


FFMPEG = os.environ.get("FFMPEG", str(Path.home() / ".hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg"))
# Голосовые эффекты поверх TTS. AVATAR_FX=none — чистый голос.
VOICE_FX = {
    # Естественный мужской бас: питч ниже ~3 полутонов с сохранением формант (без «мультяшности»),
    # тёплый низ, мягкая середина, без эха и перегруза
    "bass": "[0:a]aresample=44100,rubberband=pitch=0.84:formant=preserved:pitchq=quality,"
            "equalizer=f=110:t=q:w=0.8:g=4,equalizer=f=250:t=q:w=1:g=1.5,"
            "equalizer=f=3500:t=q:w=1.2:g=-1.5,highpass=f=45,"
            "acompressor=threshold=0.25:ratio=2.5:attack=8:release=120,alimiter=limit=0.95",
    # Обычный голос, только ниже: ~-2.2 полутона без замедления, лёгкий бас
    "low": "[0:a]aresample=44100,asetrate=44100*0.88,aresample=44100,atempo=1.136,"
           "equalizer=f=140:t=q:w=1:g=3,alimiter=limit=0.95",
    # Иллидан: ниже на ~3.5 полутона, суб-октава, бас, лёгкий перегруз, короткое эхо
    "illidan": "[0:a]aresample=44100,asetrate=44100*0.82,aresample=44100,atempo=1.12,asplit=2[a][b];"
               "[b]asetrate=44100*0.5,aresample=44100,atempo=2,volume=0.35[sub];"
               "[a][sub]amix=inputs=2:normalize=0,equalizer=f=120:t=q:w=1:g=5,"
               "equalizer=f=3000:t=q:w=1:g=-3,asoftclip=type=tanh,"
               "aecho=0.8:0.6:45|90:0.22|0.12,highpass=f=50,alimiter=limit=0.9",
}


async def apply_fx(audio: bytes) -> bytes:
    fx = VOICE_FX.get(os.environ.get("AVATAR_FX", "bass"))
    if not fx:
        return audio
    p = await asyncio.create_subprocess_exec(
        FFMPEG, "-loglevel", "error", "-i", "pipe:0", "-filter_complex", fx, "-f", "wav", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await p.communicate(audio)
    if p.returncode or not out:
        print(f"[tts] fx упал: {err[:200]!r}")
        return audio
    return out


async def tts(request: web.Request):
    """Основной голос — Silero v5 (локально, естественнее Piper). TTS_ENGINE=piper|edge — другие движки."""
    text = (await request.json()).get("text", "")
    t = time.time()
    engine = os.environ.get("TTS_ENGINE", "silero")
    if engine == "silero" and re.search(r"[А-Яа-яЁёA-Za-z0-9]", text):
        try:
            wav = await apply_fx(await asyncio.to_thread(silero_wav, text))
            print(f"[tts] silero/{SILERO_SPEAKER} {time.time()-t:.2f}s, {len(wav)}B")
            return web.Response(body=wav, content_type="audio/wav")
        except Exception as e:  # noqa: BLE001
            print(f"[tts] silero упал ({type(e).__name__}: {e}), fallback piper")
    if engine == "edge":
        try:
            import edge_tts
            buf = bytearray()
            async for ch in edge_tts.Communicate(text, VOICE, rate="+5%").stream():
                if ch["type"] == "audio":
                    buf.extend(ch["data"])
            if buf:
                out = await apply_fx(bytes(buf))
                return web.Response(body=out, content_type="audio/wav" if out[:4] == b"RIFF" else "audio/mpeg")
        except Exception as e:  # noqa: BLE001
            print(f"[tts] edge упал ({type(e).__name__}), fallback piper")
    wav = await apply_fx(await asyncio.to_thread(piper_wav, text))
    print(f"[tts] piper {time.time()-t:.2f}s, {len(wav)}B")
    return web.Response(body=wav, content_type="audio/wav")


SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+")


async def tts_lips(request: web.Request):
    """Ф3: голос + фонемный timeline визем. JSON {text} → {audio: base64 WAV, timeline, phones, engine, align}.
    Silero: CPU forced alignment (HSMM) по сухому звуку; Piper: нативные тайминги движка.
    FX (rubberband/asetrate+atempo) сохраняет длительность, поэтому timeline валиден и после FX."""
    import base64
    import lipsync
    text = ((await request.json()).get("text") or "").strip()
    t = time.time()
    engine = os.environ.get("TTS_ENGINE", "silero")
    res = None
    if engine == "silero" and re.search(r"[А-Яа-яЁёA-Za-z0-9]", text):
        try:
            dry = await asyncio.to_thread(silero_wav, text)
            res = await asyncio.to_thread(lipsync.lips_for_wav, norm_ru(text), dry)
            res["engine"] = "silero"
        except Exception as e:  # noqa: BLE001
            print(f"[tts_lips] silero упал ({type(e).__name__}: {e}), fallback piper")
    if res is None:
        dry, res = await asyncio.to_thread(lipsync.lips_piper, text)
        res["engine"] = "piper"
    wav = await apply_fx(dry)
    res["audio"] = base64.b64encode(wav).decode()
    print(f"[tts_lips] {res['engine']}/{res['align']} {time.time()-t:.2f}s (выравнивание {res['ms']} мс), "
          f"{len(res['timeline'])} визем")
    return web.json_response(res)


async def lips(request: web.Request):
    """Выравнивание готового WAV: JSON {text, audio: base64 WAV} → {timeline, phones}."""
    import base64
    import lipsync
    body = await request.json()
    res = await asyncio.to_thread(lipsync.lips_for_wav, body.get("text", ""), base64.b64decode(body["audio"]))
    return web.json_response(res)


def split_sentences(text: str) -> list[str]:
    """Режем на предложения для потоковой озвучки — первая фраза уходит в TTS сразу,
    не дожидаясь генерации всего текста."""
    parts = [p.strip() for p in SENT_SPLIT.split(text.strip()) if p.strip()]
    return parts or ([text.strip()] if text.strip() else [])


async def synth_one(text: str) -> bytes:
    engine = os.environ.get("TTS_ENGINE", "silero")
    if engine == "silero" and re.search(r"[А-Яа-яЁёA-Za-z0-9]", text):
        try:
            return await apply_fx(await asyncio.to_thread(silero_wav, text))
        except Exception as e:  # noqa: BLE001
            print(f"[tts_stream] silero упал ({type(e).__name__}: {e}), fallback piper")
    return await apply_fx(await asyncio.to_thread(piper_wav, text))


async def tts_stream(request: web.Request):
    """Потоковая озвучка по предложениям: multipart/mixed, каждая часть — готовый WAV
    одного предложения. Клиент может начать проигрывание первой части, не ожидая
    синтеза всего ответа. Не подключён к существующим страницам (index/toon/index3d) —
    добавочный backend-эндпоинт для Ф5.3, разбор потока на фронтенде — отдельная задача.
    """
    body = await request.json()
    text = (body.get("text") or "").strip()
    sentences = split_sentences(text)
    t0 = time.time()
    boundary = "avatarwav"
    resp = web.StreamResponse(headers={
        "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}",
        "Cache-Control": "no-cache",
    })
    await resp.prepare(request)
    for i, s in enumerate(sentences):
        wav = await synth_one(s)
        dt_first = time.time() - t0
        print(f"[tts_stream] предложение {i} ({s[:40]!r}…): +{dt_first:.2f}s с начала запроса, {len(wav)}B")
        header = (f"--{boundary}\r\nContent-Type: audio/wav\r\nContent-Length: {len(wav)}\r\n"
                  f"X-Sentence-Index: {i}\r\nX-Elapsed: {dt_first:.3f}\r\n\r\n").encode()
        await resp.write(header + wav + b"\r\n")
    await resp.write(f"--{boundary}--\r\n".encode())
    return resp


_barge_clients: set[web.WebSocketResponse] = set()


async def barge_in_ws(request: web.Request):
    """Ф5.4/Ф6.4: сигнал barge-in фронтенду. Клиент подписывается и получает
    {"event":"speech_start"|"speech_end"} от realtime VAD-монитора на avatar_aec_in."""
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    _barge_clients.add(ws)
    try:
        async for _msg in ws:
            pass
    finally:
        _barge_clients.discard(ws)
    return ws


async def _broadcast_barge(event: str):
    dead = []
    for ws in list(_barge_clients):
        try:
            await ws.send_json({"event": event})
        except Exception:  # noqa: BLE001
            dead.append(ws)
    for d in dead:
        _barge_clients.discard(d)


async def vad_monitor():
    """Непрерывный realtime VAD на avatar_aec_in (AEC-канал, самоэхо аватара уже
    подавлено PipeWire WebRTC AEC — см. aec_report.md) — рассылает barge-in сигнал
    всем подключённым /barge_in_ws клиентам, пока слышна внешняя речь пользователя."""
    try:
        from silero_vad import load_silero_vad
        import torch
    except Exception as e:  # noqa: BLE001
        print(f"[vad_monitor] silero-vad недоступен ({type(e).__name__}: {e}), barge-in отключён")
        return
    model = await asyncio.to_thread(load_silero_vad, onnx=True)
    SR = 16000
    CHUNK = 512  # ~32ms @16kHz, требование silero-vad
    while True:
        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "parec", "--device=avatar_aec_in", "--rate=16000", "--channels=1",
                "--format=s16le", "--raw",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            speaking = False
            silence_run = 0
            while True:
                raw = await proc.stdout.readexactly(CHUNK * 2)
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                chunk = torch.from_numpy(samples.copy())
                prob = (await asyncio.to_thread(model, chunk, SR)).item()
                if prob > 0.5:
                    silence_run = 0
                    if not speaking:
                        speaking = True
                        await _broadcast_barge("speech_start")
                else:
                    silence_run += 1
                    if speaking and silence_run > 10:  # ~320ms тишины -> конец фразы
                        speaking = False
                        await _broadcast_barge("speech_end")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            print(f"[vad_monitor] упал ({type(e).__name__}: {e}), перезапуск через 3s")
            await asyncio.sleep(3)
        finally:
            if proc is not None:
                try:
                    proc.terminate()
                except Exception:  # noqa: BLE001
                    pass


async def reset(_):
    history.clear()
    return web.json_response({"ok": True})


async def index(_):
    # мультяшный Иллидан по умолчанию; 3D — /3d, старое 2D — /2d
    return web.FileResponse(ROOT / os.environ.get("AVATAR_PAGE", "toon.html"))


async def index3d(_):
    return web.FileResponse(ROOT / "index3d.html")


async def index_vrm(_):
    return web.FileResponse(ROOT / "static" / "vrm.html")


async def index2d(_):
    return web.FileResponse(ROOT / "index.html")


async def warmup(app):
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, get_whisper)
    if os.environ.get("TTS_ENGINE", "silero") == "silero":
        loop.run_in_executor(None, silero_wav, "Готов.")
    app["vad_task"] = asyncio.create_task(vad_monitor())


async def shutdown_vad(app):
    task = app.get("vad_task")
    if task:
        task.cancel()


app = web.Application(client_max_size=50 * 1024 * 1024)
import mimetypes
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
app.router.add_get("/", index)
app.router.add_get("/2d", index2d)
app.router.add_get("/3d", index3d)
app.router.add_get("/vrm", index_vrm)
app.router.add_get("/events", events)
app.router.add_get("/api/gestures", api_gestures)
app.router.add_post("/api/gesture", api_gesture)
app.router.add_post("/api/motion", api_motion)
app.router.add_post("/push", push)
app.router.add_static("/static", ROOT / "static")
app.router.add_static("/assets", ROOT / "assets")
app.router.add_post("/stt", stt)
app.router.add_post("/chat", chat)
app.router.add_post("/tts", tts)
app.router.add_post("/tts_stream", tts_stream)
app.router.add_post("/tts_lips", tts_lips)
app.router.add_post("/lips", lips)
app.router.add_post("/reset", reset)
app.router.add_get("/barge_in_ws", barge_in_ws)
app.on_startup.append(warmup)
app.on_cleanup.append(shutdown_vad)

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=PORT)
