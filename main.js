const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
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
      try {
        const content = fs.readFileSync(SRC, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
      } catch (e) { res.writeHead(500); res.end('Error: ' + e.message); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/write') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          fs.copyFileSync(SRC, SRC + '.backup');
          fs.writeFileSync(SRC, body, 'utf8');
          if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      try {
        const stat = fs.statSync(SRC);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ running: true, file: SRC, size: stat.size, modified: stat.mtime }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/patch') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { find, replace } = JSON.parse(body);
          let content = fs.readFileSync(SRC, 'utf8');
          if (content.includes(find)) {
            fs.copyFileSync(SRC, SRC + '.backup');
            content = content.replace(find, replace);
            fs.writeFileSync(SRC, content, 'utf8');
            if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Patched and reloaded' }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'String not found' }));
          }
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
      });
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  devServer.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🔧 WWW Live Edit Server: http://127.0.0.1:${PORT}`);
    console.log('   GET  /read  — read source');
    console.log('   POST /write — write + hot reload');
    console.log('   POST /patch — {find,replace} patch + hot reload\n');
  });
  devServer.on('error', e => { if (e.code !== 'EADDRINUSE') console.error(e); });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 800, minHeight: 600,
    title: 'WWW — What Web Was',
    backgroundColor: '#00082a',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      webviewTag: true, webSecurity: true,
    },
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(['media','audioCapture','videoCapture','camera','microphone','notifications'].includes(permission));
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  startDevServer();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (devServer) devServer.close();
  if (process.platform !== 'darwin') app.quit();
});
