# Этап 3 — эмоции, фонемный липсинк, «всё тело»

Модель: текущая брутализованная AvatarSample_C (VRM 0.x, s0 = −1). Прогон — живой, headless Chromium
(ANGLE/Vulkan, RTX 3050 Ti, 60 fps) через `tools/stage3.mjs`, сервер `hermes-avatar-server` перезапущен с новым кодом.

## Что сделано
- `lipsync.py` — русский липсинк на CPU: espeak-ng G2P (IPA + ударения) → forced alignment
  (HSMM-Витерби по акустическим классам) для любого WAV (Silero) или нативные тайминги Piper
  (`include_alignments`, поправка задержки −50 мс, измерена) → timeline визем Oculus-15 с весами,
  ударениями, мягкостью и `accent` (фразовый акцент).
- `server.py` — `POST /tts_lips {text}` → `{audio(base64 WAV после FX), timeline, phones, engine, align}`;
  `POST /lips {text, audio}` → timeline для готового WAV.
- `static/avatar-motion.js` — движок тела: idle (дыхание, перенос веса, покачивание, микродвижения головы,
  редкие развороты корпуса), взгляд (саккады глаз + доворот головы/шеи), «разговорная» поза рук,
  кивок + жест-«удар» на акцентах речи, осанка под эмоцию, коартикуляция визем (смыкание PP/FF).
- API `window.avatar`: `setEmotion(name,w)` (в т.ч. Joy/Angry/Sorrow/Fun), `setVisemes(tl,{audio})`,
  `setGesture(name|null,{hold})` — wave/explain/point/shrug/think/celebrate/fist/beatL/beatR,
  `playMotion(name)` — nod/shake/bow/lookAround/turnLeft/turnRight/stretch/idle/talk,
  `speak(text)`, `stopMotion()`, `getState()`.
- Кадр в режиме full — по пояс (`?frame=chest` — прежний), чтобы жесты были видны.

## Доказательства
| Файл | Что показывает |
|---|---|
| 01-idle-a/b.png | idle: разные позы корпуса/головы с интервалом 2 с (кости в getState различаются) |
| contact-gestures.png | wave, explain, point(в сторону), shrug, think, celebrate, fist, beat |
| contact-motions-emotions.png | nod, shake, bow, lookAround, turnLeft, stretch; Joy, Sorrow, Angry, Fun |
| contact-speak.png, s-0*.png | кадры речи `speak()`: смена формы рта, авто-жест beat |
| speak-trace.json | 160 замеров (50 мс): раскрытие рта, визем, слои жестов, кость головы |
| align-metrics.txt | точность выравнивателя против эталона Piper |

## Цифры
- Выравнивание (8 фраз): медиана ошибки начала фоны 33 мс, <100 мс — 71 %; 143 мс CPU на фразу.
- `/tts_lips` (Silero + выравнивание): 0,57 с на фразу в 5 с; выравнивание 66 мс.
- Речь: рот открыт 61 % времени, закрыт 10 %; авто-жесты beatL/beatR на акцентах — сработали.

## Ограничения (честно)
- Покадровое совпадение виземы с эталоном — 46 % (15 классов, строгая метрика); паузы и
  смычные иногда смещены на 50–150 мс.
- `point` указывает в сторону, а не на камеру (на камеру рука закрывает лицо).
- Тест речи — в headless с muted-аудио; на десктопе визем идут по часам `<audio>`.

## Дополнение (00:30): 12 эмоций, теги, API тела, курсор
- 12 смешиваемых эмоций (рецепт: пресеты лица + веки + осанка + плечи + взгляд):
  радость, грусть, злость, страх, удивление, отвращение, интерес, скука, смущение, гордость, усталость, нейтраль.
  Доказательство: contact-emotions12.png, emo-*.png; смесь интерес 0.6 + радость 0.5 — emo-mix-*.png.
  Прогон шёл по реальной цепочке: POST /push → split_emotions → SSE /events → vrm.html (emo-run.log).
- Теги LLM: `[эмо:имя 0.7]` (можно несколько подряд — смесь), `[жест:имя]`; старые `[радость]` работают.
  Разбор: emo-tag-parse.txt. Системный промпт обновлён.
- HTTP API: `GET /api/gestures`, `POST /api/gesture {name}`, `POST /api/motion {name}|{url:.vrma}`;
  ошибки 404 unknown_gesture / motion_not_found, 503 avatar_not_connected.
  Доказательство: api-gesture-cross_arms.png, api-motion-bow.png (spine −17.9°).
- Взгляд за курсором: cursor-top-right.png / cursor-bottom-left.png (голова Y +10.2° / −5.2°).
- Audio2Face-3D: замер и вердикт «не внедрять» — audio2face-verdict.md.
