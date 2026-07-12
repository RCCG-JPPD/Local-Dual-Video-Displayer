/**
 * Window Lifecycle Manager
 * Manages parent-child relationships between windows
 * Ensures proper cleanup when controllers window closes
 */

class WindowLifecycleManager {
  constructor(app) {
    this.app = app;
    this.parentWindow = null; // Controller window
  }

  /**
   * Register controller window as parent
   */
  setParentWindow(controllerWindow) {
    this.parentWindow = controllerWindow;

    // When parent closes, close all children and exit app
    controllerWindow.on('closed', () => {
      console.log('Parent (controller) window closed - closing all children');
      this.closeAllChildren();
      this.app.quit();
    });

    // When parent is minimized, do nothing (children continue running)
    controllerWindow.on('minimize', () => {
      console.log('Parent window minimized - display windows continue running');
    });

    return controllerWindow;
  }

  /**
   * Close every window except the parent (used when the controller closes).
   */
  closeAllChildren() {
    const { BrowserWindow } = require('electron');
    const allWindows = BrowserWindow.getAllWindows();
    console.log(`Closing ${allWindows.length - 1} child window(s)`);
    allWindows.forEach(win => {
      if (win !== this.parentWindow && !win.isDestroyed()) {
        win.close();
      }
    });
  }
}

module.exports = WindowLifecycleManager;
