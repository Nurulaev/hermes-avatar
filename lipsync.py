"""Ф3 — фонемный липсинк для аватара Гермеса (CPU, без GPU).

Конвейер:  текст → русский G2P (espeak-ng из piper, IPA с ударениями) → фоны
           → выравнивание по аудио:
               * Piper  — точные тайминги от самого движка (include_alignments);
               * любой WAV (Silero и пр.) — собственный forced aligner:
                 HSMM-Витерби по акустическим классам фонем (энергия/вокализация/ВЧ),
                 априор длительностей, опциональные паузы между словами.
           → timeline виcем Oculus-15 [{t, viseme, weight, accent?}] для window.avatar.setVisemes.

Зависимости: numpy, scipy, piper-tts (+onnx для выравниваний Piper). Всё на CPU.
"""
from __future__ import annotations

import io
import re
import time
import unicodedata
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent

# ---------------------------------------------------------------- фоны / классы
VOWELS = set("aeiouyɑɛɪɵʌəɐɨʊæ")
SONOR = set("mnlrjɭɫɲ")
VFRIC = set("vzʒʑɣ")
UFRIC = set("fsʃɕxç")
STOPS = set("pbtdkɡgc")
PAUSE_P = set(",.!?;:—–…")

CLS_SIL, CLS_V, CLS_N, CLS_VF, CLS_UF, CLS_ST = range(6)
CLS_NAME = ["SIL", "V", "N", "VF", "UF", "ST"]

# средняя длительность класса, с (до нормировки на темп)
DUR = {CLS_V: 0.085, CLS_N: 0.060, CLS_VF: 0.070, CLS_UF: 0.085, CLS_ST: 0.065, CLS_SIL: 0.12}

# IPA → визема Oculus-15 (sil PP FF TH DD kk CH SS nn RR aa E ih oh ou)
VIS = {
    "a": "aa", "ɑ": "aa", "ɐ": "aa", "ʌ": "aa", "ə": "E", "æ": "aa",
    "e": "E", "ɛ": "E", "i": "ih", "ɪ": "ih", "y": "ih", "ɨ": "ih",
    "o": "oh", "ɵ": "oh", "u": "ou", "ʊ": "ou",
    "p": "PP", "b": "PP", "m": "PP", "f": "FF", "v": "FF",
    "t": "DD", "d": "DD", "n": "nn", "l": "nn", "ɭ": "nn", "ɫ": "nn", "ɲ": "nn",
    "s": "SS", "z": "SS", "ʃ": "CH", "ʒ": "CH", "ɕ": "CH", "ʑ": "CH",
    "k": "kk", "ɡ": "kk", "g": "kk", "x": "kk", "ɣ": "kk", "c": "kk",
    "r": "RR", "j": "ih",
}
# базовый вес виземы (гласные усиливаются ударением)
VIS_W = {"PP": 1.0, "FF": 0.8, "TH": 0.6, "DD": 0.55, "kk": 0.5, "CH": 0.8, "SS": 0.6,
         "nn": 0.5, "RR": 0.55, "aa": 1.0, "E": 0.9, "ih": 0.85, "oh": 1.0, "ou": 1.0, "sil": 0.0}
REDUCED = set("ʌəɪɐ")


def phone_class(p: str) -> int:
    c = p[0]
    if c in VOWELS:
        return CLS_V
    if c in SONOR:
        return CLS_N
    if c in VFRIC:
        return CLS_VF
    if c in UFRIC:
        return CLS_UF
    if c in STOPS:
        return CLS_ST
    return CLS_SIL


@dataclass
class Phone:
    p: str                 # IPA (с ʲ, если мягкий)
    cls: int
    word: int = -1         # индекс слова, -1 — пауза
    stressed: bool = False
    optional: bool = False  # пауза, которой может не быть
    t0: float = 0.0
    t1: float = 0.0


# ---------------------------------------------------------------- G2P
_espeak_ready = False


def _espeak():
    global _espeak_ready
    from piper import espeakbridge
    if not _espeak_ready:
        from piper.phonemize_espeak import EspeakPhonemizer
        EspeakPhonemizer()
        _espeak_ready = True
    espeakbridge.set_voice("ru")
    return espeakbridge


def ipa_to_phones(ipa_chunks: list[tuple[str, str]]) -> list[Phone]:
    """[(ipa_clause, terminator)] → фоны. ʲ приклеивается к согласной, ˈ — ударение следующей гласной.
    Пробелы — опциональные паузы, знаки препинания — вероятные паузы."""
    out: list[Phone] = [Phone("_", CLS_SIL, optional=True)]
    word = 0
    stress_next = False
    for ipa, term in ipa_chunks:
        ipa = unicodedata.normalize("NFC", re.sub(r"\([^)]+\)", "", ipa))
        for ch in ipa:
            if ch == "ˈ" or ch == "ˌ":
                stress_next = True
            elif ch == "ʲ":
                if out and out[-1].cls != CLS_SIL:
                    out[-1].p += "ʲ"
            elif ch == "ː":
                continue
            elif ch.isspace():
                if out[-1].cls != CLS_SIL:
                    out.append(Phone(" ", CLS_SIL, optional=True))
                    word += 1
            else:
                c = phone_class(ch)
                if c == CLS_SIL:
                    continue
                # удвоенные согласные (ss, jj) — одна длинная
                if out[-1].p.rstrip("ʲ") == ch and c != CLS_V:
                    continue
                out.append(Phone(ch, c, word=word, stressed=(c == CLS_V and stress_next)))
                if c == CLS_V:
                    stress_next = False
        if term:
            if out[-1].cls == CLS_SIL:
                out[-1].p = term
                out[-1].optional = term == ","
            else:
                out.append(Phone(term, CLS_SIL, optional=term == ","))
            word += 1
    if out[-1].cls == CLS_SIL:
        out[-1].optional = True
    else:
        out.append(Phone("_", CLS_SIL, optional=True))
    return out


_RU_FALLBACK = {"а": "a", "о": "o", "у": "u", "ы": "y", "э": "e", "и": "i", "е": "e", "ё": "o", "ю": "u",
                "я": "a", "б": "b", "в": "v", "г": "ɡ", "д": "d", "ж": "ʒ", "з": "z", "й": "j", "к": "k",
                "л": "l", "м": "m", "н": "n", "п": "p", "р": "r", "с": "s", "т": "t", "ф": "f", "х": "x",
                "ц": "s", "ч": "ɕ", "ш": "ʃ", "щ": "ɕ"}


def g2p(text: str) -> list[Phone]:
    """Русский G2P: espeak-ng (IPA+ударения), при недоступности — побуквенный фолбэк."""
    try:
        chunks = [(ph, term) for ph, term, _eos in _espeak().get_phonemes(text)]
        if chunks:
            return ipa_to_phones(chunks)
    except Exception as e:  # noqa: BLE001
        print(f"[lips] espeak недоступен ({e}); побуквенный G2P")
    chunks = []
    for m in re.finditer(r"([^.,!?;:]+)([.,!?;:]?)", text.lower()):
        chunks.append(("".join(_RU_FALLBACK.get(c, " " if c.isspace() else "") for c in m[1]), m[2]))
    return ipa_to_phones(chunks)


# ---------------------------------------------------------------- аудио → признаки
HOP = 0.010
SR = 16000


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data)) as w:
        sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    dt = {1: np.uint8, 2: np.int16, 4: np.int32}[sw]
    x = np.frombuffer(raw, dtype=dt).astype(np.float32)
    if sw == 1:
        x = (x - 128) / 128
    else:
        x /= float(np.iinfo(dt).max)
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    return x, sr


def features(x: np.ndarray, sr: int) -> np.ndarray:
    """[T, 3]: нормированная энергия, вокализация, доля ВЧ (>3.5 кГц)."""
    from scipy.signal import resample_poly
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    hop, win = int(SR * HOP), int(SR * 0.025)
    n = max(1, 1 + (len(x) - win) // hop)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    fr = np.pad(x, (0, win))[idx] * np.hanning(win)[None, :]
    spec = np.abs(np.fft.rfft(fr, 512, axis=1)) ** 2
    freqs = np.fft.rfftfreq(512, 1 / SR)
    tot = spec.sum(1) + 1e-10
    db = 10 * np.log10(tot)
    lo, hi = np.percentile(db, 5), np.percentile(db, 98)
    en = np.clip((db - lo) / max(hi - lo, 1e-3), 0, 1)
    hf = spec[:, freqs > 3500].sum(1) / tot
    # вокализация: максимум нормированной автокорреляции в диапазоне 60–400 Гц
    ac = np.fft.irfft(np.abs(np.fft.rfft(fr, 1024, axis=1)) ** 2, axis=1)
    l0, l1 = SR // 400, SR // 60
    voi = np.clip(ac[:, l0:l1].max(1) / (ac[:, 0] + 1e-10), 0, 1)
    voi = np.where(en < 0.15, voi * 0.3, voi)
    return np.stack([en, voi, hf], 1)


# класс → (среднее, ско) по (en, voi, hf)
EMIS = {
    CLS_SIL: ((0.04, 0.15, 0.20), (0.10, 0.30, 0.40)),
    CLS_V:   ((0.82, 0.80, 0.03), (0.15, 0.20, 0.08)),
    CLS_N:   ((0.62, 0.70, 0.04), (0.18, 0.22, 0.08)),
    CLS_VF:  ((0.50, 0.50, 0.20), (0.20, 0.25, 0.20)),
    CLS_UF:  ((0.40, 0.20, 0.55), (0.20, 0.25, 0.25)),
    CLS_ST:  ((0.30, 0.30, 0.25), (0.25, 0.30, 0.30)),
}


def loglik(F: np.ndarray) -> np.ndarray:
    """[6, T] лог-правдоподобие кадра для каждого класса."""
    out = np.zeros((6, len(F)))
    for c, (mu, sd) in EMIS.items():
        mu, sd = np.array(mu), np.array(sd)
        out[c] = (-0.5 * ((F - mu) / sd) ** 2 - np.log(sd)).sum(1)
    out -= out.max(0, keepdims=True)          # относительные (стабилизация)
    return np.maximum(out, -12.0)


def align(phones: list[Phone], x: np.ndarray, sr: int, emis_w: float = 1.0, dur_w: float = 3.0) -> list[Phone]:
    """Forced alignment (HSMM-Витерби): каждой фоне — отрезок кадров [t0, t1).
    D[u, t] = max_d D[u-1, t-d] + Σ emis(cls_u, t-d..t) + log P(d | cls_u, темп)."""
    F = features(x, sr)
    T = len(F)
    L = loglik(F) * emis_w
    C = np.concatenate([np.zeros((6, 1)), np.cumsum(L, 1)], 1)       # [6, T+1]

    speech = int((F[:, 0] > 0.25).sum())
    exp_speech = sum(DUR[p.cls] for p in phones if p.cls != CLS_SIL) / HOP
    tempo = np.clip(speech / max(exp_speech, 1), 0.5, 2.0)

    U = len(phones)
    NEG = -1e18
    D = np.full((U + 1, T + 1), NEG)
    B = np.zeros((U + 1, T + 1), dtype=np.int32)      # длительность (0 = пропуск)
    D[0, 0] = 0.0
    t_idx = np.arange(T + 1)
    for u, ph in enumerate(phones, 1):
        c = ph.cls
        if c == CLS_SIL:
            mean = DUR[c] / HOP * (2.0 if ph.p in ".!?" else 1.0)
            dmin, dmax = 3, (T if ph.p in "_" else max(60, int(mean * 6)))
            sd = mean * 1.5
        else:
            mean = DUR[c] / HOP * tempo * (1.3 if ph.stressed else (0.8 if ph.p[0] in REDUCED else 1.0))
            dmin, dmax = 2, int(mean * 3.5) + 3
            sd = mean * 0.5
        prev = D[u - 1]
        best, arg = np.full(T + 1, NEG), np.zeros(T + 1, dtype=np.int32)
        for d in range(dmin, min(dmax, T) + 1):
            s = np.full(T + 1, NEG)
            s[d:] = prev[:T + 1 - d] + (C[c, d:] - C[c, :T + 1 - d]) - dur_w * 0.5 * ((d - mean) / sd) ** 2 / 10
            m = s > best
            best[m], arg[m] = s[m], d
        if ph.optional:
            m = prev > best
            best[m], arg[m] = prev[m], 0
        D[u], B[u] = best, arg
    # обратный проход
    t = T
    for u in range(U, 0, -1):
        d = int(B[u, t])
        phones[u - 1].t0, phones[u - 1].t1 = (t - d) * HOP, t * HOP
        t -= d
    return phones


# ---------------------------------------------------------------- Piper: тайминги от движка
_piper_al = None
PIPER_VOICE = ROOT / "voices" / "ru_RU-dmitri-medium.onnx"


def piper_aligned(text: str) -> tuple[bytes, list[Phone]]:
    """Синтез Piper с точными таймингами фонем (размер шага 256 сэмплов ≈ 11.6 мс)."""
    global _piper_al
    from piper import PiperVoice
    if _piper_al is None:
        _piper_al = PiperVoice.load(str(PIPER_VOICE), include_alignments=True)
    pcm, phones, t = [], [], 0.0
    sr = _piper_al.config.sample_rate
    for ch in _piper_al.synthesize(text, include_alignments=True):
        pcm.append(ch.audio_int16_bytes)
        al = ch.phoneme_alignments or []
        seq = [(a.phoneme, a.num_samples / sr) for a in al]
        # переводим поток токенов piper в фоны: модификаторы сливаются с соседями
        cur: Phone | None = None
        stress = False
        for p, dur in seq:
            if p == " " and phones:
                # межсловный пробел Piper — не пауза: время отдаём предыдущей фоне
                phones[-1].t1 = t + dur
            elif p in ("^", "$", " ") or p in PAUSE_P:
                ph = Phone(p if p not in "^$" else "_", CLS_SIL, t0=t, t1=t + dur)
                phones.append(ph); cur = None
            elif p == "ʲ" and cur is not None:
                cur.p += "ʲ"; cur.t1 = t + dur
            elif p in ("ˈ", "ˌ"):
                stress = True
                # длительность маркера ударения отдаём предыдущему сегменту
                if phones:
                    phones[-1].t1 = t + dur
            else:
                c = phone_class(p)
                if c == CLS_SIL:
                    if phones:
                        phones[-1].t1 = t + dur
                elif cur is not None and c != CLS_V and cur.p.rstrip("ʲ") == p:
                    cur.t1 = t + dur          # удвоенная согласная — одна длинная
                else:
                    cur = Phone(p, c, stressed=(c == CLS_V and stress), t0=t, t1=t + dur)
                    if c == CLS_V:
                        stress = False
                    phones.append(cur)
            t += dur
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(b"".join(pcm))
    # Выравнивания Piper (выход duration predictor) отстают от звука декодера на ~50 мс —
    # измерено по согласию меток с акустикой (proofs/stage3): 64% → 85% при сдвиге −0.05 с.
    for p in phones:
        p.t0, p.t1 = max(0.0, p.t0 - PIPER_LAG), max(0.0, p.t1 - PIPER_LAG)
    _number_words(phones)
    return buf.getvalue(), phones


PIPER_LAG = 0.05


def _number_words(phones: list[Phone]):
    w = 0
    for i, p in enumerate(phones):
        if p.cls == CLS_SIL:
            if i and phones[i - 1].cls != CLS_SIL:
                w += 1
            p.word = -1
        else:
            p.word = w


# ---------------------------------------------------------------- фоны → timeline
def to_timeline(phones: list[Phone], x: np.ndarray | None = None, sr: int = 0) -> list[dict]:
    """[{t, viseme, weight, accent?}] — по одной записи на начало фоны.
    accent=true — ударная гласная самого «громкого» слова фразы (между паузами): кивок/жест."""
    tl: list[dict] = []
    energy = None
    if x is not None and sr:
        energy = lambda a, b: float(np.sqrt(np.mean(x[int(a * sr):max(int(b * sr), int(a * sr) + 1)] ** 2)) + 1e-9)  # noqa: E731
    # акценты: в каждой фразе — ударная гласная с максимумом энергия×длительность
    accents = set()
    phrase: list[int] = []

    def close_phrase():
        cand = [i for i in phrase if phones[i].stressed]
        if cand:
            score = lambda i: (energy(phones[i].t0, phones[i].t1) if energy else 1) * (phones[i].t1 - phones[i].t0)  # noqa: E731
            accents.add(max(cand, key=score))
        phrase.clear()

    for i, p in enumerate(phones):
        if p.cls == CLS_SIL and p.t1 - p.t0 >= 0.12:
            close_phrase()
        elif p.cls != CLS_SIL:
            phrase.append(i)
    close_phrase()

    for i, p in enumerate(phones):
        if p.t1 <= p.t0:
            continue
        if p.cls == CLS_SIL:
            tl.append({"t": round(float(p.t0), 3), "viseme": "sil", "weight": 0.0})
            continue
        v = VIS.get(p.p[0], "nn")
        w = VIS_W[v]
        if p.cls == CLS_V:
            w *= 1.0 if p.stressed else (0.55 if p.p[0] in REDUCED else 0.7)
        e = {"t": round(float(p.t0), 3), "viseme": v, "weight": round(float(min(1.0, w)), 2)}
        if "ʲ" in p.p:
            e["soft"] = True
        if i in accents:
            e["accent"] = True
        tl.append(e)
    if phones:
        tl.append({"t": round(float(phones[-1].t1), 3), "viseme": "sil", "weight": 0.0})
    return tl


def phones_log(phones: list[Phone]) -> list[list]:
    return [[p.p, CLS_NAME[p.cls], round(float(p.t0), 3), round(float(p.t1), 3), int(p.stressed)]
            for p in phones if p.t1 > p.t0]


def lips_for_wav(text: str, wav: bytes) -> dict:
    """Готовый WAV (любой движок) + его текст → timeline (CPU forced alignment)."""
    t = time.time()
    x, sr = read_wav(wav)
    phones = align(g2p(text), x, sr)
    _number_words(phones)
    return {"timeline": to_timeline(phones, x, sr), "phones": phones_log(phones),
            "duration": round(len(x) / sr, 3), "align": "hsmm-viterbi", "ms": round((time.time() - t) * 1000)}


def lips_piper(text: str) -> tuple[bytes, dict]:
    t = time.time()
    wav, phones = piper_aligned(text)
    x, sr = read_wav(wav)
    return wav, {"timeline": to_timeline(phones, x, sr), "phones": phones_log(phones),
                 "duration": round(len(x) / sr, 3), "align": "piper-native", "ms": round((time.time() - t) * 1000)}
