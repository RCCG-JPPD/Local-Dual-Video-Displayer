# RCCG Display Controller

A cross-platform (Windows-first) **multi-display controller** built on Electron. You open one app, pick what each
of your screens should show, and drive them all from a single control panel.

Each connected screen can be assigned a role — and the **same role can go on several screens** to mirror content:

- **Video** — a local video, fullscreen. Put it on as many screens as you like; the first carries audio (master
  volume from the controller) and the rest are muted to avoid echo.
- **Presentation** — a PowerPoint (`.pptx`/`.ppt`/`.odp`), PDF, or a set of slide images, fullscreen.
  **PowerPoint decks keep their animations and slide transitions**: "Next" plays the next animation step first —
  exactly like PowerPoint — then advances with the slide's own transition. Needs a free
  [LibreOffice](https://www.libreoffice.org) install (used for conversion + its animated presentation engine);
  without it, export the deck to PDF and slides show statically.
- **Camera** — a live webcam or capture-card feed, fullscreen, for showing the room, the crowd or the musicians.
  Can read the **song lyrics off another screen** (your lyrics software) and re-draw them as **captions** over the
  feed in your own font, position and animation, with an optional **logo** in a corner. Its screen is
  **see-through**, so one **RESET** press fades it away and reveals whatever app is running behind it.
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
3. **Assign roles.** Click a role under each screen: **Video**, **Camera**, **YouTube**, **Web Page**,
   **Presentation**, **Slideshow**, **Spreadsheet** or **Clock**. Leave the screen you're operating from as
   **Unassigned**. You can give the same role to several screens to mirror it.
4. Click **Confirm & Continue**. The control panel opens on your main screen.
5. **Local video:** in *Local Video*, click **+ Add Video…**, then use Play/Pause, Next/Previous, the scrub bar, and
   **Master Volume**. It plays on every Video screen.
6. **YouTube:** paste a link in the *YouTube* box and press Enter — it plays on every YouTube screen.
7. **Web page:** type an address in the *Web Page* box and press Enter — it loads on every Web screen.
8. **Camera + live lyrics:** open the **📷 Camera** tab, pick your camera and press the big **ON AIR** button.
   To caption lyrics from another screen, see [Camera & live lyrics](#camera--live-lyrics) below.
9. **Remote control (phone):** open the **📱 Remote** tab, click **📡 Enable Remote Mode**, then scan the QR code
   with your phone (or enter the 6-character code at [multi-displayer.web.app](https://multi-displayer.web.app)) —
   see [Remote Control](#remote-control-phone--web) below.
10. **Change setup:** click **Reconfigure Displays** any time. Press **Esc** on a fullscreen screen to close just that
   one. Closing the control panel quits everything.

The same tutorial is available in-app via the **❓ Help** button (on both the selector and the control panel).

---

## Camera & live lyrics

The **Camera** role puts a live webcam or capture-card feed on a screen — the crowd, the band, a roving camera —
and can caption song lyrics over it by **reading them off another screen**. That means it works with lyrics
software you already run, without that software needing to cooperate.

**Setting it up**

1. Give a screen the **Camera** role, then open the **📷 Camera** tab and choose your camera.
2. Press the big **ON AIR** button. **🚨 RESET** clears the screen again — see below.
3. Under **Lyrics**, pick the screen your lyrics software is on and press **📸 Grab a picture of that screen**,
   then **drag a box** around where the words appear.
4. Leave **Send lyrics to the screen** switched **off** while you aim the box. Watch the **Last read** panel until
   it reads the words cleanly, then switch it on and press **Start reading lyrics**.
5. Set the look under **Caption style** — a 9-point position grid, size, colour, backing, and how each line enters
   (fade, slide, zoom, cross-fade, typewriter or none). The preview box matches what the audience sees.

**Things worth knowing**

- **RESET fades the screen to fully see-through**, revealing whatever app is behind it — not to black.
  <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>0</kbd> does the same from anywhere, even when the control panel is not
  the focused window. (**Blackout**, separately, covers the screen in black.)
- **Your lyrics software must run windowed or borderless-fullscreen**, not true (exclusive) fullscreen — a
  true-fullscreen app takes over the display and nothing can be drawn on top of it.
- Lyrics arrive roughly **1–2 seconds behind** the other screen; that is the cost of reading them off a picture.
  Shrink the box to just the words and lower **Confirm reads** to 1 once it is aimed well.
- Reading lyrics works **with no internet** — the language data ships inside the app.
- The camera **never captures audio**, so it cannot cause feedback.
- If the feed shows as **black** on the big screen, tick **Compatibility renderer**. If **RESET shows black**
  instead of the app behind it, check **See-through screen** is on and press **Restart camera screen**.
- On macOS, allow **Camera** and **Screen Recording** for the app in System Settings → Privacy & Security.
  Windows needs neither.

---

## Remote Control (phone / web)

<img src="docs/remote-qr.png" width="150" align="right" alt="QR code linking to multi-displayer.web.app">

Remote Mode lets a phone (or any browser) drive **slides**, the **slideshow**, **video playback** and the
**camera screen** (on air / clear the screen / lyrics on and off) over the internet — nothing to install on the
phone:

1. In the control panel, open the **📱 Remote** tab and click **📡 Enable Remote Mode**.
2. Scan the **QR code shown in the Remote tab** with the phone's camera — it opens the remote controller with the
   session code already filled in, so the phone joins instantly. (Or scan the QR on the right / open
   **<https://multi-displayer.web.app>** and type the 6-character **session code** shown on screen.)
3. When the phone joins, the panel shows **✓ 1 device connected**. Multiple devices can share one code.

The phone is a **full remote** for every screen role, and only shows sections that have a screen assigned:

| Section | Controls from the phone |
| --- | --- |
| **Slides** | previous / next / blank, jump to any slide number |
| **Slideshow** | previous / next, play-pause |
| **Video** | pick any playlist entry, play-pause, **seek**, **volume**, stop |
| **YouTube** | send a link, play / pause / mute, volume |
| **Web Page** | open an address, back / forward / reload |
| **Spreadsheet** | switch sheets |

It also shows live status — the current slide number, video title and playback time.

**The code is per app run:** it's generated once when first needed and stays the same until you quit the app —
changing displays or toggling Remote Mode off/on keeps paired phones working, and they reconnect automatically.
Restarting the app issues a fresh code. Anyone with the code can control the presentation while Remote Mode is on,
so keep it private and turn Remote Mode off when you're done (the session is deleted automatically when the app
closes). The web controller lives in [remote_mode/remote-controller](remote_mode/remote-controller) and syncs through
Firebase (anonymous auth + Realtime Database, locked down by [database rules](remote_mode/remote-controller/database.rules.json)).

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
├── main.js                 # Main process: app lifecycle, startup, single-instance, shortcuts
├── modules/
│   ├── displayManager.js   # Detect displays; create selector / controller / content windows
│   ├── configManager.js    # Load/save config (Electron userData)
│   ├── ipcHandler.js       # All IPC routing between controller and content windows
│   ├── ocrEngine.js        # Reads lyrics off a screen (desktopCapturer + Tesseract)
│   ├── officeConvert.js    # LibreOffice conversion for PowerPoint decks
│   └── windowLifecycle.js  # Parent/child window lifecycle (closing controller quits the app)
├── utils/                  # Pure, DOM-free helpers — the unit-tested core
│   ├── config.js           # Default config schema
│   ├── captions.js         # Caption placement, styling and animation; anti-flicker guard
│   ├── ocr.js              # Screen-region maths, text cleanup, OCR stabilizer
│   ├── logo.js             # Logo overlay placement
│   ├── transition.js       # Fade timing for the camera stage
│   ├── zoom.js             # How media is scaled onto a screen
│   ├── slideshow.js  youtube.js  weburl.js  remote.js
│   └── clockformat.js  clockThemes.js  holidays.js
├── ui/                     # One HTML file per window
│   ├── displaySelector.html   # First-run screen role picker
│   ├── controller.html        # Control panel
│   ├── help.html              # In-app tutorial
│   ├── videoDisplay.html      # Local video window
│   ├── cameraDisplay.html     # Camera window (transparent; captions + logo)
│   ├── youtubePlayer.html     # YouTube window
│   ├── webBrowser.html        # Web page window (<webview>)
│   ├── presentationDisplay.html  slideshowDisplay.html
│   └── excelDisplay.html      clockDisplay.html
└── vendor/                 # Bundled libraries and data (no CDN at runtime)
    ├── pdfjs/  firebase/  qrcode/
    └── tessdata/           # English OCR model, so lyrics work offline
preload.js                  # Secure contextBridge IPC API exposed to the renderers
scripts/                    # Dev tools (not shipped)
test/                       # Unit tests for src/utils  (npm test)
test-e2e/                   # Pixel-level Electron tests  (npm run test:e2e)
```

## How it works

1. **Startup** ([src/main.js](src/main.js)) loads saved config. If none is valid, it shows the **display selector**.
2. The selector assigns a **role** to each screen and saves it via `ConfigManager`.
3. `DisplayManager.createAllDisplayWindows()` opens one fullscreen window per assigned role, plus the controller.
4. The **controller** sends commands over IPC (via `preload.js`'s `electronAPI`) to the content windows. It never
   talks to a screen directly: everything fans out through the main process, so a role assigned to several screens
   stays in step.
5. The controller's **preview thumbnails** come from Electron's `desktopCapturer`, which grabs each physical
   screen — the content windows do no work for them.
6. **Lyric OCR** runs in the main process, not in a window: it crops the chosen screen region there, so only a
   small image reaches Tesseract, and recognition cannot stutter the camera screen.

Config and cache live in Electron's standard per-user location (`app.getPath('userData')`), so it works the same in
development and in an installed build.

## Notes & limitations

- **Web Page** uses a Chromium `<webview>`, which loads sites that block plain `<iframe>` embedding. Some sites with
  strict policies may still refuse to load.
- **YouTube** uses the standard embed player; videos that disable embedding won't play.
- **Camera lyrics** are read optically from another screen, so they lag it by about **1–2 seconds** and can
  occasionally misread a word. The lyrics software must not be in exclusive fullscreen, or nothing can be drawn
  over it. English only.
- **The camera screen is a transparent window.** Electron fixes transparency when a window is created, so the
  **See-through screen** setting only takes effect after **Restart camera screen**. On some GPUs a hardware-
  accelerated video surface composites as black inside a transparent window — the **Compatibility renderer**
  checkbox draws through a canvas instead.
- **Presentation animations** are played by LibreOffice's presentation engine (animated SVG export), so fidelity
  matches what LibreOffice Impress shows for the deck — the vast majority of PowerPoint transitions and entrance
  effects work; a few exotic effects may render simplified. Without LibreOffice, decks fall back to static PDF pages.

## License

MIT — see [LICENSE](LICENSE).