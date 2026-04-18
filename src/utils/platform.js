/**
 * Platform Utilities
 * Cross-platform compatibility helpers for Windows and macOS
 */

const { BrowserWindow } = require('electron');

class PlatformManager {
  constructor() {
    this.platform = process.platform; // 'darwin' (macOS), 'win32' (Windows), 'linux'
  }

  /**
   * Set window to stay on top with screen-saver level
   * Prevents other apps from covering the window
   */
  static enforceAlwaysOnTop(window, level = 'screen-saver') {
    if (!window || window.isDestroyed()) return;

    try {
      if (process.platform === 'darwin') {
        // macOS: Use Electron's setAlwaysOnTop with screen-saver level
        window.setAlwaysOnTop(true, level);
        window.moveTop();
      } else if (process.platform === 'win32') {
        // Windows: Use FFI to call Windows API for better results
        // For now, use Electron's built-in (can enhance with FFI later)
        window.setAlwaysOnTop(true, level);
      } else {
        // Linux and others
        window.setAlwaysOnTop(true, level);
      }
    } catch (error) {
      console.error('Error setting always-on-top:', error);
    }
  }

  /**
   * Enforce always-on-top for a window at intervals
   * Some window managers ignore setAlwaysOnTop, so periodic enforcement helps
   */
  static startAlwaysOnTopEnforcer(window, intervalMs = 1000) {
    if (!window) return null;

    const interval = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(interval);
        return;
      }
      this.enforceAlwaysOnTop(window);
    }, intervalMs);

    return interval;
  }

  /**
   * Position window on specific display
   * Handles DPI scaling and multiple monitor setups
   */
  static positionWindow(window, display) {
    if (!window || !display) return;

    try {
      window.setBounds({
        x: Math.floor(display.bounds.x),
        y: Math.floor(display.bounds.y),
        width: Math.floor(display.bounds.width),
        height: Math.floor(display.bounds.height),
      });
    } catch (error) {
      console.error('Error positioning window:', error);
    }
  }

  /**
   * Get adjusted display bounds (handles DPI scaling on macOS)
   */
  static getDisplayBounds(display) {
    const scale = display.scaleFactor || 1;

    return {
      x: Math.floor(display.bounds.x),
      y: Math.floor(display.bounds.y),
      width: Math.floor(display.bounds.width),
      height: Math.floor(display.bounds.height),
      scaleFactor: scale,
    };
  }

  /**
   * Prevent window from being minimized or hidden
   */
  static preventMinimize(window) {
    if (!window) return;

    window.on('minimize', (e) => {
      e.preventDefault();
      window.restore();
      PlatformManager.enforceAlwaysOnTop(window);
    });

    window.on('hide', (e) => {
      e.preventDefault();
      window.show();
      PlatformManager.enforceAlwaysOnTop(window);
    });
  }

  /**
   * Make window fullscreen but covering entire monitor
   * (Not using Electron fullscreen mode which has issues on some platforms)
   */
  static makeFullscreenOnDisplay(window, display) {
    try {
      const bounds = this.getDisplayBounds(display);

      window.setFullScreen(false);
      window.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      window.setAlwaysOnTop(true, 'screen-saver');
    } catch (error) {
      console.error('Error making fullscreen on display:', error);
    }
  }

  /**
   * Get current platform info for debugging
   */
  static getInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      version: require('os').release(),
      nodeVersion: process.version,
      electronVersion: require('electron').app.getVersion(),
    };
  }
}

module.exports = PlatformManager;
