const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth flow
  signonComplete: () => ipcRenderer.send('signon-complete'),
  setupComplete: () => ipcRenderer.send('setup-complete'),
  signOff: () => ipcRenderer.send('sign-off'),

  // Media windows
  openRadio: () => ipcRenderer.send('open-radio'),
  openTV: () => ipcRenderer.send('open-tv'),
  closeRadio: () => ipcRenderer.send('close-radio'),
  closeTV: () => ipcRenderer.send('close-tv'),
  minimizeRadio: () => ipcRenderer.send('minimize-radio'),
  minimizeTV: () => ipcRenderer.send('minimize-tv'),

  // Historian
  openHistorian: () => ipcRenderer.send('open-historian'),
  closeHistorian: () => ipcRenderer.send('close-historian'),
  minimizeHistorian: () => ipcRenderer.send('minimize-historian'),

  // R3.42 — Email window (chromeless skinned, separate BrowserWindow)
  openEmail: () => ipcRenderer.send('open-email'),
  closeEmail: () => ipcRenderer.send('close-email'),
  minimizeEmail: () => ipcRenderer.send('minimize-email'),

  // KEY FIX: read asset as base64 data URI directly from disk
  // This bypasses the upload-to-JPEG recompression issue entirely.
  // PNG alpha channels are preserved because fs.readFileSync reads raw bytes.
  readAssetBase64: (filename) => ipcRenderer.invoke('read-asset-base64', filename),

  // R3.39 — Gmail OAuth (Desktop client + loopback PKCE flow).
  // start() opens the consent window and resolves with
  // {accessToken, refreshToken, expiresAt} or {error}.
  // refresh(refreshToken) returns new tokens or {error}.
  gmailOAuth: {
    start: () => ipcRenderer.invoke('gmail-oauth-start'),
    refresh: (refreshToken) => ipcRenderer.invoke('gmail-oauth-refresh', refreshToken),
  },
});
