Place your app icons here before building:

- icon.icns  — macOS app icon (1024x1024, .icns format)
- dmg-background.png — DMG window background (540x380px)

To generate icon.icns from a PNG:
  mkdir MyIcon.iconset
  sips -z 1024 1024 youricon.png --out MyIcon.iconset/icon_512x512@2x.png
  iconutil -c icns MyIcon.iconset

If you skip these, electron-builder will use a default Electron icon.
