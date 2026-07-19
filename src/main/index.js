// Susurro — app lifecycle, tray, window management, dictation state machine.
'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  session,
  nativeImage,
  Notification,
  systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');

const CH = require('../shared/ipcChannels');
const settings = require('./settingsStore');
const history = require('./historyStore');
const modelManager = require('./stt/modelManager');
const whisper = require('./stt/whisperRunner');
const injection = require('./injection');
const waylandDetect = require('./injection/waylandDetect');
const hotkeys = require('./hotkeys');
const ollama = require('./ollamaBridge');

const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const ICONS = path.join(__dirname, '..', '..', 'build', 'icons');

let mainWindow = null;
let overlayWindow = null;
let onboardingWindow = null;
let prefsWindow = null;
let tray = null;

let dictationState = 'idle'; // 'idle' | 'recording' | 'transcribing'
let quitting = false;

// ---------------------------------------------------------------------------
// single instance
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openMainWindow();
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function broadcast(channel, ...args) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

function setDictationState(state) {
  dictationState = state;
  broadcast(CH.STATE_CHANGED, state);
  refreshTrayMenu();
}

function notifyUser(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: true }).show();
  }
}

function windowDefaults(extra = {}) {
  return {
    show: false,
    backgroundColor: '#F7F3E4',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload requires the shared channel module
      spellcheck: false,
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// windows
// ---------------------------------------------------------------------------

function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new BrowserWindow(windowDefaults({
    width: 780,
    height: 600,
    minWidth: 640,
    minHeight: 480,
    title: 'Susurro',
  }));
  mainWindow.loadFile(path.join(RENDERER_ROOT, 'main-window', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.setMenuBarVisibility(false);

  // OS close button minimizes to tray instead of quitting.
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function openOnboardingWindow() {
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.show();
    return onboardingWindow;
  }
  onboardingWindow = new BrowserWindow(windowDefaults({
    width: 580,
    height: 640,
    resizable: false,
    title: 'Welcome to Susurro',
  }));
  onboardingWindow.loadFile(path.join(RENDERER_ROOT, 'onboarding', 'index.html'));
  onboardingWindow.once('ready-to-show', () => onboardingWindow.show());
  onboardingWindow.setMenuBarVisibility(false);
  onboardingWindow.on('closed', () => { onboardingWindow = null; });
  return onboardingWindow;
}

function openPrefsWindow() {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.show();
    prefsWindow.focus();
    return prefsWindow;
  }
  prefsWindow = new BrowserWindow(windowDefaults({
    width: 660,
    height: 620,
    minWidth: 560,
    minHeight: 480,
    title: 'Susurro Preferences',
  }));
  prefsWindow.loadFile(path.join(RENDERER_ROOT, 'preferences', 'index.html'));
  prefsWindow.once('ready-to-show', () => prefsWindow.show());
  prefsWindow.setMenuBarVisibility(false);
  prefsWindow.on('closed', () => { prefsWindow = null; });
  return prefsWindow;
}

const OVERLAY_SIZE = { width: 148, height: 48 };

function clampToDisplays(x, y) {
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const { x: dx, y: dy, width, height } = d.workArea;
    if (x >= dx - 20 && x <= dx + width - 40 && y >= dy - 10 && y <= dy + height - 20) {
      return { x, y };
    }
  }
  // Off every screen (monitor unplugged, etc.) — snap to primary, bottom center.
  const p = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(p.x + p.width / 2 - OVERLAY_SIZE.width / 2),
    y: Math.round(p.y + p.height - OVERLAY_SIZE.height - 48),
  };
}

function openOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    return overlayWindow;
  }
  const saved = settings.get('overlayPosition');
  const primary = screen.getPrimaryDisplay().workArea;
  const pos = clampToDisplays(
    saved?.x ?? Math.round(primary.x + primary.width / 2 - OVERLAY_SIZE.width / 2),
    saved?.y ?? Math.round(primary.y + primary.height - OVERLAY_SIZE.height - 48)
  );

  overlayWindow = new BrowserWindow({
    ...OVERLAY_SIZE,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false, // we drag manually so click-vs-drag stays distinguishable
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    // Never steal focus from the app the user is dictating into.
    focusable: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(RENDERER_ROOT, 'overlay-widget', 'index.html'));
  overlayWindow.once('ready-to-show', () => overlayWindow.show());
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

// ---------------------------------------------------------------------------
// tray
// ---------------------------------------------------------------------------

function trayIconPath() {
  return process.platform === 'darwin'
    ? path.join(ICONS, 'trayTemplate.png')
    : path.join(ICONS, 'tray.png');
}

function refreshTrayMenu() {
  if (!tray) return;
  const listening = dictationState === 'recording';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Susurro', click: () => openMainWindow() },
    {
      label: listening ? 'Stop Listening' : 'Start Listening',
      enabled: dictationState !== 'transcribing',
      click: () => toggleDictation(),
    },
    { label: 'Preferences', click: () => openPrefsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => quit() },
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(trayIconPath());
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Susurro — local voice dictation');
  refreshTrayMenu();
  tray.on('click', () => {
    // Windows/Linux convention: primary click opens the app.
    if (process.platform !== 'darwin') openMainWindow();
  });
}

// ---------------------------------------------------------------------------
// dictation state machine
// ---------------------------------------------------------------------------

function toggleDictation() {
  if (dictationState === 'transcribing') return; // ignore until done
  if (dictationState === 'recording') {
    setDictationState('transcribing');
    overlayWindow?.webContents.send(CH.CAPTURE_STOP);
    return;
  }
  // starting
  if (!settings.get('onboarded')) {
    openOnboardingWindow();
    return;
  }
  const model = settings.get('model');
  if (!model || !modelManager.isInstalled(model)) {
    notifyUser('Susurro', 'No speech model installed yet — open Susurro to download one.');
    openMainWindow();
    return;
  }
  setDictationState('recording');
  const overlay = openOverlayWindow();
  if (overlay.webContents.isLoading()) {
    overlay.webContents.once('did-finish-load', () =>
      overlay.webContents.send(CH.CAPTURE_START));
  } else {
    overlay.webContents.send(CH.CAPTURE_START);
  }
}

function maybeShowWaylandNotice(result) {
  const injInfo = injection.info(settings.get('injectionMethod'));
  if (!injInfo.waylandFallback || settings.get('waylandNoticeShown')) return;
  settings.set({ waylandNoticeShown: true });
  notifyUser(
    'Susurro on Wayland',
    result?.manualPaste
      ? 'Wayland blocks simulated typing and no ydotool was found, so your text was copied to the clipboard — press Ctrl+V to paste it. Installing ydotool enables automatic typing.'
      : 'Wayland blocks simulated typing, so Susurro pastes from the clipboard instead. Installing ydotool enables direct typing.'
  );
}

async function handleFinishedAudio(pcmArrayBuffer, sampleRate) {
  const wavPath = whisper.tempWavPath();
  try {
    const pcm = Buffer.from(pcmArrayBuffer);
    if (pcm.length < sampleRate * 2 * 0.25) {
      // under ~250ms of audio — nothing to transcribe
      setDictationState('idle');
      return { ok: true, text: '' };
    }
    whisper.writeWav(pcm, sampleRate, wavPath);
    const model = settings.get('model');
    let text = await whisper.transcribe(
      modelManager.modelDir(model),
      wavPath,
      settings.get('pythonPath')
    );
    text = (text || '').trim();
    if (!text) {
      setDictationState('idle');
      return { ok: true, text: '' };
    }

    if (settings.get('ollamaEnabled') && settings.get('ollamaModel')) {
      text = await ollama.cleanup(text, settings.get('ollamaModel'));
    }

    const result = await injection.inject(text, settings.get('injectionMethod'));
    if (result.manualPaste) {
      notifyUser('Susurro', 'Text copied — press Ctrl+V to paste it.');
    }
    maybeShowWaylandNotice(result);

    history.add(text);
    setDictationState('idle');
    return { ok: true, text };
  } catch (err) {
    setDictationState('idle');
    const message = String(err.message || err);
    broadcast(CH.DICTATION_ERROR, message);
    notifyUser('Susurro couldn’t transcribe', message);
    return { ok: false, error: message };
  } finally {
    fs.rm(wavPath, { force: true }, () => {});
  }
}

// ---------------------------------------------------------------------------
// hotkey + startup wiring
// ---------------------------------------------------------------------------

function applyHotkey() {
  const accel = settings.get('hotkey');
  const res = hotkeys.register(accel, toggleDictation);
  if (!res.ok) {
    notifyUser('Susurro', `Could not bind hotkey "${accel}" (${res.reason}). Set a new one in Preferences.`);
  }
  return res;
}

function applyLaunchOnStartup() {
  const enabled = !!settings.get('launchOnStartup');
  if (process.platform === 'linux') {
    // No login-item API on Linux — use an XDG autostart entry.
    const dir = path.join(app.getPath('home'), '.config', 'autostart');
    const file = path.join(dir, 'susurro.desktop');
    if (enabled) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Susurro',
        'Comment=Local voice dictation',
        `Exec=${JSON.stringify(process.execPath).slice(1, -1)}`,
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'));
    } else {
      fs.rmSync(file, { force: true });
    }
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle(CH.SETTINGS_GET, () => settings.getAll());
  ipcMain.handle(CH.SETTINGS_SET, (_e, patch) => {
    const before = settings.getAll();
    const after = settings.set(patch);
    if (patch && 'launchOnStartup' in patch && before.launchOnStartup !== after.launchOnStartup) {
      applyLaunchOnStartup();
    }
    return after;
  });

  ipcMain.handle(CH.HISTORY_LIST, () => history.list());
  ipcMain.handle(CH.HISTORY_CLEAR, () => { history.clear(); return true; });

  ipcMain.handle(CH.MODELS_LIST, () => modelManager.list());
  ipcMain.handle(CH.MODELS_DOWNLOAD, (_e, name) =>
    modelManager.download(name, (progress) => broadcast(CH.MODELS_PROGRESS, progress))
  );
  ipcMain.handle(CH.MODELS_CANCEL, (_e, name) => modelManager.cancel(name));
  ipcMain.handle(CH.MODELS_DELETE, (_e, name) => {
    const res = modelManager.remove(name);
    if (settings.get('model') === name) settings.set({ model: null });
    return res;
  });

  ipcMain.handle(CH.AUDIO_DATA, (_e, pcmArrayBuffer, sampleRate) =>
    handleFinishedAudio(pcmArrayBuffer, sampleRate)
  );
  ipcMain.on(CH.CAPTURE_ERROR, (_e, message) => {
    setDictationState('idle');
    broadcast(CH.DICTATION_ERROR, message);
    notifyUser('Susurro microphone error', message);
  });

  ipcMain.on(CH.RECORDING_TOGGLE, () => toggleDictation());

  ipcMain.on(CH.OVERLAY_MOVE, (_e, pos) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.setPosition(Math.round(pos.x), Math.round(pos.y));
  });
  ipcMain.on(CH.OVERLAY_MOVE_END, () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const [x, y] = overlayWindow.getPosition();
    settings.set({ overlayPosition: clampToDisplays(x, y) });
  });
  ipcMain.handle(CH.OVERLAY_GET_POSITION, () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { x: 0, y: 0 };
    const [x, y] = overlayWindow.getPosition();
    return { x, y };
  });

  ipcMain.handle(CH.HOTKEY_SET, (_e, accel) => {
    const res = hotkeys.register(accel, toggleDictation);
    if (res.ok) settings.set({ hotkey: hotkeys.normalize(accel) });
    else applyHotkey(); // re-bind the existing hotkey
    return res;
  });
  ipcMain.handle(CH.HOTKEY_CONFLICTS, (_e, accel) => ({
    reserved: hotkeys.isReserved(accel),
  }));

  ipcMain.handle(CH.INJECTION_INFO, () => {
    waylandDetect.reset(); // pick up freshly installed tools without restart
    return injection.info(settings.get('injectionMethod'));
  });

  ipcMain.handle(CH.OLLAMA_STATUS, () => ollama.status());

  ipcMain.handle(CH.PERM_ACCESSIBILITY, () => {
    if (process.platform !== 'darwin') return { granted: true, notApplicable: true };
    return { granted: systemPreferences.isTrustedAccessibilityClient(true) };
  });

  ipcMain.handle(CH.PLATFORM_INFO, () => ({
    platform: process.platform,
    ...waylandDetect.detect(),
    pythonFound: !!whisper.findPython(settings.get('pythonPath')),
  }));

  ipcMain.handle(CH.ONBOARDING_DONE, () => {
    settings.set({ onboarded: true });
    onboardingWindow?.close();
    openMainWindow();
    openOverlayWindow();
    return true;
  });

  ipcMain.on(CH.OPEN_PREFERENCES, () => openPrefsWindow());
  ipcMain.on(CH.OPEN_MAIN, () => openMainWindow());
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

function quit() {
  quitting = true;
  app.quit();
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  // Quit must leave nothing behind: no subprocess, no hotkey, no tray.
  whisper.stop();
  hotkeys.unregisterAll();
  tray?.destroy();
  tray = null;
});

app.on('window-all-closed', () => {
  // Tray app: stay alive until the user picks Quit.
});

app.whenReady().then(() => {
  // Microphone is the only permission any renderer may request.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  registerIpc();
  createTray();

  settings.onChange((all) => broadcast(CH.SETTINGS_CHANGED, all));
  history.onChange((items) => broadcast(CH.HISTORY_CHANGED, items));

  if (settings.get('onboarded')) {
    openMainWindow();
    openOverlayWindow();
  } else {
    openOnboardingWindow();
  }

  applyHotkey();
  applyLaunchOnStartup();

  app.on('activate', () => openMainWindow()); // macOS dock icon click
});
