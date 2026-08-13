/**
 * KioskShell — Electron main process
 */
const { app, BrowserWindow, ipcMain, screen, Menu, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Disable web security globally so the renderer can access cross-origin iframe
// contentWindow. This does NOT affect the GPU compositor and does NOT break
// fullscreen.
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-site-isolation-trials');
// Disable Chromium's native touch virtual keyboard so it doesn't conflict with our custom one
app.commandLine.appendSwitch('disable-touch-virtual-keyboard');
// Use software rendering to avoid GPU helper crashes in restricted environments.
app.disableHardwareAcceleration();
// Keep Chromium cache/session storage in a writable temp directory.
const appDataRoot = path.join(app.getPath('temp'), 'kioskshell-data');
fs.mkdirSync(appDataRoot, { recursive: true });
app.setPath('userData', appDataRoot);
app.setPath('sessionData', path.join(appDataRoot, 'session'));

let win;
let forceFullscreen = false;
let lastVirtualKeyFrameId = null;
let allowAppExit = false;
let virtualKeyStateCache = { time: 0, value: { hasEditable: false, recentClick: false } };
let kioskGuardTimer = null;
let shellGuardBusy = false;
const EDITABLE_CHECK = `(() => {
  if (!window.__ksTrackInit) {
    window.__ksTrackInit = true;
    window.__ksLastClick = 0;
    window.addEventListener('pointerdown', () => { window.__ksLastClick = Date.now(); }, true);
  }
  const el = document.activeElement;
  if (!el) return { editable: false };
  let editable = false;
  if (el.matches?.('textarea')) editable = !el.readOnly && !el.disabled;
  else if (el.matches?.('input')) {
    const type = (el.type || 'text').toLowerCase();
    if (!['button','checkbox','color','file','hidden','image','radio','range','reset','submit'].includes(type)) {
      editable = !el.readOnly && !el.disabled;
    }
  } else {
    editable = !!el.isContentEditable;
  }
  return { editable, recentClick: (Date.now() - window.__ksLastClick) < 2000 };
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

function enforceKioskWindow() {
  if (!win || win.isDestroyed() || allowAppExit) return;
  try { win.setSkipTaskbar(true); } catch (_) {}
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
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
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
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
  });
  win.webContents.on('unresponsive', () => {
    console.error('[renderer] window became unresponsive');
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
  const res = await findActiveEditableFrame(wc);
  if (!res) return;
  const activeFrame = res.frame;

  const text = typeof payload.text === 'string' ? payload.text : '';
  const textLiteral = JSON.stringify(text);
  let action = '';
  switch (payload.type) {
    case 'text':
      if (!text) return;
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

/** Wipe everything the framed site could have stored — cookies, storage, cache. */
ipcMain.handle('wipe-data', async () => {
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();
  return true;
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

ipcMain.handle('exit-app', async () => {
  enableAppExit();
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  app.quit();
  return true;
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Strip headers that block iframe embedding (X-Frame-Options, CSP frame-ancestors)
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
