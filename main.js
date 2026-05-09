const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let signonWindow = null;
let devServer = null;

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
            res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true,message:'Patched and reloaded'}));
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
    console.log(`\n🔧 WWW Live Edit Server: http://127.0.0.1:${PORT}`);
  });
  devServer.on('error',e=>{ if(e.code!=='EADDRINUSE') console.error(e); });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 800, minHeight: 600,
    title: 'WWW — What Web Was',
    backgroundColor: '#00082a',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      webviewTag: true, webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    cb(['media','audioCapture','videoCapture','camera','microphone','notifications'].includes(perm));
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createSignonWindow() {
  // Frameless transparent window — the PNG skin IS the window shape
  signonWindow = new BrowserWindow({
    width: 1000, height: 780,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  signonWindow.loadFile(path.join(__dirname, 'src', 'signon.html'));
  signonWindow.on('closed', () => { signonWindow = null; });
}

// IPC: signon complete — close signon, open main
ipcMain.on('signon-complete', (event, config) => {
  createMainWindow();
  if (signonWindow) { signonWindow.close(); signonWindow = null; }
});

// IPC: drag the frameless signon window
ipcMain.on('signon-drag-start', () => {
  if (signonWindow) signonWindow.webContents.send('drag-start');
});

app.whenReady().then(() => {
  startDevServer();
  createSignonWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSignonWindow();
  });
});

app.on('window-all-closed', () => {
  if (devServer) devServer.close();
  if (process.platform !== 'darwin') app.quit();
});

// Radio window
let radioWindow = null;
function createRadioWindow() {
  if (radioWindow) { radioWindow.focus(); return; }
  radioWindow = new BrowserWindow({
    width: 1100, height: 520,
    frame: false, transparent: true,
    resizable: false, hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, webviewTag: true, preload: path.join(__dirname, 'preload.js') },
  });
  radioWindow.loadFile(path.join(__dirname, 'src', 'radio.html'));
  radioWindow.on('closed', () => { radioWindow = null; });
}

// TV window  
let tvWindow = null;
function createTVWindow() {
  if (tvWindow) { tvWindow.focus(); return; }
  tvWindow = new BrowserWindow({
    width: 1100, height: 860,
    frame: false, transparent: true,
    resizable: true, hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true, webviewTag: true, preload: path.join(__dirname, 'preload.js') },
  });
  tvWindow.loadFile(path.join(__dirname, 'src', 'tv.html'));
  tvWindow.on('closed', () => { tvWindow = null; });
}

ipcMain.on('open-radio', () => createRadioWindow());
ipcMain.on('open-tv', () => createTVWindow());
ipcMain.on('minimize-radio', () => { if(radioWindow) radioWindow.minimize(); });
ipcMain.on('minimize-tv', () => { if(tvWindow) tvWindow.minimize(); });
