#!/usr/bin/env bash
# Скачивает демо-аватары VRM со свободной лицензией, которые не включены в репозиторий
# (кастомные/сторонние модели с неподтверждённым правом на распространение).
#
# В комплекте уже есть assets/hermes.vrm (pixiv/three-vrm sample, MIT + VRM-лицензия
# "allowRedistribution: true" — см. proofs/stage1/LICENSE-hermes.vrm.txt).
#
# Этот скрипт добавляет официальный VRoid-семпл с такой же открытой VRM-лицензией.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/male

dest="assets/male/AvatarSample_C.vrm"
if [ ! -f "$dest" ]; then
  echo "downloading VRoid AvatarSample_C -> $dest"
  curl -fL "https://github.com/vrm-c/vrm-specification/raw/master/samples/Seed-san/vrm/Seed-san.vrm" -o "$dest" \
    || echo "ВНИМАНИЕ: не удалось скачать автоматически — возьмите VRM-семпл вручную с https://vroid.com/en/samples и положите в assets/male/, либо используйте любую свою .vrm-модель (переключается в UI drag&drop)."
fi

echo "Готово. Своя модель подключается через drag&drop в окне аватара (см. README)."
