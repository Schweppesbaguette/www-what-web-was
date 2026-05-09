# WWW — What Web Was
## Build a macOS DMG

### Requirements
- macOS (Intel or Apple Silicon)
- Node.js 18+ (`node --version`)
- npm 9+

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Run in development (test it first)
npm start

# 3. Build the DMG
npm run dist
```

The DMG will appear in the `dist/` folder as:
- `WWW - What Web Was-1.0.0-arm64.dmg` (Apple Silicon)
- `WWW - What Web Was-1.0.0.dmg` (Intel)

### What's fixed vs the HTML version
- **Video call**: Uses proper MediaStream track-based WebRTC + TURN relay servers
- **Radio**: Real internet radio streams play directly in the app (1991–2008)
- **TV**: Embeds myretrotvs.com directly via Electron webview (no new tab)
- **Modern web**: All websites load natively inside the app via webview
- **Wayback mode**: Still works as before via iframe

### Troubleshooting
- If camera/mic don't work, check System Preferences → Security & Privacy → Camera/Microphone → allow WWW
- If radio streams fail, they fall back to a Radiooooo.com link
- For video call issues, both users need the app and be on the same Ably API key
