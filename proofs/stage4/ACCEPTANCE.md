# Этап 4 (Ф4) — пространство мыслей, граф tool-calls, режимы фона

Дата: 2026-10-13. Канал данных не менялся: тот же POST /push + SSE /events на :8765,
тот же API window.avatar.*, тот же формат [эмо:]/[виз:] (расширен двумя новыми типами).

## Что сделано

1. static/thought-space.js — новый модуль (ES-модуль, импортируется в vrm.html):
   - ThoughtSpace — орбитальные CSS3D-панели вокруг аватара (CSS3DRenderer из
     three/addons/renderers/CSS3DRenderer.js, уже лежит в static/three/...).
     6 слотов по высоте/углу вокруг аватара, билборд к камере, лёгкий орбитальный
     дрейф. Переиспользует разметку типов [виз:] из toon.html (мысль, иконки, схема,
     список, число, график, код, svg) + 2 новых типа:
       [виз: mermaid | graph TD; A-->B; B-->C]  — схема через vendor/mermaid.min.js
       [виз: картинка | URL | подпись]           — показ картинки (например из image_generate)
   - ToolCallGraph — канвас-виджет внизу слева: узлы-частицы с подписями
     (думаю/ищу/читаю файл/пишу/выполняю/tool/вывод/готово/ошибка), бегущие по
     рёбрам импульсы, последние 7 событий.
   - BackgroundModes — 4 режима фона (прозрачный/космос/кабинет/HUD), переключение
     кнопками в правом нижнем углу, запоминается в localStorage.

2. server.py — SYSTEM-промпт расширен описанием новых тегов [виз: mermaid]/[виз: картинка];
   POST /push принимает {"toolcall": {"stage": "...", "label": "..."}} и рассылает
   {"type": "toolcall", ...} всем SSE-слушателям /events (канал общий, формат как у
   say/viz/clear/emotion).

3. static/vrm.html — подключён vendor/mermaid.min.js классическим <script>, модуль
   thought-space.js; добавлен EventSource("/events") слушатель (say/viz/clear/emotion/
   toolcall), кнопки #bgModes, интеграция thoughtSpace.update()/toolGraph.update() в
   основной render-loop, thoughtSpace.setFrame() из frameCamera() (та же геометрия
   кадрирования, что и в Ф1). window.avatar.* расширен (не заменён): showViz, clearViz,
   pushToolcall, clearToolcalls, setBgMode, getBgMode.

4. static/vendor/mermaid.min.js — скопирован из node_modules (offline, без CDN).

## Проверка (все скриншоты — живой запуск headless chromium через tools/shotvrm.mjs
против работающего server.py на :8765, те же ассеты что видит Electron)

- proofs/stage4/bg_transparent.png, bg_cosmos.png, bg_cabinet.png, bg_hud.png —
  4 режима фона, переключение кликом по кнопке (реальный DOM-клик, не прямой вызов).
- proofs/stage4/panels_mermaid_code.png — панели код + mermaid-схема (рендер через
  mermaid.render()) + число + список, все видимы целиком вокруг аватара.
- proofs/stage4/toolcall_graph_live_sse.png — граф tool-calls, события отправлены
  РЕАЛЬНЫМ fetch("/push", ...) (тот же путь, что будет использовать Hermes), приняты
  через SSE /events и отрисованы на канвасе.
- proofs/stage4/perf_full_load.png — 60 FPS (HUD в левом верхнем углу) при одновременной
  работе 4 панелей, звёзд космического фона и графа tool-calls.
- curl POST /push с {"toolcall": {...}} x7 — все 200 OK.

## Ограничения

- Орбитальный дрейф панелей сделан лёгким покачиванием (±0.12 рад), не полным
  вращением — панели всегда читаемы и не залезают на лицо аватара; геометрия
  подобрана итеративно по скриншотам (radius/angleBase в ThoughtSpace._buildSlots).
- window.avatar.* и формат [эмо:]/[виз:] не менялись, только дополнены.
