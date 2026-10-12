# NVIDIA Audio2Face-3D — оценка по VRAM (только замер и вердикт)

Замер на F15 (nvidia-smi, 13.10.2026 ~00:10, сервер аватара + whisper + рендер работают):
- GPU: RTX 3050 Ti Laptop, 4096 MiB.
- Занято: 2232 MiB (whisper в сервере 1156 MiB, рендер/Electron 82 MiB, остальное — X/Cinnamon/браузер).
- Свободно: ~1860 MiB.

Требования Audio2Face-3D SDK (github.com/NVIDIA/Audio2Face-3D-SDK, README «System Requirements»):
- «4GB+ GPU memory recommended», CUDA 12.8+, TensorRT ≥10.13 (на F15 не установлен), сборка C++ SDK,
  модели Audio2Emotion — gated на Hugging Face (нужен клик лицензии в аккаунте пользователя).
- Выход — веса blendshape ARKit-52 / сетка; у текущей модели AvatarSample_C (VRM 0.x) ARKit-форм нет,
  только пресеты A/I/U/E/O + эмоции — потребовался бы ретаргет.

Вердикт: НЕ внедрять. Рекомендуемые 4 ГБ = вся карта, свободно ~1,8 ГБ; рядом с whisper+рендером не влезает
без вытеснения whisper на CPU (а это ломает задержку STT из Э5/6). Плюс модель не имеет ARKit-форм.
Принятая замена — CPU-липсинк lipsync.py (G2P + выравнивание, 66–143 мс на фразу, 0 МБ VRAM).
Вернуться к вопросу при: карте ≥8 ГБ или VRM с perfect sync 52.
