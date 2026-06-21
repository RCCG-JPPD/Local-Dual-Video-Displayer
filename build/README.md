# Build resources

electron-builder reads packaging resources from this folder (`directories.buildResources` in `package.json`).

## App icon (optional)

The app builds and runs fine **without** a custom icon — electron-builder falls back to the default Electron icon.
To use your own icon, drop these files here:

- `icon.ico` — Windows installer/app icon (256×256 recommended, multi-size `.ico`).
- `icon.icns` — macOS app icon.
- `icon.png` — 512×512, used by Linux and as a source for the others.

electron-builder picks these up automatically by filename; no extra config needed.

## Producing the Windows installer

`robotjs` (the old native dependency) has been removed, so there is **no native compilation** — `npm install`
is clean on any machine.

Run the Windows build **on Windows**:

```
npm install
npm run build:win
```

Output (NSIS installer + portable `.exe`) lands in `dist/`. Cross-building Windows targets from macOS/Linux
requires Wine and is not recommended.
