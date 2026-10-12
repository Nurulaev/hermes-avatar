// preload: истинный hold-to-talk (Space) когда окно в фокусе — Electron globalShortcut
// не отдаёт keyup, поэтому для честного push-to-talk слушаем клавиатуру внутри страницы.
// Плюс мост для Ф2 (кастомизация): путь к файлу из drag&drop, импорт .vrm, профиль look.json.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

let held = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !held) { held = true; ipcRenderer.send('ptt-hold', true); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && held) { held = false; ipcRenderer.send('ptt-hold', false); }
});
ipcRenderer.on('ptt', (_e, active) => {
  window.dispatchEvent(new CustomEvent('hermes-ptt', { detail: { active } }));
});

contextBridge.exposeInMainWorld('hermesShell', {
  onPtt: (cb) => window.addEventListener('hermes-ptt', (e) => cb(e.detail.active)),
  // File из drag&drop не даёт путь в renderer напрямую с contextIsolation — webUtils его достаёт.
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
});

contextBridge.exposeInMainWorld('avatarLook', {
  save: (data) => ipcRenderer.invoke('look-save', data),
  load: () => ipcRenderer.invoke('look-load'),
  importVRM: (srcPath) => ipcRenderer.invoke('import-vrm', srcPath),
  pickVRM: () => ipcRenderer.invoke('pick-vrm'),
});
