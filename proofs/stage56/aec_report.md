# Ф6.1 — PipeWire echo-cancel (WebRTC AEC)

User-level конфиг (НЕ системный): `~/.config/pipewire/pipewire-pulse.conf.d/99-echo-cancel.conf`

Загружает `module-echo-cancel` (aec_method=webrtc, через системную
`libwebrtc-audio-processing1`, уже установлена пакетом Ubuntu/Mint — ничего доустанавливать
не пришлось). Создаёт виртуальные `avatar_aec_in` (источник с AEC) и `avatar_aec_out`
(выход-референс для AEC). Выставлены **системными default** (`pactl set-default-sink/source`)
— в рамках этой пользовательской сессии; при перезапуске PipeWire нужно будет повторить
`pactl set-default-*` либо добавить в автозапуск (не делал — эффект должен быть желаемым
осознанно, а не «подкрасться»).

## Откат

```
rm ~/.config/pipewire/pipewire-pulse.conf.d/99-echo-cancel.conf
pactl set-default-sink alsa_output.pci-0000_00_1f.3.analog-stereo
pactl set-default-source alsa_input.pci-0000_00_1f.3.analog-stereo
systemctl --user restart pipewire pipewire-pulse wireplumber
```

## Проверка (замер RMS во время воспроизведения той же фразы)

| Запись | Устройство | RMS | дБFS |
|---|---|---|---|
| без AEC | `alsa_input` (сырой) | 1342.9 | −27.7 |
| с AEC | `avatar_aec_in` | 401.5 | −38.2 |

≈10 дБ подавления собственного эха при воспроизведении через `avatar_aec_out`.

## Подтверждение логикой (из barge-in демо, `barge_in_report.md`)

Во время 2.0s проигрывания речи аватара через `avatar_aec_out` Silero VAD **не находит
речи** в `avatar_aec_in` (self-echo полностью подавлен) — и находит речь, когда
«пользователь» говорит через СЫРОЙ выход (не являющийся AEC-референсом). Это прямое,
воспроизводимое доказательство: AEC вычитает именно голос аватара, а не глушит мик вообще.

## Шумовой пол

Запись 4с тишины через `avatar_aec_in`: RMS=78.1, **−52.5 дБFS** — тихая комната,
приемлемо для VAD-порогов по умолчанию (silero-vad speech_threshold=0.5).
