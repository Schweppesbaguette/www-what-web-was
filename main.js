const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'WWW — What Web Was',
    backgroundColor: '#00082a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,          // allow <webview> for TV + modern browsing
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
  });

  // Allow media (camera/mic) without prompt for the webview pages
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'videoCapture', 'camera', 'microphone'];
    callback(allowed.includes(permission));
  });

  // Allow all WebRTC traffic
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: details.requestHeaders });
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Uncomment to open DevTools for debugging:
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
