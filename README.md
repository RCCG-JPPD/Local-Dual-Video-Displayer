# RCCG Display Controller

A cross-platform (Windows-first) **multi-display controller** built on Electron. You open one app, pick what each
of your screens should show, and drive them all from a single control panel.

Each connected screen can be assigned a role:

- **Video (Public)** — a local video, fullscreen, with audio.
- **Video (Private)** — the same local video, fullscreen, muted (confidence/operator monitor). Public + private are
  controlled together from the controller (load / play / pause / seek / volume).
- **YouTube** — plays a YouTube link fullscreen.
- **Web Page** — shows any website fullscreen (rendered in a real embedded Chromium view).
- **Clock** — a fullscreen clock.

The control panel shows **live preview thumbnails** of every active screen.

---

## Quick start

Requirements: **Node.js & npm**. No native build tools needed — the app has no native dependencies.

```bash
npm install
npm start
```

On first launch you'll see the **display selector**: choose a role for each screen and click **Confirm & Continue**.
The control panel opens on your main screen, and the assigned content windows open on the screens you picked.
Your choice is remembered; use **Reconfigure Displays** in the controller to change it.

Press **Esc** on any fullscreen content window to close just that window (handy when testing on a single screen).

---

## Building a Windows installer

```bash
npm run build:win    # run this ON Windows
```

This produces an NSIS installer and a portable `.exe` in `dist/`. (Cross-building from macOS/Linux needs Wine and
isn't recommended.) An optional custom app icon can be added — see [build/README.md](build/README.md).

Other build scripts: `npm run build:mac`, `npm run build` (current platform), `npm run build:all`.

---

## Project structure

```
src/
├── main.js                 # Main process: app lifecycle, startup, single-instance
├── modules/
│   ├── displayManager.js   # Detect displays; create selector / controller / content windows
│   ├── configManager.js    # Load/save config (Electron userData)
│   ├── ipcHandler.js        # All IPC routing between controller and content windows
│   └── windowLifecycle.js  # Parent/child window lifecycle (closing controller quits the app)
├── utils/
│   └── config.js           # Default config schema
└── ui/
    ├── displaySelector.html # First-run screen role picker
    ├── controller.html      # Control panel (previews, local video, YouTube, web, displays)
    ├── videoDisplay.html    # Local video window (public/private)
    ├── youtubePlayer.html   # YouTube window
    ├── webBrowser.html      # Web page window (<webview>)
    └── clockDisplay.html    # Clock window
preload.js                  # Secure contextBridge IPC API exposed to the renderers
```

## How it works

1. **Startup** ([src/main.js](src/main.js)) loads saved config. If none is valid, it shows the **display selector**.
2. The selector assigns a **role** to each screen and saves it via `ConfigManager`.
3. `DisplayManager.createAllDisplayWindows()` opens one fullscreen window per assigned role, plus the controller.
4. The **controller** sends commands over IPC (via `preload.js`'s `electronAPI`) to the content windows, and each
   content window streams a small JPEG **preview** back to the controller.

Config and cache live in Electron's standard per-user location (`app.getPath('userData')`), so it works the same in
development and in an installed build.

## Notes & limitations

- **Web Page** uses a Chromium `<webview>`, which loads sites that block plain `<iframe>` embedding. Some sites with
  strict policies may still refuse to load.
- **YouTube** uses the standard embed player; videos that disable embedding won't play.

## License

MIT — see [LICENSE](LICENSE).
