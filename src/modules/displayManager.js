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
  small: { w: 300, h: 110 },
  medium: { w: 460, h: 150 },
  large: { w: 680, h: 210 },
};
const CLOCK_MARGIN = 24;

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
    const displays = this.detectDisplays();
    const primaryDisplay = displays.find(d => d.isPrimary)
      || displays.find(d => d.bounds.x === 0 && d.bounds.y === 0)
      || displays[0];

    this.windows.selector = new BrowserWindow({
      x: Math.floor(primaryDisplay.bounds.x) + 100,
      y: Math.floor(primaryDisplay.bounds.y) + 100,
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
  _createContentWindow(displayIndex, role, htmlFile, extraWebPreferences = {}, onLoad = null) {
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
        ...extraWebPreferences,
      },
      show: false,
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
      window.show();
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
      window.focus();
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
  createClockWindow(displayIndex, clockSettings = {}) {
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

    const entry = { window, role: 'clock', displayIndex };
    this.contentWindows.push(entry);
    window.on('closed', () => {
      clearInterval(enforce);
      this.contentWindows = this.contentWindows.filter(e => e.window !== window);
    });

    return window;
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

  createWebWindow(displayIndex) {
    // webviewTag lets <webview> embed sites that refuse <iframe> (X-Frame-Options).
    return this._createContentWindow(displayIndex, 'web', 'webBrowser.html', { webviewTag: true });
  }

  createYouTubeWindow(displayIndex) {
    return this._createContentWindow(displayIndex, 'youtube', 'youtubePlayer.html', { sandbox: false });
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
          default:
            console.warn(`Unknown display role: ${role}`);
        }
      } catch (error) {
        console.error(`Error creating window for display ${displayConfig.displayIndex} (${role}):`, error);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // CONTROLLER / HELP
  // ════════════════════════════════════════════════════════════════

  createControllerWindow(primaryDisplay) {
    this.windows.controller = new BrowserWindow({
      x: primaryDisplay.bounds.x + 50,
      y: primaryDisplay.bounds.y + 50,
      width: 1000,
      height: 720,
      alwaysOnTop: false, // Control panel behaves like a normal app window
      minimizable: true,
      title: 'RCCG Display Controller',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
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
    };
    return status;
  }
}

module.exports = DisplayManager;
