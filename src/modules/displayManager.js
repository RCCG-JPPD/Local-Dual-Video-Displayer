/**
 * Display Manager
 * Handles multi-display detection, window creation, and display coordination.
 *
 * Content windows (video / clock / web / youtube) are tracked as a list so the
 * same role can be assigned to several screens at once. The controller and the
 * selector are singletons.
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const PRELOAD = path.join(__dirname, '../../preload.js');
const UI_DIR = path.join(__dirname, '../ui');

// Clock widget window sizes (small floating window, not fullscreen).
const CLOCK_SIZES = {
  tiny: { w: 150, h: 56 },
  verysmall: { w: 220, h: 82 },
  small: { w: 300, h: 110 },
  medium: { w: 460, h: 150 },
  large: { w: 680, h: 210 },
};
const CLOCK_MARGIN = 0; // clock widget sits flush in the corner (no gap)

/** Compute the clock widget's rectangle within a display, for a size + corner. */
function clockRect(bounds, sizeKey, corner) {
  const { w, h } = CLOCK_SIZES[sizeKey] || CLOCK_SIZES.medium;
  const bx = Math.floor(bounds.x), by = Math.floor(bounds.y);
  const bw = Math.floor(bounds.width), bh = Math.floor(bounds.height);
  const c = corner || 'bottom-right';
  let x = bx + Math.floor((bw - w) / 2);
  let y = by + Math.floor((bh - h) / 2);
  if (c.includes('left')) x = bx + CLOCK_MARGIN;
  if (c.includes('right')) x = bx + bw - w - CLOCK_MARGIN;
  if (c.includes('top')) y = by + CLOCK_MARGIN;
  if (c.includes('bottom')) y = by + bh - h - CLOCK_MARGIN;
  return { x, y, w, h };
}

class DisplayManager {
  constructor(mainProcess) {
    this.main = mainProcess;
    this.windows = {
      controller: null,
      selector: null,
      help: null,
    };
    // List of { window, role } for every fullscreen content window.
    this.contentWindows = [];
  }

  /**
   * Detect all connected displays. Supports 1-N displays dynamically.
   */
  detectDisplays() {
    const displays = screen.getAllDisplays();

    if (displays.length === 0) {
      throw new Error('No displays detected - at least 1 display is required');
    }

    console.log(`Detected ${displays.length} display(s):`);
    displays.forEach((display, index) => {
      const primary = display.isPrimary ? ' (Primary)' : '';
      console.log(`  Display ${index}${primary}: ${display.bounds.width}x${display.bounds.height} @ (${display.bounds.x}, ${display.bounds.y})`);
    });

    return displays;
  }

  /**
   * The display the mouse cursor is currently on (so windows open on the screen
   * the user is actually looking at, not always the primary one).
   */
  getCursorDisplay() {
    const point = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(point) || screen.getPrimaryDisplay();
  }

  /** Centered { x, y } for a window of w×h within a display's work area. */
  _centerOn(display, w, h) {
    const b = display.workArea || display.bounds;
    return {
      x: Math.floor(b.x + Math.max(0, (b.width - w) / 2)),
      y: Math.floor(b.y + Math.max(0, (b.height - h) / 2)),
    };
  }

  /**
   * Display metadata sent to renderers (selector / identify).
   */
  getDisplayData() {
    return this.detectDisplays().map((d, i) => ({
      index: i,
      id: d.id,
      label: d.label || `Display ${i + 1}`,
      bounds: d.bounds,
      isPrimary: d.isPrimary,
    }));
  }

  /**
   * Create the display selection window.
   * The page asks for displays over IPC (electronAPI.getDisplays) once it loads —
   * a plain request/response, with no temp file, injection, URL parsing, or race.
   */
  createSelectorWindow() {
    // Open on whatever screen the user is currently on, centered.
    const cursorDisplay = this.getCursorDisplay();
    const pos = this._centerOn(cursorDisplay, 960, 760);

    this.windows.selector = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: 960,
      height: 760,
      title: 'Display Configuration',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // preload requires local modules (src/utils/*) — needs an unsandboxed preload
        preload: PRELOAD,
      },
      show: true,
    });

    this.windows.selector.loadFile(path.join(UI_DIR, 'displaySelector.html'));
    return this.windows.selector;
  }

  // ════════════════════════════════════════════════════════════════
  // CONTENT WINDOWS (video / clock / web / youtube)
  // ════════════════════════════════════════════════════════════════

  /**
   * Shared fullscreen content-window factory: positions a frameless,
   * always-on-top window on the given display, shows it after load, and
   * tracks it under `role`.
   */
  _createContentWindow(displayIndex, role, htmlFile, extraWebPreferences = {}, onLoad = null, windowOpts = {}) {
    // `focusOnShow` is ours, not Electron's — pull it out so it never reaches
    // the BrowserWindow constructor as an unknown option.
    const { focusOnShow = true, ...browserWindowOpts } = windowOpts;
    const displays = this.detectDisplays();

    if (displayIndex == null || displayIndex < 0 || displayIndex >= displays.length) {
      console.warn(`Display index ${displayIndex} not available for role '${role}', skipping`);
      return null;
    }

    const display = displays[displayIndex];
    console.log(`Creating ${role} window on display ${displayIndex}:`, {
      displayId: display.id,
      bounds: display.bounds,
    });

    const window = new BrowserWindow({
      x: Math.floor(display.bounds.x),
      y: Math.floor(display.bounds.y),
      width: Math.floor(display.bounds.width),
      height: Math.floor(display.bounds.height),
      fullscreen: false,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // unsandboxed preload so it can require src/utils/* and Node builtins
        preload: PRELOAD,
        // A content screen is NEVER the focused window — the operator is always
        // in the controller. Chromium's default is to throttle a renderer it
        // considers backgrounded, and on Windows a frameless always-on-top
        // window on a second monitor can also be reported as occluded, which
        // starves the video screen of the timers and frames it needs. These
        // windows are the output; they are never really in the background.
        backgroundThrottling: false,
        ...extraWebPreferences,
      },
      show: false,
      // Roles that need a different kind of window (the camera screen is
      // transparent so it can fade away and reveal the app behind it).
      // `transparent` in particular CANNOT be toggled after creation.
      ...browserWindowOpts,
    });

    window.loadFile(path.join(UI_DIR, htmlFile));

    window.webContents.on('did-finish-load', () => {
      // Re-assert bounds after load (Windows multi-monitor can shift them).
      window.setBounds({
        x: Math.floor(display.bounds.x),
        y: Math.floor(display.bounds.y),
        width: Math.floor(display.bounds.width),
        height: Math.floor(display.bounds.height),
      });
      // An overlay screen must not pull focus away from the app underneath it —
      // at a concert that would yank the operator out of their lyrics software
      // every time the screen reloads.
      if (focusOnShow) {
        window.show();
      } else {
        window.showInactive();
      }
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
      if (focusOnShow) window.focus();
      if (onLoad) onLoad(window);
    });

    const entry = { window, role, displayIndex };
    this.contentWindows.push(entry);
    window.on('closed', () => {
      this.contentWindows = this.contentWindows.filter(e => e.window !== window);
    });

    return window;
  }

  /**
   * Create a local-video window. The first video screen carries audio; any
   * additional video screens are muted to avoid echo on the single audio device.
   */
  createVideoWindow(displayIndex, hasAudio = true) {
    return this._createContentWindow(displayIndex, 'video', 'videoDisplay.html', {}, (window) => {
      window.webContents.setAudioMuted(!hasAudio);
      window.webContents.send('window-role', 'video');
    });
  }

  /**
   * Create the clock as a SMALL floating widget in a corner of its display
   * (not a fullscreen window). Size + corner come from the clock settings.
   */
  createClockWindow(displayIndex, clockSettings = {}, opts = {}) {
    const displays = this.detectDisplays();
    if (displayIndex == null || displayIndex < 0 || displayIndex >= displays.length) {
      console.warn(`Display index ${displayIndex} not available for clock, skipping`);
      return null;
    }

    const display = displays[displayIndex];
    const r = clockRect(display.bounds, clockSettings.size, clockSettings.corner);
    console.log(`Creating clock widget on display ${displayIndex}:`, r);

    const window = new BrowserWindow({
      x: r.x, y: r.y, width: r.w, height: r.h,
      frame: false,
      resizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Transparent so the 'glass-*' clock themes float over the screen behind
      // them. Solid themes paint an opaque CSS background, so they're unaffected.
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: PRELOAD,
      },
      show: true,
    });

    window.setAlwaysOnTop(true, 'screen-saver');
    window.loadFile(path.join(UI_DIR, 'clockDisplay.html'));

    // Keep it pinned above other always-on-top windows (mirrors the old clock).
    const enforce = setInterval(() => {
      if (window.isDestroyed()) { clearInterval(enforce); return; }
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
    }, 1000);

    const entry = { window, role: 'clock', displayIndex, overlay: !!opts.overlay };
    this.contentWindows.push(entry);
    window.on('closed', () => {
      clearInterval(enforce);
      this.contentWindows = this.contentWindows.filter(e => e.window !== window);
    });

    return window;
  }

  /**
   * Turn a clock overlay on/off for a single display, live (no reconfigure).
   * The overlay is the same small widget as the clock role, but it coexists with
   * whatever content that screen is already showing.
   */
  setClockOverlay(displayIndex, on, clockSettings = {}) {
    const existing = this.contentWindows.find(
      e => e.role === 'clock' && e.overlay && e.displayIndex === displayIndex
         && e.window && !e.window.isDestroyed());

    if (on) {
      if (existing) return existing.window; // already on
      return this.createClockWindow(displayIndex, clockSettings, { overlay: true });
    }

    if (existing) existing.window.close();
    return null;
  }

  /**
   * Resize/reposition every clock widget when its size or corner changes.
   */
  applyClockWindowLayout(clockSettings = {}) {
    const displays = this.detectDisplays();
    this.contentWindows
      .filter(e => e.role === 'clock' && e.window && !e.window.isDestroyed())
      .forEach(e => {
        const d = displays[e.displayIndex];
        if (!d) return;
        const r = clockRect(d.bounds, clockSettings.size, clockSettings.corner);
        e.window.setBounds({ x: r.x, y: r.y, width: r.w, height: r.h });
      });
  }

  /**
   * Camera screen — a live webcam / capture-card feed with lyric captions and
   * a logo composited over it.
   *
   * Unlike every other content screen this window is TRANSPARENT and
   * click-through, because its "reset" is to fade to nothing and let whatever
   * is running behind it (the lyrics software) show through. Electron cannot
   * turn transparency on or off after creation, so the flag is read from config
   * here and changing it requires recreateCameraWindows().
   */
  createCameraWindow(displayIndex, cameraSettings = {}) {
    const transparent = cameraSettings.transparentWindow !== false;
    const windowOpts = {
      focusOnShow: false, // never steal focus from the app underneath
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: false, // macOS would otherwise round a fullscreen overlay
      ...(transparent ? { transparent: true, backgroundColor: '#00000000' } : {}),
    };

    return this._createContentWindow(displayIndex, 'camera', 'cameraDisplay.html', {}, (window) => {
      // Decoration, not a target: clicks must reach the app behind the screen.
      window.setIgnoreMouseEvents(true, { forward: false });
      // Without this the overlay never covers a fullscreen app on a macOS Space.
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

      // KEEP IT ON TOP, the way the clock overlay does.
      //
      // _createContentWindow pins this once, at load. That is not enough for a
      // window whose whole job is to sit over somebody else's application: the
      // lyrics software raises its own output window whenever the operator
      // changes song, and Windows puts it above an always-on-top window that
      // has not re-asserted itself. From then on the camera is behind it —
      // still running, still "visible" as far as every bit of state here is
      // concerned, and completely invisible to the audience. Nothing reports
      // it, and no amount of pressing the on-air button brings it back,
      // because the button was never the problem.
      //
      // The clock overlay has always re-asserted this every second, which is
      // why it never suffered from this. Same treatment.
      const enforce = setInterval(() => {
        if (window.isDestroyed()) { clearInterval(enforce); return; }
        window.setAlwaysOnTop(true, 'screen-saver');
        window.moveTop();
        // A clock overlay on this same screen re-asserts itself on its own
        // 1s timer, so without this the two would trade places every second
        // and the clock would flicker behind an opaque camera picture. The
        // clock belongs on top of the camera, so put it back immediately.
        this.contentWindows
          .filter(e => e.role === 'clock' && e.overlay && e.displayIndex === displayIndex)
          .forEach((e) => {
            if (e.window && !e.window.isDestroyed()) e.window.moveTop();
          });
      }, 1000);
      window.on('closed', () => clearInterval(enforce));

      window.webContents.send('window-role', 'camera');
    }, windowOpts);
  }

  /**
   * Close and rebuild every camera screen from the current config.
   *
   * This exists for one reason: `transparent` is fixed at window creation, so
   * the only way to honour a change to it is to make a new window.
   */
  recreateCameraWindows(config = {}) {
    const targets = [...new Set(this.contentWindows
      .filter(e => e.role === 'camera' && e.window && !e.window.isDestroyed())
      .map(e => e.displayIndex))];

    this.contentWindows
      .filter(e => e.role === 'camera' && e.window && !e.window.isDestroyed())
      .forEach(e => e.window.close());

    return targets.map(displayIndex => this.createCameraWindow(displayIndex, config.camera || {}));
  }

  createWebWindow(displayIndex) {
    // webviewTag lets <webview> embed sites that refuse <iframe> (X-Frame-Options).
    return this._createContentWindow(displayIndex, 'web', 'webBrowser.html', { webviewTag: true });
  }

  createYouTubeWindow(displayIndex) {
    // webviewTag lets the player navigate a real youtube.com context (avoids the
    // file:// embed "Error 153") and lets us script play/pause/volume.
    return this._createContentWindow(displayIndex, 'youtube', 'youtubePlayer.html', { sandbox: false, webviewTag: true });
  }

  /** Presentation viewer — renders PDF pages (pdf.js) or slide images fullscreen. */
  createPresentationWindow(displayIndex) {
    return this._createContentWindow(displayIndex, 'powerpoint', 'presentationDisplay.html', {}, (window) => {
      window.webContents.send('window-role', 'powerpoint');
    });
  }

  /** Media slideshow — images + videos shown in sequence. First screen carries audio. */
  createSlideshowWindow(displayIndex, hasAudio = true) {
    return this._createContentWindow(displayIndex, 'slideshow', 'slideshowDisplay.html', {}, (window) => {
      window.webContents.setAudioMuted(!hasAudio);
      window.webContents.send('window-role', 'slideshow');
    });
  }

  /** Spreadsheet viewer — renders a sheet (parsed in main with SheetJS) as a table. */
  createExcelWindow(displayIndex) {
    return this._createContentWindow(displayIndex, 'excel', 'excelDisplay.html', {}, (window) => {
      window.webContents.send('window-role', 'excel');
    });
  }

  /**
   * Create or update all content windows based on config.
   */
  createAllDisplayWindows(config) {
    if (!config || !config.displays) {
      console.warn('No display config provided');
      return;
    }

    let videoAudioAssigned = false;
    let slideshowAudioAssigned = false;

    config.displays.forEach(displayConfig => {
      const role = displayConfig.role;
      if (!role || role === 'unassigned' || role === 'controller') return;

      try {
        switch (role) {
          case 'video':
          // Back-compat with old configs:
          case 'public':
          case 'private': {
            const hasAudio = !videoAudioAssigned;
            videoAudioAssigned = true;
            this.createVideoWindow(displayConfig.displayIndex, hasAudio);
            break;
          }
          case 'clock':
            this.createClockWindow(displayConfig.displayIndex, config.clock || {});
            break;
          case 'web':
            this.createWebWindow(displayConfig.displayIndex);
            break;
          case 'youtube':
            this.createYouTubeWindow(displayConfig.displayIndex);
            break;
          case 'powerpoint':
            this.createPresentationWindow(displayConfig.displayIndex);
            break;
          case 'slideshow': {
            const hasAudio = !slideshowAudioAssigned;
            slideshowAudioAssigned = true;
            this.createSlideshowWindow(displayConfig.displayIndex, hasAudio);
            break;
          }
          case 'excel':
            this.createExcelWindow(displayConfig.displayIndex);
            break;
          case 'camera':
            this.createCameraWindow(displayConfig.displayIndex, config.camera || {});
            break;
          default:
            console.warn(`Unknown display role: ${role}`);
        }

        // A clock overlay can sit on top of any content screen (except a
        // dedicated clock screen, which already shows the clock).
        if (displayConfig.clockOverlay && role !== 'clock') {
          this.createClockWindow(displayConfig.displayIndex, config.clock || {}, { overlay: true });
        }
      } catch (error) {
        console.error(`Error creating window for display ${displayConfig.displayIndex} (${role}):`, error);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // CONTROLLER / HELP
  // ════════════════════════════════════════════════════════════════

  createControllerWindow(targetDisplay) {
    // Center the controller on the screen the user launched it from.
    const display = targetDisplay || this.getCursorDisplay();
    const pos = this._centerOn(display, 1000, 720);

    this.windows.controller = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: 1000,
      height: 720,
      alwaysOnTop: false, // Control panel behaves like a normal app window
      minimizable: true,
      title: 'RCCG Display Controller',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webviewTag: true, // the controller embeds a <webview> browser for the Web Page feature
        preload: PRELOAD,
      },
      show: true,
    });

    this.windows.controller.loadFile(path.join(UI_DIR, 'controller.html'));
    return this.windows.controller;
  }

  /**
   * Open (or focus) the Help / tutorial window.
   */
  createHelpWindow() {
    if (this.windows.help && !this.windows.help.isDestroyed()) {
      this.windows.help.focus();
      return this.windows.help;
    }

    this.windows.help = new BrowserWindow({
      width: 820,
      height: 760,
      title: 'Help & Tutorial',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: PRELOAD,
      },
    });

    this.windows.help.loadFile(path.join(UI_DIR, 'help.html'));
    this.windows.help.on('closed', () => { this.windows.help = null; });
    return this.windows.help;
  }

  // ════════════════════════════════════════════════════════════════
  // IDENTIFY SCREENS
  // ════════════════════════════════════════════════════════════════

  /**
   * Briefly flash a big "Screen N" badge full-screen on every display so the
   * user can tell which physical screen is which. Auto-closes after `durationMs`.
   */
  identifyScreens(durationMs = 4000) {
    const displays = this.detectDisplays();

    displays.forEach((display, index) => {
      const primary = display.isPrimary ? ' · Primary' : '';
      const badge = new BrowserWindow({
        x: Math.floor(display.bounds.x),
        y: Math.floor(display.bounds.y),
        width: Math.floor(display.bounds.width),
        height: Math.floor(display.bounds.height),
        frame: false,
        transparent: false,
        backgroundColor: '#101830',
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        show: false,
      });

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:#101830;color:#fff;
          font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;
          justify-content:center;flex-direction:column;overflow:hidden}
        .n{font-size:min(40vh,40vw);font-weight:800;line-height:1}
        .sub{font-size:5vh;color:#9fb4ff;margin-top:2vh}
      </style></head><body>
        <div class="n">${index + 1}</div>
        <div class="sub">Screen ${index + 1}${primary} — ${display.bounds.width}×${display.bounds.height}</div>
      </body></html>`;

      badge.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      badge.once('ready-to-show', () => {
        badge.setBounds({
          x: Math.floor(display.bounds.x),
          y: Math.floor(display.bounds.y),
          width: Math.floor(display.bounds.width),
          height: Math.floor(display.bounds.height),
        });
        badge.showInactive();
        badge.setAlwaysOnTop(true, 'screen-saver');
      });

      setTimeout(() => {
        if (!badge.isDestroyed()) badge.close();
      }, durationMs);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // QUERIES / LIFECYCLE
  // ════════════════════════════════════════════════════════════════

  /**
   * Return the live BrowserWindows currently serving a given role.
   */
  getWindowsByRole(role) {
    return this.contentWindows
      .filter(e => e.role === role && e.window && !e.window.isDestroyed())
      .map(e => e.window);
  }

  /**
   * Close all content windows (and the selector). Leaves the controller alone —
   * closing the controller quits the app (see WindowLifecycleManager).
   */
  closeAllDisplayWindows() {
    this.contentWindows.forEach(({ window }) => {
      if (window && !window.isDestroyed()) window.close();
    });
    this.contentWindows = [];

    if (this.windows.selector && !this.windows.selector.isDestroyed()) {
      this.windows.selector.close();
    }
  }

  /**
   * Count of live windows per role, for the controller status line.
   */
  getWindowStatus() {
    const status = {
      controller: !!(this.windows.controller && !this.windows.controller.isDestroyed()),
      video: this.getWindowsByRole('video').length,
      clock: this.getWindowsByRole('clock').length,
      web: this.getWindowsByRole('web').length,
      youtube: this.getWindowsByRole('youtube').length,
      powerpoint: this.getWindowsByRole('powerpoint').length,
      slideshow: this.getWindowsByRole('slideshow').length,
      excel: this.getWindowsByRole('excel').length,
      camera: this.getWindowsByRole('camera').length,
    };
    return status;
  }
}

module.exports = DisplayManager;
