const { app, BrowserWindow, session, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

let mainWindow = null;
let signonWindow = null;
let radioWindow = null;
let tvWindow = null;
let devServer = null;
let oauthWindow = null;    // R3.39 — Google consent BrowserWindow
let oauthServer = null;    // R3.39 — loopback HTTP server catching the redirect

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
// Why this exists: Google's GIS Web SDK rejects file:// origins in
// Electron with "invalid_request". The fix is to use a Desktop OAuth
// client and the loopback redirect flow (RFC 8252).
//
// Flow:
//   1. Spin up local HTTP server on a random 127.0.0.1 port
//   2. Open Google's consent URL in a new BrowserWindow with overridden
//      user-agent (strip Electron token so Google's anti-webview heuristic
//      doesn't fire). Use a clean isolated session (persist:gmail-oauth).
//   3. User signs in / consents in that window
//   4. Google redirects to http://127.0.0.1:<port>/?code=<auth_code>
//   5. Our local server catches the request, returns a "you can close this
//      window" HTML page, and resolves the outer promise with the code
//   6. We exchange the code + PKCE code_verifier for {access, refresh} tokens
//      at https://oauth2.googleapis.com/token
//   7. Tokens returned to renderer; renderer persists to localStorage
const GMAIL_DESKTOP_CLIENT_ID = '487863450922-8p39nt8er3bf1ksbbbng9mu79rje0bb6.apps.googleusercontent.com';
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
// Chrome on macOS user-agent. Stripping the Electron/ token reduces the
// chance Google flags this as a webview. This is a known-fragile approach
// (Google may improve their detection over time) — if it stops working
// we can switch to opening the system browser via shell.openExternal.
const FAKE_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function closeOAuthWindow() {
  try { if (oauthWindow && !oauthWindow.isDestroyed()) oauthWindow.close(); } catch(e){}
  oauthWindow = null;
}
function closeOAuthServer() {
  try { if (oauthServer) oauthServer.close(); } catch(e){}
  oauthServer = null;
}

/* Open the consent page in a separate BrowserWindow (per user choice) and
   wait for the loopback server to receive the auth code. Resolves with
   the raw query params (`code` + possibly `error`) from Google's redirect. */
function startGmailOAuthFlow() {
  return new Promise((resolve, reject) => {
    // Tear down any prior attempt
    closeOAuthWindow();
    closeOAuthServer();

    const { verifier, challenge } = pkcePair();
    const state = base64url(crypto.randomBytes(16));
    let redirectUri = null; // populated once we know the port

    // Start a one-shot HTTP server on a random port
    oauthServer = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, 'http://127.0.0.1');
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        // Tiny "all done" page that closes itself
        res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
        res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;background:#000820;color:#92d9ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center"><h2>${error ? 'Sign-in cancelled' : 'Gmail connected!'}</h2><p>You can close this window.</p></div><script>setTimeout(()=>window.close(),1500);</script></body></html>`);

        // Validate state and respond
        setTimeout(() => {
          closeOAuthWindow();
          closeOAuthServer();
          if (error) return reject(new Error('oauth-error: ' + error));
          if (!code) return reject(new Error('oauth-no-code'));
          if (returnedState !== state) return reject(new Error('oauth-state-mismatch'));
          resolve({ code, verifier, redirectUri });
        }, 100);
      } catch(e) {
        res.writeHead(500); res.end('error');
        closeOAuthWindow(); closeOAuthServer();
        reject(e);
      }
    });

    oauthServer.on('error', (e) => {
      closeOAuthWindow(); closeOAuthServer();
      reject(e);
    });

    // Listen on a random free port on 127.0.0.1
    oauthServer.listen(0, '127.0.0.1', () => {
      const port = oauthServer.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
      console.log('R3.39 gmail-oauth loopback listening on', redirectUri);

      // Build Google's authorization URL
      const params = new URLSearchParams({
        client_id: GMAIL_DESKTOP_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: state,
        access_type: 'offline',     // refresh token requested
        prompt: 'consent',          // force consent so we always get refresh_token on first run
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

      // Open consent in a separate BrowserWindow (per user choice)
      const oauthSession = session.fromPartition('persist:gmail-oauth');
      // Strip Electron token from session UA. We do this at session level so
      // ALL requests in this session (including XHR/fetch initiated by Google)
      // use the fake UA, not just the top-level page load.
      try { oauthSession.setUserAgent(FAKE_CHROME_UA); } catch(e){}

      oauthWindow = new BrowserWindow({
        width: 540, height: 720,
        title: 'Sign in with Google',
        backgroundColor: '#ffffff',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:gmail-oauth',
          // Also override at webContents level — some Chromium versions
          // use this instead of the session UA for top-frame navigation
          // headers, depending on initiator
        },
      });
      try { oauthWindow.webContents.setUserAgent(FAKE_CHROME_UA); } catch(e){}

      oauthWindow.on('closed', () => {
        // If user closed the window before completing, reject
        oauthWindow = null;
        if (oauthServer) {
          closeOAuthServer();
          reject(new Error('oauth-cancelled'));
        }
      });

      // Watch for the redirect — Chromium may try to navigate to 127.0.0.1
      // and the loopback server handles it, but in some cases the renderer
      // may show an error before the navigation completes. As a backup we
      // also intercept will-redirect / will-navigate.
      oauthWindow.webContents.on('will-redirect', (event, navUrl) => {
        if (navUrl.startsWith(redirectUri)) {
          // Let it through — the loopback server will handle it.
          // No-op here; the server callback already resolves the promise.
        }
      });

      console.log('R3.39 opening consent URL in BrowserWindow');
      oauthWindow.loadURL(authUrl).catch(e => {
        console.warn('R3.39 oauth window loadURL failed:', e.message);
      });
    });
  });
}

/* Exchange an auth code + verifier for tokens. Returns the parsed JSON
   response from Google ({access_token, refresh_token, expires_in, ...}). */
async function exchangeGmailCode(code, verifier, redirectUri) {
  const body = new URLSearchParams({
    client_id: GMAIL_DESKTOP_CLIENT_ID,
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

// R3.39 — Gmail OAuth IPC. These are invokable (return Promises to the
// renderer) since they need to return token data, not just trigger a side
// effect.
ipcMain.handle('gmail-oauth-start', async () => {
  try {
    const { code, verifier, redirectUri } = await startGmailOAuthFlow();
    console.log('R3.39 got auth code; exchanging for tokens at', redirectUri);
    const tokens = await exchangeGmailCode(code, verifier, redirectUri);
    // Calculate expires_at (ms since epoch) for the renderer to use
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
      // Google may or may not return a new refresh_token on refresh;
      // if absent, the caller keeps using the old one
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
