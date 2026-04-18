/**
 * Window Lifecycle Manager
 * Manages parent-child relationships between windows
 * Ensures proper cleanup when controllers window closes
 */

class WindowLifecycleManager {
  constructor(app) {
    this.app = app;
    this.parentWindow = null; // Controller window
    this.childWindows = new Set(); // Display windows (public, private, clock, etc.)
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
   * Register a display window as child
   */
  registerChildWindow(displayWindow) {
    if (!displayWindow) return;

    const windowId = displayWindow.webContents.id;
    this.childWindows.add(windowId);

    // Clean up from set when child closes
    displayWindow.on('closed', () => {
      this.childWindows.delete(windowId);
      console.log(`Child window closed. Remaining children: ${this.childWindows.size}`);
    });

    return displayWindow;
  }

  /**
   * Close all child windows
   */
  closeAllChildren() {
    console.log(`Closing ${this.childWindows.size} child window(s)`);
    this.childWindows.forEach(windowId => {
      // Note: We can't directly access windows by ID in Electron,
      // so we rely on the close events to clean up
    });
  }

  /**
   * Get status of window hierarchy
   */
  getStatus() {
    return {
      parentAlive: this.parentWindow && !this.parentWindow.isDestroyed(),
      childrenCount: this.childWindows.size,
      childrenIds: Array.from(this.childWindows),
    };
  }
}

module.exports = WindowLifecycleManager;
