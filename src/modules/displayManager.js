/**
 * Display Manager
 * Handles multi-display detection, window creation, and display coordination
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');

class DisplayManager {
  constructor(mainProcess) {
    this.main = mainProcess;
    this.windows = {
      controller: null,
      public: null,
      private: null,
      clock: null,
      web: null,
      youtube: null,
      selector: null,
    };
    this.childWindowIds = new Set(); // Track child window IDs for lifecycle management
  }

  /**
   * Detect all connected displays
   * Supports 1-7+ displays dynamically
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
   * Create the display selection window
   * User selects which displays to use for video, private video, clock, etc.
   */
  createSelectorWindow() {
    const displays = this.detectDisplays();

    if (displays.length === 0) {
      throw new Error('No displays detected');
    }

    // Always open selector on the primary display (the one at (0,0) or marked isPrimary)
    const primaryDisplay = displays.find(d => d.isPrimary) || displays.find(d => d.bounds.x === 0 && d.bounds.y === 0) || displays[0];

    this.windows.selector = new BrowserWindow({
      x: Math.floor(primaryDisplay.bounds.x) + 100,
      y: Math.floor(primaryDisplay.bounds.y) + 100,
      width: 900,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: true,
    });

    const selectorPath = path.join(__dirname, '../ui/displaySelector.html');
    this.windows.selector.loadFile(selectorPath);

    // Push display data to selector by calling applyDisplays() directly in the renderer.
    // executeJavaScript bypasses IPC entirely - no timing race possible.
    this.windows.selector.webContents.on('did-finish-load', () => {
      const displaysData = JSON.stringify(displays.map((d, i) => ({
        index: i,
        id: d.id,
        label: d.label || `Display ${i + 1}`,
        bounds: d.bounds,
        isPrimary: d.isPrimary,
      })));
      this.windows.selector.webContents.executeJavaScript(
        `applyDisplays(${displaysData})`
      ).catch(err => console.error('executeJavaScript error:', err));
    });

    return this.windows.selector;
  }

  /**
   * Create video display window (fullscreen)
   */
  createVideoWindow(displayIndex, windowRole = 'public') {
    const displays = this.detectDisplays();

    if (displayIndex >= displays.length) {
      console.warn(`Display index ${displayIndex} not available, using primary`);
      displayIndex = 0;
    }

    const display = displays[displayIndex];
    const videoPath = path.join(__dirname, '../ui/videoDisplay.html');

    console.log(`Creating video window on display ${displayIndex}:`, {
      displayId: display.id,
      bounds: display.bounds,
      isPrimary: display.isPrimary,
    });

    const videoOpts = {
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
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: false, // Don't show immediately - show after positioning
    };

    const window = new BrowserWindow(videoOpts);
    window.loadFile(videoPath);

    // Pass window role via IPC after load
    window.webContents.on('did-finish-load', () => {
      console.log(`Video window loaded on display ${displayIndex}, repositioning and showing`);

      // Force position again after load to ensure correct placement on Windows
      window.setBounds({
        x: Math.floor(display.bounds.x),
        y: Math.floor(display.bounds.y),
        width: Math.floor(display.bounds.width),
        height: Math.floor(display.bounds.height),
      });

      // Show window and enforce always-on-top
      window.show();
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
      window.focus();

      window.webContents.send('window-role', windowRole);
    });

    // If private window, mute audio
    if (windowRole === 'private') {
      window.webContents.setAudioMuted(true);
    }

    // Track as child window
    this.childWindowIds.add(window.webContents.id);

    // Store reference
    if (windowRole === 'public') {
      this.windows.public = window;
    } else if (windowRole === 'private') {
      this.windows.private = window;
    }

    return window;
  }

  /**
   * Create clock display window (fullscreen)
   */
  createClockWindow(displayIndex) {
    const displays = this.detectDisplays();

    if (displayIndex >= displays.length) {
      console.warn(`Display index ${displayIndex} not available, skipping clock`);
      return null;
    }

    const display = displays[displayIndex];
    const clockPath = path.join(__dirname, '../ui/clockDisplay.html');

    console.log(`Creating clock window on display ${displayIndex}:`, {
      displayId: display.id,
      bounds: display.bounds,
    });

    const clockOpts = {
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
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: false, // Don't show immediately
    };

    const window = new BrowserWindow(clockOpts);
    window.loadFile(clockPath);

    // Reposition and show after load
    window.webContents.on('did-finish-load', () => {
      console.log(`Clock window loaded on display ${displayIndex}, repositioning and showing`);

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
    });

    // Track as child window
    this.childWindowIds.add(window.webContents.id);
    this.windows.clock = window;

    return window;
  }

  /**
   * Create controller window (windowed, resizable)
   */
  createControllerWindow(primaryDisplay) {
    const controllerPath = path.join(__dirname, '../ui/controller.html');

    const controllerOpts = {
      x: primaryDisplay.bounds.x + 50,
      y: primaryDisplay.bounds.y + 50,
      width: 1000,
      height: 700,
      alwaysOnTop: true,
      minimizable: true, // Allow minimize (but won't close children)
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: true,
    };

    this.windows.controller = new BrowserWindow(controllerOpts);
    this.windows.controller.loadFile(controllerPath);

    return this.windows.controller;
  }

  /**
   * Close all display windows (called when controller closes)
   */
  closeAllDisplayWindows() {
    ['public', 'private', 'clock', 'selector', 'web', 'youtube'].forEach(role => {
      if (this.windows[role] && !this.windows[role].isDestroyed()) {
        this.windows[role].close();
      }
    });
  }

  /**
   * Check if all required windows and displays are valid
   */
  getWindowStatus() {
    return {
      controller: this.windows.controller && !this.windows.controller.isDestroyed(),
      public: this.windows.public && !this.windows.public.isDestroyed(),
      private: this.windows.private && !this.windows.private.isDestroyed(),
      clock: this.windows.clock && !this.windows.clock.isDestroyed(),
      web: this.windows.web && !this.windows.web.isDestroyed(),
      youtube: this.windows.youtube && !this.windows.youtube.isDestroyed(),
    };
  }

  /**
   * Create web browser window (fullscreen)
   */
  createWebWindow(displayIndex) {
    const displays = this.detectDisplays();

    if (displayIndex >= displays.length) {
      console.warn(`Display index ${displayIndex} not available, skipping web`);
      return null;
    }

    const display = displays[displayIndex];
    const webPath = path.join(__dirname, '../ui/webBrowser.html');

    console.log(`Creating web window on display ${displayIndex}:`, {
      displayId: display.id,
      bounds: display.bounds,
    });

    const webOpts = {
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
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: false, // Don't show immediately
    };

    const window = new BrowserWindow(webOpts);
    window.loadFile(webPath);

    // Reposition and show after load
    window.webContents.on('did-finish-load', () => {
      console.log(`Web window loaded on display ${displayIndex}, repositioning and showing`);

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
    });

    // Track as child window
    this.childWindowIds.add(window.webContents.id);
    this.windows.web = window;

    return window;
  }

  /**
   * Create YouTube player window (fullscreen)
   */
  createYouTubeWindow(displayIndex) {
    const displays = this.detectDisplays();

    if (displayIndex >= displays.length) {
      console.warn(`Display index ${displayIndex} not available, skipping youtube`);
      return null;
    }

    const display = displays[displayIndex];
    const youtubePath = path.join(__dirname, '../ui/youtubePlayer.html');

    console.log(`Creating youtube window on display ${displayIndex}:`, {
      displayId: display.id,
      bounds: display.bounds,
    });

    const youtubeOpts = {
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
        sandbox: false, // Allow YouTube iframe
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: false, // Don't show immediately
    };

    const window = new BrowserWindow(youtubeOpts);
    window.loadFile(youtubePath);

    // Reposition and show after load
    window.webContents.on('did-finish-load', () => {
      console.log(`YouTube window loaded on display ${displayIndex}, repositioning and showing`);

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
    });

    // Track as child window
    this.childWindowIds.add(window.webContents.id);
    this.windows.youtube = window;

    return window;
  }

  /**
   * Create or update all display windows based on config
   */
  createAllDisplayWindows(config) {
    if (!config || !config.displays) {
      console.warn('No display config provided');
      return;
    }

    config.displays.forEach(displayConfig => {
      if (!displayConfig.role || displayConfig.role === 'unassigned') {
        return; // Skip unassigned displays
      }

      try {
        switch (displayConfig.role) {
          case 'public_video':
          case 'public':
            this.createVideoWindow(displayConfig.displayIndex, 'public');
            break;

          case 'private_video':
          case 'private':
            this.createVideoWindow(displayConfig.displayIndex, 'private');
            break;

          case 'clock':
            this.createClockWindow(displayConfig.displayIndex);
            break;

          case 'web':
            this.createWebWindow(displayConfig.displayIndex);
            break;

          case 'youtube':
            this.createYouTubeWindow(displayConfig.displayIndex);
            break;

          default:
            console.warn(`Unknown display role: ${displayConfig.role}`);
        }
      } catch (error) {
        console.error(`Error creating window for display ${displayConfig.displayIndex} (${displayConfig.role}):`, error);
      }
    });
  }
}

module.exports = DisplayManager;
