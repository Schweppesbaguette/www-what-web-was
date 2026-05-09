const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  signonComplete: (config) => ipcRenderer.send('signon-complete', config),
  openRadio: () => ipcRenderer.send('open-radio'),
  openTV: () => ipcRenderer.send('open-tv'),
  minimizeRadio: () => ipcRenderer.send('minimize-radio'),
  minimizeTV: () => ipcRenderer.send('minimize-tv'),
  onMessage: (cb) => ipcRenderer.on('message', (e, msg) => cb(msg)),
});
