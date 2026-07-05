# RCCG Display Controller

A cross-platform (Windows-first) **multi-display controller** built on Electron. You open one app, pick what each
of your screens should show, and drive them all from a single control panel.

Each connected screen can be assigned a role — and the **same role can go on several screens** to mirror content:

- **Video** — a local video, fullscreen. Put it on as many screens as you like; the first carries audio (master
  volume from the controller) and the rest are muted to avoid echo.
- **YouTube** — plays a YouTube link fullscreen.
- **Web Page** — shows any website fullscreen (rendered in a real embedded Chromium view).
- **Clock** — a clock on a solid light/dark background, shown in a chosen **corner** at **tiny/very small/small/medium/large** size.
  Supports **current time**, a **countdown** (H:M:S), and a **countdown to a date/time**, with optional seconds and
  12/24-hour format. Includes **holiday animations** (fireworks for New Year, snow for Christmas/Advent, petals for
  Easter, etc.) that appear **automatically around each date**, or can be forced/disabled from the controller.

The control panel shows **live preview thumbnails** of every active screen. When picking screens, the selector shows a
**live thumbnail of each physical screen's current contents** so you can tell which is which (plus a **🔦 Identify
screens** button that flashes a big number on each), and **❓ Help** opens the in-app tutorial.

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

## Tutorial

1. **Launch** with `npm start` (or the installed app).
2. On the **Display Configuration** screen, click **🔦 Identify screens** if you're unsure which screen is which —
   each screen briefly shows its number.
3. **Assign roles.** Click a role under each screen: **Video**, **YouTube**, **Web Page**, or **Clock**. Leave the
   screen you're operating from as **Unassigned**. You can give **Video** to several screens to mirror it.
4. Click **Confirm & Continue**. The control panel opens on your main screen.
5. **Local video:** in *Local Video*, click **+ Add Video…**, then use Play/Pause, Next/Previous, the scrub bar, and
   **Master Volume**. It plays on every Video screen.
6. **YouTube:** paste a link in the *YouTube* box and press Enter — it plays on every YouTube screen.
7. **Web page:** type an address in the *Web Page* box and press Enter — it loads on every Web screen.
8. **Change setup:** click **Reconfigure Displays** any time. Press **Esc** on a fullscreen screen to close just that
   one. Closing the control panel quits everything.

The same tutorial is available in-app via the **❓ Help** button (on both the selector and the control panel).

---

## Downloads

Pre-built installers for **Windows** and **macOS** are published on the
[Releases page](https://github.com/RCCG-JPPD/Local-Dual-Video-Displayer/releases) — just download and run:

- **Windows:** the NSIS `Setup .exe` installer (or the standalone portable `.exe`).
- **macOS:** the `.dmg` — `arm64` for Apple Silicon (M-series) Macs, `x64` for Intel Macs.

The macOS app is currently **unsigned/un-notarized**, so on first launch Gatekeeper will block it. Open it via
**right-click → Open** (or *System Settings → Privacy & Security → Open Anyway*) to run it.

These artifacts are built automatically by the [Release workflow](.github/workflows/release.yml): every push to `main`
bumps the version and runs `electron-builder` on a Windows runner *and* a macOS runner. Once **both** builds succeed,
the workflow publishes the GitHub Release automatically, so the installers become public downloads with no manual step.

## Building installers locally

```bash
npm run build:win    # run this ON Windows  → NSIS installer + portable .exe in dist/
npm run build:mac    # run this ON macOS    → .dmg (arm64 + x64) + .zip in dist/
```

Build each on its own OS (cross-building a macOS `.dmg` from Windows/Linux isn't supported; cross-building Windows
from macOS/Linux needs Wine and isn't recommended). Other scripts: `npm run build` (current platform),
`npm run build:all`. An optional custom app icon can be added — see [build/README.md](build/README.md).

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


Hosting URL: https://multi-displayer.web.app