// Гермес — Electron-оболочка: окно с VRM-рендером (сервер :8765 отдаёт /vrm).
// Режимы: full (во весь экран, прозрачный, always-on-top) | mini (виджет в углу) | tray (скрыт в трее).
// Хоткей Super+H — цикл режимов. Push-to-talk: Control+Shift+Space (toggle, т.к. Electron globalShortcut
// не даёт keyup вне фокуса окна) + истинный hold-to-talk через Space, когда окно в фокусе (см. preload).
'use strict';
const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const AVATAR_PORT = process.env.AVATAR_PORT || '8765';
const BASE_URL = `http://127.0.0.1:${AVATAR_PORT}`;

// Ф2: профиль внешности persist в ~/.config/hermes-avatar/look.json; кастомные .vrm
// копируются в assets/imported и раздаются тем же aiohttp-статиком, что и штатные модели —
// так не нужен file:// (блокируется CORS в странице, загруженной по http).
const LOOK_PATH = path.join(os.homedir(), '.config', 'hermes-avatar', 'look.json');
const PROJECT_ROOT = path.join(__dirname, '..');
const IMPORTED_DIR = path.join(PROJECT_ROOT, 'assets', 'imported');

const MODES = ['full', 'mini', 'tray'];
let modeIdx = 0;
let win = null;
let tray = null;
let pttActive = false;

function urlForMode(mode) {
  const u = new URL('/vrm', BASE_URL);
  u.searchParams.set('mode', mode === 'mini' ? 'mini' : 'full');
  if (process.env.AVATAR_DEBUG) u.searchParams.set('debug', '1');
  return u.toString();
}

function commonWinOpts(extra) {
  return Object.assign({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  }, extra);
}

function destroyWin() {
  const w = win;
  win = null;
  if (w && !w.isDestroyed()) w.destroy();
}

function makeFullWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = new BrowserWindow(commonWinOpts({ width, height, x: 0, y: 0 }));
  win = w;
  w.setIgnoreMouseEvents(false);
  w.loadURL(urlForMode('full'));
  w.on('closed', () => { if (win === w) win = null; });
}

function makeMiniWindow() {
  const d = screen.getPrimaryDisplay();
  console.log('display info:', JSON.stringify({ bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }));
  const disp = d.workAreaSize;
  const ww = 260, h = 320;
  const x = Math.max(0, disp.width - ww - 16);
  const y = Math.max(0, disp.height - h - 16);
  const w = new BrowserWindow(commonWinOpts({ width: ww, height: h, x, y }));
  win = w;
  w.loadURL(urlForMode('mini'));
  w.on('closed', () => { if (win === w) win = null; });
}

function applyMode(mode) {
  destroyWin();
  if (mode === 'full') makeFullWindow();
  else if (mode === 'mini') makeMiniWindow();
  else if (mode === 'tray') { /* окно скрыто, рендер не нужен — экономим VRAM */ }
  updateTrayMenu();
}

function cycleMode() {
  modeIdx = (modeIdx + 1) % MODES.length;
  console.log('cycleMode ->', MODES[modeIdx]);
  applyMode(MODES[modeIdx]);
}

function setMode(mode) {
  const i = MODES.indexOf(mode);
  if (i < 0) return;
  modeIdx = i;
  applyMode(mode);
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Режим: ${MODES[modeIdx]}`, enabled: false },
    { label: 'Полный экран', click: () => setMode('full') },
    { label: 'Мини-виджет', click: () => setMode('mini') },
    { label: 'Скрыть в трей', click: () => setMode('tray') },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]));
}

function makeTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icons', 'tray-32.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Гермес — аватар');
  tray.on('click', () => setMode(modeIdx === 2 ? 'full' : 'tray'));
  updateTrayMenu();
}

function broadcastPtt(active) {
  pttActive = active;
  if (win && !win.isDestroyed()) win.webContents.send('ptt', active);
}

app.whenReady().then(() => {
  makeTray();
  applyMode(MODES[modeIdx]);

  const okH = globalShortcut.register('Super+H', cycleMode);
  const okH2 = globalShortcut.register('Control+Alt+H', cycleMode); // резервный хоткей: Super+H не всегда
                                                                       // перехватывается оконным менеджером Cinnamon
  const okPtt = globalShortcut.register('Control+Shift+Space', () => broadcastPtt(!pttActive));
  if (!okH) console.error('не удалось зарегистрировать Super+H (занято другим приложением)');
  if (!okH2) console.error('не удалось зарегистрировать Control+Alt+H');
  if (!okPtt) console.error('не удалось зарегистрировать Control+Shift+Space');

  ipcMain.on('ptt-hold', (_e, down) => broadcastPtt(down));
  ipcMain.handle('get-mode', () => MODES[modeIdx]);

  ipcMain.handle('look-save', (_e, data) => {
    try {
      fs.mkdirSync(path.dirname(LOOK_PATH), { recursive: true });
      fs.writeFileSync(LOOK_PATH, JSON.stringify(data, null, 2));
      return true;
    } catch (e) { console.error('look-save failed:', e); return false; }
  });
  ipcMain.handle('look-load', () => {
    try { return JSON.parse(fs.readFileSync(LOOK_PATH, 'utf8')); } catch { return null; }
  });
  ipcMain.handle('import-vrm', (_e, srcPath) => {
    try {
      if (!srcPath || !fs.existsSync(srcPath)) return null;
      fs.mkdirSync(IMPORTED_DIR, { recursive: true });
      const base = path.basename(srcPath).replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.copyFileSync(srcPath, path.join(IMPORTED_DIR, base));
      return '/assets/imported/' + base;
    } catch (e) { console.error('import-vrm failed:', e); return null; }
  });
  ipcMain.handle('pick-vrm', async () => {
    const r = await dialog.showOpenDialog(win || undefined, {
      title: 'Выбрать VRM-модель', properties: ['openFile'],
      filters: [{ name: 'VRM', extensions: ['vrm'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });
});

process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
app.on('render-process-gone', (_e, _wc, details) => console.error('render-process-gone:', details));
app.on('child-process-gone', (_e, details) => console.error('child-process-gone:', details));

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault()); // трей держит процесс живым
