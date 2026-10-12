# Changelog

All notable changes to this project are documented in this file.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] — 2026-10-13

First public release. Built as "Hermes Avatar v2" across stages Ф1–Ф7.

### Added

- Electron desktop window: frameless, transparent, always-on-top; full /
  mini-widget / tray display modes; global hotkey; push-to-talk.
- three.js + `@pixiv/three-vrm` renderer for VRM 1.0 avatars with spring-bone
  hair physics, PBR materials, HDRI lighting, bloom/SSAO/ACES tonemap,
  adaptive quality targeting 60 fps.
- Appearance editor: drag & drop `.vrm` import, skin/hair/eye color, outfit
  and accessory toggles, face-shape morph sliders, saved/restored presets
  (`~/.config/hermes-avatar/look.json`).
- 12 blendable emotions and body gestures driven by inline LLM tags
  (`[эмо:имя сила]`, `[жест:имя]`), phoneme-aligned lip-sync, idle
  blinking/saccades/breathing/nodding.
- "Thought space": orbiting CSS3D panels (text/code/lists/charts/mermaid/
  images) plus a live particle graph of agent tool calls, 4 background modes
  (space / office / HUD / transparent desktop overlay).
- Sentence-level streaming TTS (Silero / Piper / edge-tts / ElevenLabs) with
  barge-in support.
- faster-whisper (CUDA) speech recognition with Silero VAD and noise/echo
  handling.
- systemd user unit, tray icon, "ghost mode" narration, cron/Telegram voice
  callouts.

### Known limitations

- Measured WER ≈10.5% on the stock laptop microphone (ALC256) — a USB
  headset is recommended; target of ≤5% not yet met.
- Wake-word detection ("Гермес") is not implemented yet (push-to-talk only).
- ElevenLabs engine requires the user's own API key.
