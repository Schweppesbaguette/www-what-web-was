const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  signonComplete: () => ipcRenderer.send('signon-complete'),
  setupComplete: () => ipcRenderer.send('setup-complete'),
  signOff: () => ipcRenderer.send('sign-off'),
  openRadio: () => ipcRenderer.send('open-radio'),
  openTV: () => ipcRenderer.send('open-tv'),
  openHistorian: () => ipcRenderer.send('open-historian'),
  closeRadio: () => ipcRenderer.send('close-radio'),
  closeTV: () => ipcRenderer.send('close-tv'),
  closeHistorian: () => ipcRenderer.send('close-historian'),
  minimizeRadio: () => ipcRenderer.send('minimize-radio'),
  minimizeTV: () => ipcRenderer.send('minimize-tv'),
  minimizeHistorian: () => ipcRenderer.send('minimize-historian'),
});
