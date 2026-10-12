# Этап 7 — systemd + озвучка cron/Telegram — итог

## systemd-юниты (~/.config/systemd/user/)
- hermes-avatar-server.service  — backend (aiohttp :8765), Restart=on-failure, enabled
- hermes-avatar.service         — Electron/VRM, Requires=server, Restart=on-failure, enabled
- hermes-avatar-voice-bridge.service — НОВЫЙ, read-only SSE-клиент /events → TTS → paplay, Restart=on-failure, enabled

Все три `enabled` (автостарт при входе) и были `active (running)` на момент сдачи.
Restart-тест: PID меняется после `systemctl --user restart`, backend отвечает HTTP 200
сразу после рестарта (см. контекст предыдущего прохода и proofs/stage7/systemd.log).

Важно: `hermes-avatar.service` может временно уйти в inactive (dead, exit 0), если
параллельный воркер фронтенда вручную перезапускает Electron мимо systemd для
итеративной отладки UI (виден процесс `electron_stage2.log` от соседней задачи).
Это не баг — Restart=on-failure намеренно не перезапускает процесс при чистом
выходе (код 0), чтобы не конфликтовать с чужой ручной сессией на том же дисплее.
После того как соседние задачи прекратят ручные запуски, юнит остаётся enabled
и поднимется на следующей перезагрузке/логине автоматически.

## Мост озвучки (новое) — tools/voice_bridge.py
Сделан НЕ через правку static/vrm.html (файл активно редактируется параллельной
задачей Ф2/т_bc9ab16c — высокий риск коллизии), а отдельным процессом:
слушает уже существующий SSE `/events`, на событие `{"type":"say",...}` сам
дёргает существующий `POST /tts`, получает WAV и проигрывает через `paplay`.
Лог: proofs/stage7/voice_bridge.log — одна строка на событие + результат TTS.

Проверено вручную: POST /push → listeners=1 → TTS synth → paplay — звук идёт
из колонок, без завязки на фокус окна Electron.

## Реальный тест cron (сделано, PASS)
Создана временная одноразовая cron-задача (deliver=bot-chat), которая через
terminal реально выполнила `curl POST /push`. Результат в voice_bridge.log:
  [23:52:20] событие say получено: 'Тестовое cron-событие выполнено успешно.'
  [23:52:20] TTS ok (255858B) -> играю: ...
last_status задачи — "ok", сообщение реально доставлено. Задача удалена после
теста (была одноразовая, proof — в этом файле и в voice_bridge.log).

## Telegram-тест — ЗАБЛОКИРОВАН (capability gap, не сделано)
Профиль devops, под которым я работаю, не имеет настроенной Telegram-платформы
(`platforms.telegram` отсутствует в его config.yaml). Токен бота есть только в
~/.hermes/.env и используется профилем default (другая сессия/shell) — это тот
же самый бот, что отвечает пользователю в Telegram прямо сейчас. Включение
telegram-платформы в devops означало бы второй long-poll той же учётной записи
бота → 409 Conflict у Telegram API → обрыв боевого канала default-профиля.
Я это не делаю без явного разрешения пользователя (стоп-правило "не трогать
чужой профиль").
Первая попытка теста (`deliver=telegram`) подтвердила именно эту причину:
last_error: "[blocked_config] delivery platform 'telegram' has no gateway
credentials configured (not connected)."

Рекомендация пользователю (1 клик):
  - либо прогнать этот же тест из сессии профиля default (там Telegram уже
    настроен, команда та же — POST /push + ожидаемое сообщение в Telegram),
  - либо явно разрешить добавить platforms.telegram в devops с отдельным ботом.

## Иконка трея
Было: nativeImage.createEmpty() / createNamedImage('NSApplicationIcon', ...)
(последнее — no-op на Linux) → трей фактически без иконки.
Сделано: сгенерирован набор PNG (16..256px) в assets/icons/tray-*.png,
electron/main.js::makeTray() теперь грузит tray-32.png через createFromPath.
Функциональность (клик — переключение режима, контекстное меню) была и
раньше рабочей (updateTrayMenu), это чисто косметическое дополнение.
Визуально подтвердить иконку в системном трее не удалось: в текущей сессии
Cinnamon-панель на этом дисплее не показывает area уведомлений/легаси-трей —
это настройка панели рабочего стола, вне scope systemd-задачи, не трогал.

## Follow-up (не делал, вне объёма этой карточки)
- Память настроек образа/голоса и горячая смена голосовой командой — зависит
  от look.json (Ф2, т_bc9ab16c, ещё в работе) и голосового pipeline (Ф5/Ф6) —
  предлагаю отдельной карточкой после того как Ф2 будет done.
- Полноценное визуальное подтверждение tray-иконки — требует донастройки
  Cinnamon-панели (добавить legacy tray applet), на усмотрение пользователя.
