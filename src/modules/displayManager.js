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
      selector: null,
    };
    this.childWindowIds = new Set(); // Track child window IDs for lifecycle management
  }

  /**
   * Detect all connected displays
   */
  detectDisplays() {
    const displays = screen.getAllDisplays();
    console.log(`Detected ${displays.length} display(s):`);

    displays.forEach((display, index) => {
      console.log(`  Display ${index}: ${display.bounds.width}x${display.bounds.height} @ (${display.bounds.x}, ${display.bounds.y})`);
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

    // Create selector on primary display
    const primaryDisplay = displays[0];

    this.windows.selector = new BrowserWindow({
      x: primaryDisplay.bounds.x + 100,
      y: primaryDisplay.bounds.y + 100,
      width: 900,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload.js'), // Will create this later
      },
      show: true,
    });

    const selectorPath = path.join(__dirname, '../ui/displaySelector.html');
    this.windows.selector.loadFile(selectorPath);

    // Send detected displays to selector UI
    this.windows.selector.webContents.on('did-finish-load', () => {
      this.windows.selector.webContents.send('displays-detected', displays.map((d, i) => ({
        index: i,
        id: d.id,
        label: d.label || `Display ${i + 1}`,
        bounds: d.bounds,
        isPrimary: d.isPrimary,
      })));
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

    const videoOpts = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: false, // Use windowed mode but size to fill display
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: true,
    };

    const window = new BrowserWindow(videoOpts);
    window.loadFile(videoPath);

    // Pass window role via IPC after load
    window.webContents.on('did-finish-load', () => {
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

    const clockOpts = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      fullscreen: false,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload.js'),
      },
      show: true,
    };

    const window = new BrowserWindow(clockOpts);
    window.loadFile(clockPath);

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
    ['public', 'private', 'clock', 'selector'].forEach(role => {
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
    };
  }
}

module.exports = DisplayManager;
