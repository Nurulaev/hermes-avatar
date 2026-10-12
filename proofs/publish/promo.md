# Черновики постов — продвижение hermes-avatar

Статус: ЧЕРНОВИК. Не публиковать без клика пользователя.

## Reddit r/LocalLLaMA

Заголовок: I gave my local agent a face — live VRM desktop avatar with
emotions, lip-sync and a "thought space" (open source)

Текст:
> Built a desktop companion for my local Hermes agent: an Electron window
> with a VRM avatar (three.js + @pixiv/three-vrm) that listens
> (faster-whisper, CUDA), talks back with streaming TTS + barge-in, and
> reacts with 12 blendable emotions driven straight from inline LLM tags.
> Around it floats a "thought space" — orbiting panels showing the agent's
> code/text/charts/mermaid diagrams and a live particle graph of its tool
> calls as it works.
>
> Runs on a single 4 GB laptop GPU (RTX 3050 Ti) — 60 fps render, first
> audio in well under a second, ~2 GB VRAM at idle. MIT licensed.
>
> Repo: https://github.com/Nurulaev/hermes-avatar
> (screenshots/demo in the README)
>
> Would love feedback, especially on STT accuracy with other mics — mine
> caps out around 10% WER on a laptop mic, curious if others see the same.

## Hacker News (Show HN)

Заголовок: Show HN: Hermes Avatar — a live VRM desktop avatar for a local AI agent

Текст:
> I wanted my local AI agent to feel less like a terminal and more like a
> presence on my desktop, so I built it a face: an always-on-top Electron
> window rendering a VRM avatar that listens, talks (streaming TTS with
> instant barge-in), shows emotion/gesture from inline tags the LLM emits,
> and projects a "thought space" of floating panels (text, code, mermaid
> diagrams, a live tool-call graph) around itself while it works.
>
> Single local GPU, 4 GB VRAM is enough (RTX 3050 Ti laptop card) — 60 fps,
> <1s to first audio. MIT licensed, Python/aiohttp backend + three.js
> frontend.
>
> https://github.com/Nurulaev/hermes-avatar

## Awesome-списки (кандидаты для PR)

- awesome-vrm (если существует — проверить актуальный список на момент публикации)
- awesome-electron
- community "awesome" списки под конкретный LLM-рантайм/агента (hermes-agent)

Формат записи:
```
- [Hermes Avatar](https://github.com/Nurulaev/hermes-avatar) — live VRM desktop avatar for AI agents: emotions, lip-sync, thought-space panels, streaming TTS/STT.
```

## Чек-лист перед публикацией любого поста

- [ ] Пользователь явно кликнул «публиковать» для конкретной площадки
- [ ] Ссылка на репозиторий проверена (открывается, публичный)
- [ ] Нет упоминаний внутренних IP/серверов/личных путей в тексте поста
