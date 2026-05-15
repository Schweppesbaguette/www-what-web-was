const { app, BrowserWindow, session, ipcMain, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

let mainWindow = null;
let signonWindow = null;
let radioWindow = null;
let tvWindow = null;
let emailWindow = null;  // R3.42 — chromeless skinned email window
let devServer = null;
let oauthServer = null;    // R3.40 — loopback HTTP server catching the redirect (BrowserWindow approach removed in R3.40)

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

// ── Shared options for all transparent skin windows ──────
// Kills the white border / shadow halo on macOS
const SKIN_WINDOW_OPTS = {
  frame: false,
  transparent: true,
  hasShadow: false,           // <- was true; the shadow renders a halo on transparent windows
  backgroundColor: '#00000000',
  titleBarStyle: 'hidden',    // extra insurance against title bar bleed
  roundedCorners: false,      // prevents macOS auto rounded-corner mask
  vibrancy: null,             // no Big Sur translucency effects
  thickFrame: false,          // Windows-specific but harmless on Mac
};

// ── Signon window ────────────────────────────────────────
function createSignonWindow() {
  if (signonWindow) { signonWindow.focus(); return; }
  signonWindow = new BrowserWindow({
    width: 1236, height: 980,
    resizable: false,
    alwaysOnTop: false,
    ...SKIN_WINDOW_OPTS,
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
    resizable: false,
    ...SKIN_WINDOW_OPTS,
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

  // R3.13 — YouTube Error 153 root cause:
  // Embedded YouTube checks the Referer + Origin headers on requests for
  // /embed/<id>. Inside Electron's webview the parent page is file://,
  // so the request goes out with no Referer (or a null/blank one), and
  // YouTube refuses to render → "Error 153 — Video player configuration error".
  // Fix: intercept the webview partition's outgoing requests and stamp a
  // valid Referer + Origin onto YouTube and youtube-nocookie traffic.
  try {
    const tvSession = session.fromPartition('persist:tv');
    tvSession.webRequest.onBeforeSendHeaders((details, cb) => {
      const url = details.url || '';
      if (url.includes('youtube.com') || url.includes('youtube-nocookie.com') || url.includes('ytimg.com') || url.includes('googlevideo.com')) {
        details.requestHeaders['Referer'] = 'https://www.youtube.com/';
        details.requestHeaders['Origin']  = 'https://www.youtube.com';
      }
      cb({ requestHeaders: details.requestHeaders });
    });
    // Permission handler for the TV webview's session, so getUserMedia/etc don't block
    tvSession.setPermissionRequestHandler((wc, perm, cbk) => cbk(true));
    tvSession.setPermissionCheckHandler(() => true);
  } catch(e) {
    console.error('TV session header rewrite setup failed:', e.message);
  }

  tvWindow = new BrowserWindow({
    width: 850, height: 569,
    resizable: false,
    ...SKIN_WINDOW_OPTS,
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

// ── R3.42 — Email window ──────────────────────────────────
// Chromeless pop-out window with painted skin (email-skin.png, 1448×1086
// scaled to 0.62 → 898×673). Follows the radio/tv chromeless pattern.
// Talks to Gmail through the same OAuth IPC bridge used by index.html.
function createEmailWindow() {
  if (emailWindow) { emailWindow.focus(); return; }
  emailWindow = new BrowserWindow({
    width: 898, height: 673,
    resizable: false,
    ...SKIN_WINDOW_OPTS,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  emailWindow.loadFile(path.join(__dirname, 'src', 'email.html'));
  emailWindow.on('closed', () => { emailWindow = null; });
}

// ── Historian window ─────────────────────────────────────
let historianWindow = null;
function createHistorianWindow() {
  if (historianWindow) { historianWindow.focus(); return; }
  historianWindow = new BrowserWindow({
    width: 900, height: 680,
    resizable: false,
    ...SKIN_WINDOW_OPTS,
    webPreferences: { nodeIntegration: false, contextIsolation: true, webviewTag: true, webSecurity: false, preload: path.join(__dirname, 'preload.js') },
  });
  historianWindow.loadFile(path.join(__dirname, 'src', 'historian.html'));
  historianWindow.on('closed', () => { historianWindow = null; });
}

// ── R3.39 — Gmail OAuth (Desktop client + loopback PKCE flow) ─────
const GMAIL_DESKTOP_CLIENT_ID = '487863450922-8p39nt8er3bf1ksbbbng9mu79rje0bb6.apps.googleusercontent.com';
let GMAIL_DESKTOP_CLIENT_SECRET = null;
function loadGmailCredentials() {
  try {
    const credPath = path.join(__dirname, 'src', 'gmail-credentials.json');
    if (!fs.existsSync(credPath)) {
      console.warn('R3.40.3 gmail-credentials.json not found at', credPath, '— Gmail OAuth will be disabled');
      return false;
    }
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const cfg = raw.installed || raw.web || raw;
    if (!cfg.client_secret) {
      console.warn('R3.40.3 gmail-credentials.json missing client_secret');
      return false;
    }
    GMAIL_DESKTOP_CLIENT_SECRET = cfg.client_secret;
    if (cfg.client_id && cfg.client_id !== GMAIL_DESKTOP_CLIENT_ID) {
      console.warn('R3.40.3 client_id in credentials file (' + cfg.client_id.slice(0,30) + '...) doesn\'t match constant — using file value');
    }
    console.log('R3.40.3 Gmail credentials loaded OK');
    return true;
  } catch(e) {
    console.warn('R3.40.3 failed to load gmail-credentials.json:', e.message);
    return false;
  }
}
loadGmailCredentials();
// R3.42.8.2 — Switched from gmail.readonly + gmail.send to gmail.modify.
// modify is a strict superset of both (read, send, label changes, trash,
// untrash) and is required for actDelete/untrashMessage to work. Trying
// to call users.messages.trash with only readonly/send returns 403
// "Request had insufficient authentication scopes". After this change,
// existing refresh tokens issued under the narrower scope KEEP WORKING
// for read+send but still 403 on trash; user must disconnect + reconnect
// Gmail in the app to consent to the broader scope.
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.modify';

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function closeOAuthServer() {
  try { if (oauthServer) oauthServer.close(); } catch(e){}
  oauthServer = null;
}

function startGmailOAuthFlow() {
  return new Promise((resolve, reject) => {
    if (!GMAIL_DESKTOP_CLIENT_SECRET) {
      return reject(new Error('missing-credentials: src/gmail-credentials.json not found or invalid. See README for setup.'));
    }
    closeOAuthServer();

    const { verifier, challenge } = pkcePair();
    const state = base64url(crypto.randomBytes(16));
    let redirectUri = null;

    oauthServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, 'http://127.0.0.1');
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
        res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#000820;color:#92d9ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center"><h2>${error ? 'Sign-in cancelled' : '✓ Gmail connected!'}</h2><p>You can close this tab and return to WWW.</p></div><script>setTimeout(()=>window.close(),1500);</script></body></html>`);

        setTimeout(() => {
          closeOAuthServer();
          if (error) return reject(new Error('oauth-error: ' + error));
          if (!code) return reject(new Error('oauth-no-code'));
          if (returnedState !== state) return reject(new Error('oauth-state-mismatch'));
          resolve({ code, verifier, redirectUri });
        }, 100);
      } catch(e) {
        res.writeHead(500); res.end('error');
        closeOAuthServer();
        reject(e);
      }
    });

    oauthServer.on('error', (e) => {
      closeOAuthServer();
      reject(e);
    });

    oauthServer.listen(0, '127.0.0.1', () => {
      const port = oauthServer.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
      console.log('R3.39 gmail-oauth loopback listening on', redirectUri);

      const params = new URLSearchParams({
        client_id: GMAIL_DESKTOP_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state,
        access_type: 'offline',
        prompt: 'consent',
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      console.log('R3.40 opening consent URL in system browser:', authUrl.slice(0, 80) + '...');
      shell.openExternal(authUrl).catch(e => {
        console.warn('R3.40 shell.openExternal failed:', e.message);
        closeOAuthServer();
        reject(new Error('cannot-open-browser: ' + e.message));
      });

      setTimeout(() => {
        if (oauthServer) {
          console.log('R3.40 OAuth flow timed out (5 min)');
          closeOAuthServer();
          reject(new Error('oauth-timeout'));
        }
      }, 5 * 60 * 1000);
    });
  });
}

async function exchangeGmailCode(code, verifier, redirectUri) {
  const body = new URLSearchParams({
    client_id: GMAIL_DESKTOP_CLIENT_ID,
    client_secret: GMAIL_DESKTOP_CLIENT_SECRET,
    code: code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('token-exchange: ' + (json.error_description || json.error || res.status));
  return json;
}

async function refreshGmailAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: GMAIL_DESKTOP_CLIENT_ID,
    client_secret: GMAIL_DESKTOP_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('refresh: ' + (json.error_description || json.error || res.status));
  return json;
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

// R3.42 — Email window IPC (chromeless skinned email window)
ipcMain.on('open-email', () => createEmailWindow());
ipcMain.on('close-email', () => { if(emailWindow){emailWindow.close();emailWindow=null;} });
ipcMain.on('minimize-email', () => { if(emailWindow) emailWindow.minimize(); });

ipcMain.handle('gmail-oauth-start', async () => {
  try {
    const { code, verifier, redirectUri } = await startGmailOAuthFlow();
    console.log('R3.39 got auth code; exchanging for tokens at', redirectUri);
    const tokens = await exchangeGmailCode(code, verifier, redirectUri);
    const expiresAt = Date.now() + ((tokens.expires_in || 3600) * 1000);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt: expiresAt,
      scope: tokens.scope,
    };
  } catch (e) {
    console.warn('R3.39 gmail-oauth-start failed:', e && e.message);
    return { error: String(e && e.message || e) };
  }
});

ipcMain.handle('gmail-oauth-refresh', async (event, refreshToken) => {
  try {
    if (!refreshToken) throw new Error('no-refresh-token');
    const json = await refreshGmailAccessToken(refreshToken);
    const expiresAt = Date.now() + ((json.expires_in || 3600) * 1000);
    return {
      accessToken: json.access_token,
      expiresAt: expiresAt,
      refreshToken: json.refresh_token || null,
    };
  } catch (e) {
    console.warn('R3.39 gmail-oauth-refresh failed:', e && e.message);
    return { error: String(e && e.message || e) };
  }
});

// ── App start ─────────────────────────────────────────────
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  startDevServer();
  setupPermissions();

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
