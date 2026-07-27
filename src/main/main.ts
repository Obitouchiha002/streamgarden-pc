import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Tray, Menu, globalShortcut, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { probe } from './probe';
import { DownloadQueue } from './queue';
import { toolStatus } from './tools';
import { previewUrlFor, stopStreamServer } from './stream';
import { search, cancelSearch } from './search';
import { checkin, claimName, deviceId, deviceName } from './admin';
import { DEFAULT_SETTINGS, isSupportedUrl } from '../shared/types';
import type { Settings, DownloadRequest, DownloadItem } from '../shared/types';

const isDev = process.env.NODE_ENV === 'development';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let queue: DownloadQueue;
let settings: Settings = { ...DEFAULT_SETTINGS };
let quitting = false;

// ── settings persistence ───────────────────────────────────────────────────
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  const defaults: Settings = { ...DEFAULT_SETTINGS, downloadDir: path.join(app.getPath('downloads'), 'StreamGarden') };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...defaults, ...raw };
  } catch {
    settings = defaults;
  }
  try { fs.mkdirSync(settings.downloadDir, { recursive: true }); } catch { /* created on first save */ }
}

function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* non-fatal */ }
}

// ── window ─────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0F1109',
    // Windows gets a custom title bar so the app looks like one piece; the real buttons
    // stay where Windows users expect them.
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#0F1109', symbolColor: '#EDEFE3', height: 40 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  if (isDev) {
    win.loadURL('http://localhost:5180');
  } else {
    // Compiled to dist-main/main/, so the built renderer is two levels up in dist/.
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Links to the outside world open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  win.on('close', (e) => {
    if (!quitting && settings.minimiseToTray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

// ── tray ───────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(app.getAppPath(), 'resources', 'tray.png');
  if (!fs.existsSync(iconPath)) return;      // packaged without an icon — skip the tray
  tray = new Tray(iconPath);
  tray.setToolTip('StreamGarden');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open StreamGarden', click: () => showWindow() },
    { label: 'Paste link and download', click: () => pasteFromClipboard() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}

function showWindow() {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

function pasteFromClipboard() {
  const text = clipboard.readText().trim();
  showWindow();
  if (isSupportedUrl(text)) win?.webContents.send('open-url', text);
}

// ── clipboard watcher ──────────────────────────────────────────────────────
// Unlike Android, desktop lets us read the clipboard whenever we like, so a copied link
// can be offered the moment it appears rather than only when the app is opened.
let lastClip = '';
let clipTimer: NodeJS.Timeout | null = null;

function startClipboardWatch() {
  if (clipTimer) clearInterval(clipTimer);
  lastClip = clipboard.readText();
  clipTimer = setInterval(() => {
    if (!settings.clipboardWatch) return;
    const t = clipboard.readText().trim();
    if (t && t !== lastClip) {
      lastClip = t;
      if (isSupportedUrl(t)) win?.webContents.send('clipboard-link', t);
    }
  }, 800);
}

// ── taskbar progress ───────────────────────────────────────────────────────
function refreshTaskbarProgress(items: DownloadItem[]) {
  if (!win) return;
  const active = items.filter((i) => i.phase === 'downloading' || i.phase === 'merging' || i.phase === 'converting');
  if (!active.length) { win.setProgressBar(-1); return; }
  const avg = active.reduce((s, i) => s + i.progress, 0) / active.length;
  win.setProgressBar(Math.max(0.01, Math.min(1, avg)));
}

// ── lifecycle ──────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    loadSettings();

    queue = new DownloadQueue(settings, (item) => {
      win?.webContents.send('queue-item', item);
      refreshTaskbarProgress(queue.all());
    });

    createWindow();
    createTray();
    startClipboardWatch();

    if (settings.globalHotkey) {
      try { globalShortcut.register(settings.globalHotkey, () => pasteFromClipboard()); } catch { /* taken by another app */ }
    }

    nativeTheme.themeSource = settings.theme;

    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });

  app.on('before-quit', () => { quitting = true; });
  // Windows raises this when the session ends or an installer asks apps to close. Hiding to
  // the tray here would leave the process alive holding StreamGarden.exe open, which is what
  // made uninstalling stall — so from this point on, close means quit.
  // ('session-end' is Windows-only, so it isn't in the cross-platform event union.)
  (app as unknown as { on(e: string, cb: () => void): void })
    .on('session-end', () => { quitting = true; app.exit(0); });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopStreamServer(); queue?.killAll(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.handle('tools:status', () => toolStatus());
ipcMain.handle('probe', (_e, url: string) => probe(url));
ipcMain.handle('search', (_e, q: string) => search(q));
ipcMain.handle('cancel-search', () => { cancelSearch(); });
ipcMain.handle('preview-url', (_e, url: string) => previewUrlFor(url));

// Device registration — the same dashboard the Android app reports to.
ipcMain.handle('admin:checkin', () => checkin(settings.profileName));
ipcMain.handle('admin:device', () => ({ id: deviceId(), name: deviceName() }));
ipcMain.handle('admin:claimName', (_e, name: string) => claimName(name));

ipcMain.handle('queue:add', (_e, req: DownloadRequest) => queue.add(req));
ipcMain.handle('queue:all', () => queue.all());
ipcMain.handle('queue:pause', (_e, id: string) => queue.pause(id));
ipcMain.handle('queue:resume', (_e, id: string) => queue.resume(id));
ipcMain.handle('queue:cancel', (_e, id: string) => queue.cancel(id));
ipcMain.handle('queue:remove', (_e, id: string) => queue.remove(id));
ipcMain.handle('queue:clearFinished', () => { queue.clearFinished(); return queue.all(); });

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, next: Settings) => {
  const prevHotkey = settings.globalHotkey;
  settings = { ...settings, ...next };
  saveSettings();
  queue.updateSettings(settings);
  nativeTheme.themeSource = settings.theme;

  if (prevHotkey !== settings.globalHotkey) {
    globalShortcut.unregisterAll();
    if (settings.globalHotkey) {
      try { globalShortcut.register(settings.globalHotkey, () => pasteFromClipboard()); } catch { /* ignore */ }
    }
  }
  try { fs.mkdirSync(settings.downloadDir, { recursive: true }); } catch { /* ignore */ }
  return settings;
});

ipcMain.handle('pick-folder', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open-path', (_e, p: string) => shell.openPath(p));
ipcMain.handle('show-in-folder', (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle('open-external', (_e, u: string) => shell.openExternal(u));

// Window controls for the custom title bar.
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('win:close', () => win?.close());
