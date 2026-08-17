/**
 * KioskShell — Electron main process
 */
const { app, BrowserWindow, ipcMain, screen, Menu, session, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');

app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('disable-touch-virtual-keyboard');
app.disableHardwareAcceleration();

// ── Stable config path (survives temp cleanup / reinstall) ───────────────────
const stableDataRoot = path.join(app.getPath('appData'), 'KioskShell');
fs.mkdirSync(stableDataRoot, { recursive: true });
app.setPath('userData', stableDataRoot);
app.setPath('sessionData', path.join(stableDataRoot, 'session'));

// ── File-based config backup alongside localStorage ──────────────────────────
const CFG_BACKUP_PATH = path.join(stableDataRoot, 'kiosk-config.json');
function readCfgBackup() {
  try { return JSON.parse(fs.readFileSync(CFG_BACKUP_PATH, 'utf8')); } catch (_) { return null; }
}
function writeCfgBackup(data) {
  try { fs.writeFileSync(CFG_BACKUP_PATH, JSON.stringify(data), 'utf8'); } catch (_) {}
}

// ── Admin session token ──────────────────────────────────────────────────────
// Generated fresh each launch; renderer requests it after PIN auth, then passes
// it back for every destructive IPC call so the main process can verify the
// caller actually went through the auth flow.
const ADMIN_SESSION_TOKEN = crypto.randomBytes(32).toString('hex');
let adminSessionGranted = false;

let win;
let forceFullscreen = false;
let lastVirtualKeyFrameId = null;
let allowAppExit = false;
let virtualKeyStateCache = { time: 0, value: { hasEditable: false, recentClick: false } };
let kioskGuardTimer = null;
let shellGuardBusy = false;
let updateState = {
  status: 'idle',
  version: app.getVersion(),
  availableVersion: null,
  progress: 0,
  error: null
};
let keyboardConfig = { enabled: true, layout: 'en', width: 100, height: 56, font: 20 };
const kioskBoardBundlePath = path.join(__dirname, '../renderer/vendor/kioskboard/kioskboard-aio.min.js');
const kioskBoardBundle = fs.existsSync(kioskBoardBundlePath) ? fs.readFileSync(kioskBoardBundlePath, 'utf8') : '';
const KIOSKBOARD_ROWS = {
  en: [['q','w','e','r','t','y','u','i','o','p'], ['a','s','d','f','g','h','j','k','l'], ['z','x','c','v','b','n','m','.']],
  fr: [['a','z','e','r','t','y','u','i','o','p'], ['q','s','d','f','g','h','j','k','l','m'], ['w','x','c','v','b','n',',','.']],
  de: [['q','w','e','r','t','z','u','i','o','p'], ['a','s','d','f','g','h','j','k','l','ö'], ['y','x','c','v','b','n','m','ü']],
  es: [['q','w','e','r','t','y','u','i','o','p'], ['a','s','d','f','g','h','j','k','l','ñ'], ['z','x','c','v','b','n','m',',']]
};

function kioskBoardRowsFor(layout) {
  const rows = KIOSKBOARD_ROWS[layout] || KIOSKBOARD_ROWS.en;
  return rows.map(row => Object.fromEntries(row.map((key, index) => [String(index), key])));
}

function getKioskBoardFrameScript() {
  const config = keyboardConfig;
  const rows = kioskBoardRowsFor(config.layout);
  return `(() => {
    if (!${JSON.stringify(!!config.enabled)}) return;
    const skipTypes = ['button','checkbox','color','file','hidden','image','radio','range','reset','submit'];
    const prepare = () => {
      document.querySelectorAll('input, textarea').forEach((el) => {
        const type = (el.type || 'text').toLowerCase();
        if (el.disabled || el.readOnly || skipTypes.includes(type)) return;
        el.classList.add('ks-kioskboard-input');
        const numeric = ${JSON.stringify(config.layout === 'numeric')} || type === 'number' || type === 'tel';
        el.setAttribute('data-kioskboard-type', numeric ? 'numpad' : 'all');
        el.setAttribute('data-kioskboard-placement', 'bottom');
        el.setAttribute('data-kioskboard-specialcharacters', numeric ? 'false' : 'true');
      });
    };
    const run = () => {
      prepare();
      if (!window.KioskBoard) (0, eval)(${JSON.stringify(kioskBoardBundle)});
      if (!window.KioskBoard) return;
      const signature = ${JSON.stringify(JSON.stringify(config))};
      if (window.__ksKioskBoardSignature !== signature) {
        window.KioskBoard.run('.ks-kioskboard-input', {
          keysArrayOfObjects: ${JSON.stringify(rows)},
          language: ${JSON.stringify(['fr','de','es'].includes(config.layout) ? config.layout : 'en')},
          theme: 'light',
          autoScroll: false,
          capsLockActive: false,
          allowRealKeyboard: true,
          allowMobileKeyboard: false,
          cssAnimations: true,
          cssAnimationsDuration: 180,
          cssAnimationsStyle: 'slide',
          keysAllowSpacebar: true,
          keysSpacebarText: 'Space',
          keysFontFamily: 'Inter, Arial, sans-serif',
          keysFontSize: ${JSON.stringify(`${config.font || 20}px`)},
          keysFontWeight: '700',
          keysIconSize: '24px',
          keysEnterText: 'Enter',
          keysEnterCanClose: true
        });
        window.__ksKioskBoardSignature = signature;
      }
      if (!window.__ksKioskBoardObserver) {
        window.__ksKioskBoardObserver = new MutationObserver(() => {
          clearTimeout(window.__ksKioskBoardTimer);
          window.__ksKioskBoardTimer = setTimeout(run, 150);
        });
        window.__ksKioskBoardObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  })()`;
}

async function injectKioskBoardIntoFrames(webContents) {
  if (!webContents || !webContents.mainFrame || !keyboardConfig.enabled || !kioskBoardBundle) return;
  const script = getKioskBoardFrameScript();
  for (const frame of webContents.mainFrame.framesInSubtree) {
    try { await frame.executeJavaScript(script, true); } catch (_) {}
  }
}
const EDITABLE_CHECK = `(() => {
  const isEditable = (el) => {
    if (!el) return false;
    if (el.matches?.('textarea')) return !el.readOnly && !el.disabled;
    if (el.matches?.('input')) {
      const type = (el.type || 'text').toLowerCase();
      if (!['button','checkbox','color','file','hidden','image','radio','range','reset','submit'].includes(type)) {
        return !el.readOnly && !el.disabled;
      }
      return false;
    }
    return !!el.isContentEditable;
  };
  if (!window.__ksTrackInit) {
    window.__ksTrackInit = true;
    window.__ksLastEditablePointer = 0;
    window.addEventListener('pointerdown', (event) => {
      if (isEditable(event.target)) window.__ksLastEditablePointer = Date.now();
    }, true);
  }
  const el = document.activeElement;
  if (!el) return { editable: false };
  const editable = isEditable(el);
  return { editable, recentClick: (Date.now() - window.__ksLastEditablePointer) < 900 };
})()`;

async function findActiveEditableFrame(webContents) {
  if (!webContents || !webContents.mainFrame) return null;
  const frames = [...webContents.mainFrame.framesInSubtree].reverse();
  if (lastVirtualKeyFrameId != null) {
    frames.sort((a, b) => (a.frameTreeNodeId === lastVirtualKeyFrameId ? -1 : 0) - (b.frameTreeNodeId === lastVirtualKeyFrameId ? -1 : 0));
  }
  for (const frame of frames) {
    try {
      const res = await frame.executeJavaScript(EDITABLE_CHECK, true);
      if (res && res.editable) {
        lastVirtualKeyFrameId = frame.frameTreeNodeId;
        return { frame, recentClick: res.recentClick };
      }
    } catch (_) {}
  }
  lastVirtualKeyFrameId = null;
  return null;
}

function sendUpdateState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('update-state', updateState);
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch, version: app.getVersion() };
  sendUpdateState();
  return updateState;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', progress: 0, error: null });
  });

  autoUpdater.on('update-available', info => {
    setUpdateState({
      status: 'available',
      availableVersion: info.version || null,
      progress: 0,
      error: null
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdateState({ status: 'none', progress: 0, error: null });
  });

  autoUpdater.on('download-progress', progress => {
    setUpdateState({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      error: null
    });
  });

  autoUpdater.on('update-downloaded', info => {
    setUpdateState({
      status: 'ready',
      availableVersion: info.version || updateState.availableVersion,
      progress: 100,
      error: null
    });
  });

  autoUpdater.on('error', error => {
    setUpdateState({
      status: 'error',
      error: error && error.message ? error.message : String(error)
    });
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function enableAppExit() {
  allowAppExit = true;
  forceFullscreen = false;
  stopKioskGuard();
  restoreWindowsShell();
  if (!win || win.isDestroyed()) return;
  try { win.setClosable(true); } catch (_) {}
  try { win.setAlwaysOnTop(false); } catch (_) {}
  try { if (win.isKiosk()) win.setKiosk(false); } catch (_) {}
}

function runHiddenPowerShell(script) {
  if (process.platform !== 'win32') return;
  execFile('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-Command', script
  ], { windowsHide: true }, () => {});
}

function suppressWindowsShell() {
  if (process.platform !== 'win32' || shellGuardBusy || allowAppExit) return;
  shellGuardBusy = true;
  const script = `
    $ErrorActionPreference = 'SilentlyContinue'
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    foreach ($class in @('Shell_TrayWnd','Shell_SecondaryTrayWnd')) {
      $h = [Win32]::FindWindow($class, $null)
      if ($h -ne [IntPtr]::Zero) { [Win32]::ShowWindow($h, 0) | Out-Null }
    }
    Get-Process StartMenuExperienceHost,SearchHost,SearchApp -ErrorAction SilentlyContinue | Stop-Process -Force
  `;
  execFile('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-Command', script
  ], { windowsHide: true }, () => { shellGuardBusy = false; });
}

function restoreWindowsShell() {
  if (process.platform !== 'win32') return;
  runHiddenPowerShell(`
    $ErrorActionPreference = 'SilentlyContinue'
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    foreach ($class in @('Shell_TrayWnd','Shell_SecondaryTrayWnd')) {
      $h = [Win32]::FindWindow($class, $null)
      if ($h -ne [IntPtr]::Zero) { [Win32]::ShowWindow($h, 5) | Out-Null }
    }
  `);
}

function getKioskBounds() {
  const display = screen.getPrimaryDisplay();
  return display.bounds || { x: 0, y: 0, width: display.size.width, height: display.size.height };
}

function enforceKioskWindow() {
  if (!win || win.isDestroyed() || allowAppExit) return;
  const bounds = getKioskBounds();
  try { win.setSkipTaskbar(true); } catch (_) {}
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { win.setBounds(bounds, false); } catch (_) {}
  try { if (!win.isFullScreen()) win.setFullScreen(true); } catch (_) {}
  try { if (!win.isKiosk()) win.setKiosk(true); } catch (_) {}
  try { if (win.isMinimized()) win.restore(); } catch (_) {}
  try { win.moveTop(); } catch (_) {}
  try { win.focus(); } catch (_) {}
}

function startKioskGuard() {
  if (kioskGuardTimer) clearInterval(kioskGuardTimer);
  suppressWindowsShell();
  enforceKioskWindow();
  kioskGuardTimer = setInterval(() => {
    enforceKioskWindow();
    suppressWindowsShell();
  }, 1500);
}

function stopKioskGuard() {
  if (!kioskGuardTimer) return;
  clearInterval(kioskGuardTimer);
  kioskGuardTimer = null;
}

function createWindow() {
  const { x, y, width, height } = getKioskBounds();

  win = new BrowserWindow({
    x, y,
    width, height,
    frame:           false,
    kiosk:           true,
    fullscreen:      true,
    autoHideMenuBar: true,
    resizable:       false,
    movable:         false,
    minimizable:     false,
    maximizable:     false,
    closable:        false,
    fullscreenable:  false,
    alwaysOnTop:     true,
    backgroundColor: '#0a0c0f',
    webPreferences: {
      nodeIntegration:             false,
      contextIsolation:            true,
      sandbox:                     false,
      preload:                     path.join(__dirname, 'preload.js'),
      allowRunningInsecureContent: true,
      webSecurity:                 false,
    },
  });

  Menu.setApplicationMenu(null);
  forceFullscreen = true;
  win.setMenuBarVisibility(false);
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setBounds(getKioskBounds(), false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setFullScreen(true);
  win.setKiosk(true);
  startKioskGuard();
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('closed', () => { win = null; });
  win.on('will-resize', (event) => event.preventDefault());
  win.on('will-move', (event) => event.preventDefault());
  win.on('minimize', (event) => {
    event.preventDefault();
    if (!win) return;
    win.restore();
    win.focus();
  });
  win.on('restore', () => {
    if (!win) return;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (forceFullscreen) {
      win.setFullScreen(true);
      win.setKiosk(true);
    }
  });
  win.on('blur', () => {
    if (!win || allowAppExit) return;
    setTimeout(() => {
      if (!win || win.isDestroyed() || allowAppExit) return;
      enforceKioskWindow();
    }, 50);
  });
  win.on('close', (event) => {
    if (!allowAppExit) event.preventDefault();
  });
  win.on('query-session-end', () => {
    enableAppExit();
  });
  win.on('session-end', () => {
    enableAppExit();
    if (!win || win.isDestroyed()) return;
    win.destroy();
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[did-fail-load] mainFrame=${isMainFrame} code=${errorCode} url=${validatedURL} ${errorDescription}`);
  });
  win.webContents.on('did-frame-finish-load', () => {
    setTimeout(() => injectKioskBoardIntoFrames(win && win.webContents), 250);
  });
  win.webContents.on('will-prevent-unload', event => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (event, input) => {
    const key = input.key || '';
    const lower = key.toLowerCase();
    const isFunctionKey = /^F\d{1,2}$/.test(key);
    const blockedCtrl = input.control && ['r', 'n', 't', 'w', 'l', 'u', 'p', 's', 'o'].includes(lower);
    const blockedCtrlShift = input.control && input.shift && ['i', 'j', 'c'].includes(lower);
    const blockedAlt = input.alt && ['f4', 'left', 'right', 'home'].includes(lower);
    const blockedNavKey = ['BrowserBack', 'BrowserForward', 'BrowserRefresh'].includes(key);
    const blockedMeta = input.meta || lower === 'meta' || lower === 'super' || lower === 'os';
    const blockedFullscreenKey = key === 'Escape' || key === 'F11';
    if (isFunctionKey || blockedCtrl || blockedCtrlShift || blockedAlt || blockedNavKey || blockedFullscreenKey || blockedMeta) {
      event.preventDefault();
      enforceKioskWindow();
    }
  });
  win.webContents.on('devtools-opened', () => {
    if (!app.isPackaged || !win) return;
    win.webContents.closeDevTools();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[render-process-gone] reason=${details.reason} exitCode=${details.exitCode}`);
    if (!allowAppExit && details.reason !== 'clean-exit') {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        win.webContents.reload();
      }, 1500);
    }
  });
  win.webContents.on('unresponsive', () => {
    console.error('[renderer] window became unresponsive');
    if (!allowAppExit) {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        if (win.webContents.isDevToolsOpened()) return;
        win.webContents.forcefullyCrashRenderer?.();
      }, 8000);
    }
  });
  win.webContents.on('responsive', () => {
    console.log('[renderer] window became responsive again');
  });

  // ── Fullscreen state relay ────────────────────────────────────────────────
  const sendState = () => {
    if (!win) return;
    win.webContents.send('window-state', { fullscreen: win.isFullScreen(), kiosk: win.isKiosk() });
  };
  ['enter-full-screen','leave-full-screen','enter-html-full-screen','leave-html-full-screen']
    .forEach(ev => win.on(ev, sendState));

  // Re-enter fullscreen when forceFullscreen is on
  win.on('leave-full-screen',      () => { if (forceFullscreen) setTimeout(enforceKioskWindow, 100); });
  win.on('leave-html-full-screen', () => { if (forceFullscreen) setTimeout(enforceKioskWindow, 100); });
}

// ── Domain allow-list (main-process copy, enforced at network boundary) ───────
let mainDomains = [];
let mainStrictMode = true;

function normalizeDomainMain(v) {
  return String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/\/.*$/, '')
    .replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.+$/, '');
}

function isDomainAllowedMain(hostname) {
  if (!mainDomains.length) return true;
  const h = normalizeDomainMain(hostname);
  return mainDomains.some(d => h === d || h.endsWith('.' + d));
}

// ── IPC ───────────────────────────────────────────────────────────────────────

/** Fullscreen — use setFullScreen (works unsigned in dev). */
ipcMain.on('set-fullscreen', (_ev, on, force) => {
  if (!win) return;
  forceFullscreen = !!force;
  win.setFullScreen(!!on);
});

/** Kiosk mode — full OS lock (hides taskbar/dock, blocks Esc). */
ipcMain.on('set-kiosk', (_ev, on) => {
  if (!win) return;
  win.setKiosk(!!on);
  if (!on) win.setFullScreen(false);
});

/** Deliver virtual keyboard keys to the focused editable element in any frame. */
ipcMain.on('virtual-key', async (_ev, payload = {}) => {
  if (!win) return;
  const wc = win.webContents;
  if (!wc || !wc.mainFrame) return;

  const ALLOWED_TYPES = new Set(['text', 'backspace', 'left', 'right', 'enter']);
  if (!payload || typeof payload !== 'object') return;
  if (!ALLOWED_TYPES.has(payload.type)) return;

  const MAX_TEXT_LEN = 512;
  let text = typeof payload.text === 'string' ? payload.text.slice(0, MAX_TEXT_LEN) : '';
  if (payload.type === 'text' && !text) return;

  const res = await findActiveEditableFrame(wc);
  if (!res) return;
  const activeFrame = res.frame;

  const textLiteral = JSON.stringify(text);
  let action = '';
  switch (payload.type) {
    case 'text':
      action = `
        if (el.matches?.('input,textarea')) {
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? start;
          el.value = el.value.slice(0, start) + ${textLiteral} + el.value.slice(end);
          const next = start + ${textLiteral}.length;
          try { el.setSelectionRange(next, next); } catch (_) {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.isContentEditable) {
          document.execCommand('insertText', false, ${textLiteral});
        }
      `;
      break;
    case 'backspace':
      action = `
        if (el.matches?.('input,textarea')) {
          const start = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? start;
          if (start !== end) el.value = el.value.slice(0, start) + el.value.slice(end);
          else if (start > 0) el.value = el.value.slice(0, start - 1) + el.value.slice(start);
          const next = start !== end ? start : Math.max(0, start - 1);
          try { el.setSelectionRange(next, next); } catch (_) {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (el.isContentEditable) {
          document.execCommand('delete', false);
        }
      `;
      break;
    case 'left':
      action = `
        if (el.matches?.('input,textarea')) {
          const pos = Math.max(0, (el.selectionStart ?? 0) - 1);
          try { el.setSelectionRange(pos, pos); } catch (_) {}
        }
      `;
      break;
    case 'right':
      action = `
        if (el.matches?.('input,textarea')) {
          const pos = Math.max(0, (el.selectionStart ?? 0) + 1);
          try { el.setSelectionRange(pos, pos); } catch (_) {}
        }
      `;
      break;
    case 'enter':
      action = `
        if (el.matches?.('textarea')) {
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? start;
          el.value = el.value.slice(0, start) + '\\n' + el.value.slice(end);
          const next = start + 1;
          try { el.setSelectionRange(next, next); } catch (_) {}
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        }
      `;
      break;
    default:
      return;
  }

  try {
    await activeFrame.executeJavaScript(`(() => {
      const el = document.activeElement;
      if (!el) return false;
      ${action}
      return true;
    })()`, true);
  } catch (error) {
    console.error('[virtual-key] frame execution failed', error);
  }
});

ipcMain.handle('virtual-key-state', async () => {
  if (!win) return { hasEditable: false, recentClick: false };
  const now = Date.now();
  if (now - virtualKeyStateCache.time < 500) return virtualKeyStateCache.value;
  const res = await findActiveEditableFrame(win.webContents);
  virtualKeyStateCache = {
    time: now,
    value: { hasEditable: !!res, recentClick: res ? res.recentClick : false }
  };
  return virtualKeyStateCache.value;
});

ipcMain.handle('keyboard-config', async (_event, config = {}) => {
  if (!config || typeof config !== 'object') return false;
  const ALLOWED_LAYOUTS = new Set(['en', 'fr', 'de', 'es', 'numeric']);
  keyboardConfig = {
    enabled: config.enabled !== false,
    layout: ALLOWED_LAYOUTS.has(config.layout) ? config.layout : 'en',
    width:  Math.max(20, Math.min(100, Math.round(Number(config.width)  || 100))),
    height: Math.max(32, Math.min(120, Math.round(Number(config.height) || 56))),
    font:   Math.max(10, Math.min(40,  Math.round(Number(config.font)   || 20))),
  };
  virtualKeyStateCache = { time: 0, value: { hasEditable: false, recentClick: false } };
  setTimeout(() => injectKioskBoardIntoFrames(win && win.webContents), 50);
  return true;
});

/** Hard refresh — reload the shell, bypassing the HTTP cache. */
ipcMain.on('hard-refresh', () => {
  if (!win) return;
  win.webContents.reloadIgnoringCache();
});

/** Toggle Chromium DevTools, detached so it doesn't eat into the kiosk viewport. */
ipcMain.on('toggle-devtools', () => {
  if (!win) return;
  if (app.isPackaged) return;
  if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
  else win.webContents.openDevTools({ mode: 'detach' });
});

/** Clear the HTTP cache only (keeps cookies/localStorage of the framed site). */
ipcMain.handle('clear-cache', async () => {
  await session.defaultSession.clearCache();
  return true;
});

ipcMain.handle('update-state', async () => updateState);

ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) {
    return setUpdateState({
      status: 'error',
      error: 'Updates are only available in the installed Windows app.'
    });
  }
  setUpdateState({ status: 'checking', progress: 0, error: null });
  await autoUpdater.checkForUpdates();
  return updateState;
});

ipcMain.handle('update-download', async () => {
  if (!app.isPackaged) {
    return setUpdateState({
      status: 'error',
      error: 'Updates are only available in the installed Windows app.'
    });
  }
  setUpdateState({ status: 'downloading', progress: 0, error: null });
  await autoUpdater.downloadUpdate();
  return updateState;
});

ipcMain.handle('update-install', async () => {
  if (updateState.status !== 'ready') return updateState;
  enableAppExit();
  restoreWindowsShell();
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 250);
  return setUpdateState({ status: 'installing', error: null });
});

/** Lockdown Windows OS (Elevated) */
ipcMain.handle('lockdown-windows', async () => {
  if (process.platform !== 'win32') return false;
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    
    const psScript = `
      $ErrorActionPreference = 'SilentlyContinue'
      Stop-Service -Name "TabletInputService" -Force
      Set-Service -Name "TabletInputService" -StartupType Disabled
      if (!(Test-Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\EdgeUI")) {
          New-Item -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\EdgeUI" -Force | Out-Null
      }
      Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\EdgeUI" -Name "AllowEdgeSwipe" -Value 0 -Type DWord -Force
      if (!(Test-Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad")) {
          New-Item -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad" -Force | Out-Null
      }
      Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad" -Name "ThreeFingerSlideEnabled" -Value 0 -Type DWord -Force
      Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\PrecisionTouchPad" -Name "FourFingerSlideEnabled" -Value 0 -Type DWord -Force
    `;
    
    // Encode to base64 to avoid escaping issues in command line
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    
    // Run PowerShell elevated, executing the base64 script
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}'"`;
    
    exec(cmd, (error) => {
      // The command will resolve immediately after the UAC prompt starts the new process.
      resolve(!error);
    });
  });
});

ipcMain.handle('exit-app', async (_event, token) => {
  if (app.isPackaged && token !== ADMIN_SESSION_TOKEN) return false;
  enableAppExit();
  app.removeAllListeners('window-all-closed');
  if (win && !win.isDestroyed()) {
    try { win.removeAllListeners('close'); } catch (_) {}
    try { win.setClosable(true); } catch (_) {}
    try { win.destroy(); } catch (_) {}
  }
  setTimeout(() => app.exit(0), 50);
  return true;
});

ipcMain.handle('set-autostart', (_event, enable) => {
  try {
    if (process.platform !== 'win32') return false;
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      openAsHidden: false,
      args: ['--autostart'],
    });
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('get-autostart', () => {
  try {
    if (process.platform !== 'win32') return false;
    return app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    return false;
  }
});

// ── Admin session token ────────────────────────────────────────────────────────
ipcMain.handle('request-admin-token', () => {
  adminSessionGranted = true;
  return ADMIN_SESSION_TOKEN;
});

// ── Domain allow-list sync from renderer ──────────────────────────────────────
ipcMain.on('sync-domains', (_event, domains, strictMode) => {
  mainDomains = Array.isArray(domains) ? domains.map(normalizeDomainMain).filter(Boolean) : [];
  mainStrictMode = strictMode !== false;
});

// ── Config backup (renderer calls this on every save) ─────────────────────────
ipcMain.handle('backup-config', (_event, data) => {
  if (!data || typeof data !== 'object') return false;
  writeCfgBackup(data);
  return true;
});

// ── Restore config backup (called on init if localStorage is empty) ───────────
ipcMain.handle('restore-config', () => {
  return readCfgBackup();
});

// ── Wipe data (requires admin token in packaged builds) ───────────────────────
ipcMain.handle('wipe-data', async (_event, token) => {
  if (app.isPackaged && token !== ADMIN_SESSION_TOKEN) return false;
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();
  try { fs.unlinkSync(CFG_BACKUP_PATH); } catch (_) {}
  return true;
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  configureAutoUpdater();

  // ── Power save blocker: prevent display/system sleep ──────────────────────
  powerSaveBlocker.start('prevent-display-sleep');

  // ── Domain enforcement at network boundary ────────────────────────────────
  // Blocks navigation and subframe loads that go outside the allow-list,
  // independent of renderer-side checks. Bypasses renderer-only protection.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (!mainDomains.length || !mainStrictMode) { callback({ cancel: false }); return; }
      // Only enforce on subframe navigation (not XHR/fetch/scripts from allowed pages)
      if (!['subFrame', 'mainFrame'].includes(details.resourceType)) { callback({ cancel: false }); return; }
      // Shell index.html itself is a file:// URL — always allow
      if (details.url.startsWith('file://')) { callback({ cancel: false }); return; }
      try {
        const host = new URL(details.url).hostname;
        if (!isDomainAllowedMain(host)) {
          callback({ cancel: true });
          if (win && !win.isDestroyed()) {
            win.webContents.send('domain-blocked', host);
          }
          return;
        }
      } catch (_) {}
      callback({ cancel: false });
    }
  );

  // Strip headers that block iframe embedding
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    if (details.resourceType && !['mainFrame', 'subFrame'].includes(details.resourceType)) {
      callback({ cancel: false, responseHeaders: details.responseHeaders });
      return;
    }

    const originalHeaders = details.responseHeaders || {};
    const newHeaders = {};
    
    for (const key of Object.keys(originalHeaders)) {
      const lower = key.toLowerCase();
      if (![
        'x-frame-options',
        'content-security-policy',
        'content-security-policy-report-only',
        'cross-origin-opener-policy',
        'cross-origin-embedder-policy',
        'cross-origin-resource-policy'
      ].includes(lower)) {
        newHeaders[key] = originalHeaders[key];
      }
    }
    callback({ cancel: false, responseHeaders: newHeaders });
  });

  createWindow();
});
app.on('before-quit', () => {
  enableAppExit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
