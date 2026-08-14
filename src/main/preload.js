const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kioskElectron', {
  /** Set fullscreen (standard, Esc-to-exit). Pass force=true to re-enter if exited. */
  setFullscreen: (on, force) => ipcRenderer.send('set-fullscreen', on, force),

  /** OS kiosk mode — hides dock/taskbar, blocks Esc. */
  setKiosk:      (on)       => ipcRenderer.send('set-kiosk',      on),

  /** Send a virtual keyboard key to the focused page/iframe. */
  sendVirtualKey: (payload) => ipcRenderer.send('virtual-key', payload),

  /** Check whether any frame currently has a focused editable field. */
  getVirtualKeyState: () => ipcRenderer.invoke('virtual-key-state'),

  /** Configure KioskBoard injection for loaded pages. */
  setKeyboardConfig: (config) => ipcRenderer.invoke('keyboard-config', config),

  /** Receive window-state changes (fullscreen / kiosk toggled by OS). */
  onWindowState: (cb)       => ipcRenderer.on('window-state', (_, s) => cb(s)),

  /** Hard refresh the shell, bypassing the HTTP cache. */
  hardRefresh:    ()        => ipcRenderer.send('hard-refresh'),

  /** Toggle Chromium DevTools (detached window). */
  toggleDevTools: ()        => ipcRenderer.send('toggle-devtools'),

  /** Clear the HTTP cache. */
  clearCache:     ()        => ipcRenderer.invoke('clear-cache'),

  /** Wipe cookies, storage, and cache for the framed site. */
  wipeData:       ()        => ipcRenderer.invoke('wipe-data'),

  /** Application updater controls. */
  getUpdateState: ()        => ipcRenderer.invoke('update-state'),
  checkForUpdate: ()        => ipcRenderer.invoke('update-check'),
  downloadUpdate: ()        => ipcRenderer.invoke('update-download'),
  installUpdate:  ()        => ipcRenderer.invoke('update-install'),
  onUpdateState:  (cb)      => ipcRenderer.on('update-state', (_, state) => cb(state)),

  /** Lockdown Windows features (disables touch keyboard, edge swipes, and multi-finger gestures) */
  lockdownWindows: ()       => ipcRenderer.invoke('lockdown-windows'),

  /** Exit the kiosk app through the protected admin UI. */
  exitApp:        ()        => ipcRenderer.invoke('exit-app'),

  /** Enable or disable Windows startup registration. */
  setAutoStart:   (enable)  => ipcRenderer.invoke('set-autostart', enable),

  /** Check whether startup registration is currently active. */
  getAutoStart:   ()        => ipcRenderer.invoke('get-autostart'),
});
