const { app, BrowserWindow, session, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let signonWindow = null;
let radioWindow = null;
let tvWindow = null;
let devServer = null;

// ── Camera permission — trigger immediately on launch ────
// This makes macOS show the permission popup and add the app
// to System Settings → Privacy & Security → Camera
async function requestCameraPermission() {
  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus('camera');
      console.log('Camera status on launch:', status);
      if (status !== 'granted') {
        const granted = await systemPreferences.askForMediaAccess('camera');
        console.log('Camera permission granted:', granted);
      }
    } catch(e) {
      console.log('Camera permission request error:', e.message);
    }
    try {
      const mStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (mStatus !== 'granted') {
        await systemPreferences.askForMediaAccess('microphone');
      }
    } catch(e) {}
  }
}

// ── Dev Server ───────────────────────────────────────────
function startDevServer() {
  const PORT = 7331;
  const SRC = path.join(__dirname, 'src', 'index.html');
  devServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/read') {
      try { res.writeHead(200, {'Content-Type':'text/plain;charset=utf-8'}); res.end(fs.readFileSync(SRC,'utf8')); }
      catch(e) { res.writeHead(500); res.end('Error: '+e.message); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/write') {
      let body=''; req.on('data',c=>body+=c);
      req.on('end',()=>{
        try {
          fs.copyFileSync(SRC, SRC+'.backup');
          fs.writeFileSync(SRC,body,'utf8');
          if(mainWindow) mainWindow.webContents.reloadIgnoringCache();
          res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true}));
        } catch(e) { res.writeHead(500); res.end(JSON.stringify({success:false,error:e.message})); }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      try { const s=fs.statSync(SRC); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({running:true,file:SRC,size:s.size,modified:s.mtime})); }
      catch(e) { res.writeHead(500); res.end('{}'); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/patch') {
      let body=''; req.on('data',c=>body+=c);
      req.on('end',()=>{
        try {
          const {find,replace}=JSON.parse(body);
          let content=fs.readFileSync(SRC,'utf8');
          if(content.includes(find)) {
            fs.copyFileSync(SRC,SRC+'.backup');
            content=content.replace(find,replace);
            fs.writeFileSync(SRC,content,'utf8');
            if(mainWindow) mainWindow.webContents.reloadIgnoringCache();
            res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true}));
          } else {
            res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,error:'String not found'}));
          }
        } catch(e) { res.writeHead(500); res.end(JSON.stringify({success:false,error:e.message})); }
      });
      return;
    }
    res.writeHead(404); res.end('Not found');
  });
  devServer.listen(PORT,'127.0.0.1',()=>{
    console.log(`\n🔧 WWW Live Edit: http://127.0.0.1:${PORT}\n`);
  });
  devServer.on('error',e=>{ if(e.code!=='EADDRINUSE') console.error(e); });
}

// ── Permissions ──────────────────────────────────────────
function setupPermissions(sess) {
  sess = sess || session.defaultSession;
  sess.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  sess.setPermissionCheckHandler(() => true);
  try { sess.setDevicePermissionHandler(() => true); } catch(e) {}
  sess.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"]
      }
    });
  });
}

// ── IPC: read asset as base64 ────────────────────────────
ipcMain.handle('read-asset-base64', (event, filename) => {
  try {
    const p = path.join(__dirname, 'src', 'assets', filename);
    const buf = fs.readFileSync(p);
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
               : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
               : ext === '.gif' ? 'image/gif'
               : ext === '.mp3' ? 'audio/mpeg'
               : 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch(e) {
    console.error('read-asset-base64 error:', e.message);
    return null;
  }
});

// ── Signon window ────────────────────────────────────────
function createSignonWindow() {
  if (signonWindow) { signonWindow.focus(); return; }
  signonWindow = new BrowserWindow({
    width: 1236, height: 980,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: true,
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  signonWindow.loadFile(path.join(__dirname, 'src', 'signon.html'));
  signonWindow.on('closed', () => { signonWindow = null; });
}

// ── Main browser window ──────────────────────────────────
function createMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }
  mainWindow = new BrowserWindow({
    width: 1280, height: 860,
    minWidth: 800, minHeight: 600,
    title: 'WWW — What Web Was',
    backgroundColor: '#00082a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  setupPermissions();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    // Warm up camera so it's ready when user clicks Video
    mainWindow.webContents.executeJavaScript(`
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia({video:true,audio:true})
        .then(s => { s.getTracks().forEach(t=>t.stop()); console.log('Camera pre-warmed OK'); })
        .catch(e => console.log('Camera pre-warm:', e.name, e.message));
    `).catch(()=>{});
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Radio window ─────────────────────────────────────────
function createRadioWindow() {
  if (radioWindow) { radioWindow.focus(); return; }
  radioWindow = new BrowserWindow({
    width: 850, height: 367,
    frame: false, transparent: true,
    resizable: true, hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  setupPermissions(radioWindow.webContents.session);
  radioWindow.loadFile(path.join(__dirname, 'src', 'radio.html'));
  radioWindow.on('closed', () => { radioWindow = null; });
}

// ── TV window ────────────────────────────────────────────
function createTVWindow() {
  if (tvWindow) { tvWindow.focus(); return; }
  tvWindow = new BrowserWindow({
    width: 850, height: 569,
    frame: false, transparent: true,
    resizable: true, hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      webviewTag: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  setupPermissions(tvWindow.webContents.session);
  tvWindow.loadFile(path.join(__dirname, 'src', 'tv.html'));
  tvWindow.on('closed', () => { tvWindow = null; });
}

// ── Historian window ─────────────────────────────────────
let historianWindow = null;
function createHistorianWindow() {
  if (historianWindow) { historianWindow.focus(); return; }
  historianWindow = new BrowserWindow({
    width: 900, height: 680,
    frame: false, transparent: true,
    resizable: true, hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, webviewTag: true, webSecurity: false, preload: path.join(__dirname, 'preload.js') },
  });
  historianWindow.loadFile(path.join(__dirname, 'src', 'historian.html'));
  historianWindow.on('closed', () => { historianWindow = null; });
}

// ── IPC handlers ─────────────────────────────────────────
ipcMain.on('signon-complete', () => {
  createMainWindow();
  if (signonWindow) { signonWindow.close(); signonWindow = null; }
});
ipcMain.on('setup-complete', () => { createSignonWindow(); });
ipcMain.on('sign-off', () => {
  createSignonWindow();
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
});
ipcMain.on('open-radio', () => createRadioWindow());
ipcMain.on('open-tv', () => createTVWindow());
ipcMain.on('close-radio', () => { if(radioWindow){radioWindow.close();radioWindow=null;} });
ipcMain.on('close-tv', () => { if(tvWindow){tvWindow.close();tvWindow=null;} });
ipcMain.on('minimize-radio', () => { if(radioWindow) radioWindow.minimize(); });
ipcMain.on('minimize-tv', () => { if(tvWindow) tvWindow.minimize(); });
ipcMain.on('open-historian', () => createHistorianWindow());
ipcMain.on('close-historian', () => { if(historianWindow){historianWindow.close();historianWindow=null;} });
ipcMain.on('minimize-historian', () => { if(historianWindow) historianWindow.minimize(); });

// ── App start ─────────────────────────────────────────────
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  startDevServer();
  setupPermissions();

  // Request camera/mic permission FIRST before any window opens
  // This triggers the macOS popup and adds app to System Settings
  await requestCameraPermission();

  createSignonWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSignonWindow();
  });
});

app.on('window-all-closed', () => {
  if (devServer) devServer.close();
  if (process.platform !== 'darwin') app.quit();
});
