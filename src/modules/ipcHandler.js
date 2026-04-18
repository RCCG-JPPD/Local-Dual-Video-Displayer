/**
 * IPC Handler
 * Centralizes all IPC communication between main and renderer processes
 */

const { ipcMain } = require('electron');

class IPCHandler {
  constructor(displayManager, configManager, callbacks = {}) {
    this.displayManager = displayManager;
    this.configManager = configManager;
    this.callbacks = callbacks;
  }

  /**
   * Initialize all IPC listeners
   */
  setupListeners() {
    // ════════════════════════════════════════════════════════════════
    // DISPLAY CONFIGURATION
    // ════════════════════════════════════════════════════════════════

    // Display selector sends config when user confirms
    ipcMain.on('display-config-saved', (event, displays) => {
      console.log('Display config received from selector:', displays);

      // Convert displays to config format
      const configDisplays = displays.map(display => ({
        id: display.id,
        displayIndex: display.index,
        role: display.role,
        label: display.label,
        bounds: display.bounds,
      }));

      // Save to config
      this.configManager.saveDisplayConfig(configDisplays);

      // Notify renderer that config was saved
      event.sender.send('config-saved');
    });

    // Selector invokes this to get displays reliably (no timing race)
    ipcMain.handle('get-displays', () => {
      return this.displayManager.detectDisplays().map((d, i) => ({
        index: i,
        id: d.id,
        label: d.label || `Display ${i + 1}`,
        bounds: d.bounds,
        isPrimary: d.isPrimary,
      }));
    });

    // Legacy push-based handler kept for compatibility
    ipcMain.on('request-displays', (event) => {
      const displays = this.displayManager.detectDisplays();
      event.sender.send('displays-detected', displays.map((d, i) => ({
        index: i,
        id: d.id,
        label: d.label || `Display ${i + 1}`,
        bounds: d.bounds,
        isPrimary: d.isPrimary,
      })));
    });

    // Selector requests to close
    ipcMain.on('close-selector', (event) => {
      const selector = this.displayManager.windows.selector;
      if (selector && !selector.isDestroyed()) {
        selector.close();
      }
    });

    // ════════════════════════════════════════════════════════════════
    // VIDEO PLAYBACK CONTROL
    // ════════════════════════════════════════════════════════════════

    // Controller sends playback commands to video windows
    ipcMain.on('controller-command', (event, cmd, data) => {
      const publicWindow = this.displayManager.windows.public;
      const privateWindow = this.displayManager.windows.private;

      if (publicWindow && !publicWindow.isDestroyed()) {
        publicWindow.webContents.send('playback-command', cmd, data);
      }
      if (privateWindow && !privateWindow.isDestroyed()) {
        privateWindow.webContents.send('playback-command', cmd, data);
      }
    });

    // Video window sends time updates to controller
    ipcMain.on('video-time', (event, currentTime, duration) => {
      const publicWindow = this.displayManager.windows.public;

      // Only accept from public video window
      if (publicWindow && event.sender.id === publicWindow.webContents.id) {
        const controller = this.displayManager.windows.controller;
        if (controller && !controller.isDestroyed()) {
          controller.webContents.send('video-time', currentTime, duration);
        }
      }
    });

    // ════════════════════════════════════════════════════════════════
    // FILE DIALOG
    // ════════════════════════════════════════════════════════════════

    // Controller requests file dialog for videos
    ipcMain.handle('open-file-dialog', async (event) => {
      const { dialog } = require('electron');
      const controller = this.displayManager.windows.controller;

      if (!controller || controller.isDestroyed()) {
        return [];
      }

      const { canceled, filePaths } = await dialog.showOpenDialog(controller, {
        title: 'Choose video(s)',
        properties: ['openFile', 'multiSelections'],
        filters: [{
          name: 'Videos',
          extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv']
        }],
      });

      if (!canceled) {
        // Save playlist to config
        const currentConfig = this.configManager.loadConfig();
        const updatedPlaylist = [...(currentConfig.playback.playlist || []), ...filePaths];
        this.configManager.updateConfig({
          playback: { playlist: updatedPlaylist }
        });
      }

      return canceled ? [] : filePaths;
    });

    // ════════════════════════════════════════════════════════════════
    // CANVAS PREVIEW / MIRRORING
    // ════════════════════════════════════════════════════════════════

    // Display windows send preview canvas data to controller
    ipcMain.on('canvas-preview-data', (event, data) => {
      const controller = this.displayManager.windows.controller;

      if (controller && !controller.isDestroyed()) {
        controller.webContents.send('preview-updated', data);
      }
    });

    // ════════════════════════════════════════════════════════════════
    // WEB BROWSER CONTROL
    // ════════════════════════════════════════════════════════════════

    // Controller sends URL to web browsers
    ipcMain.on('web-url-change', (event, url) => {
      const webWindow = this.displayManager.windows.web;

      if (webWindow && !webWindow.isDestroyed()) {
        webWindow.webContents.send('web-url-change', url);
      }
    });

    // ════════════════════════════════════════════════════════════════
    // YOUTUBE PLAYBACK CONTROL
    // ════════════════════════════════════════════════════════════════

    // Controller sends YouTube video ID/URL to players
    ipcMain.on('youtube-url-change', (event, url) => {
      const youtubeWindow = this.displayManager.windows.youtube;

      if (youtubeWindow && !youtubeWindow.isDestroyed()) {
        youtubeWindow.webContents.send('youtube-url-change', url);
      }
    });

    // ════════════════════════════════════════════════════════════════
    // CONFIGURATION / STATE
    // ════════════════════════════════════════════════════════════════

    // Renderer requests current config
    ipcMain.handle('get-config', (event) => {
      return this.configManager.loadConfig();
    });

    // Renderer requests current window status
    ipcMain.handle('get-window-status', (event) => {
      return this.displayManager.getWindowStatus();
    });

    // ════════════════════════════════════════════════════════════════
    // DISPLAY RECONFIGURATION
    // ════════════════════════════════════════════════════════════════

    // Controller requests to reconfigure displays
    ipcMain.on('request-reconfigure-displays', (event) => {
      console.log('Reconfigure displays requested');
      if (this.callbacks.onReconfigure) {
        this.callbacks.onReconfigure();
      }
      event.sender.send('reconfigure-requested');
    });

    // Renderer can send log messages that appear in the terminal (useful for Windows debugging)
    ipcMain.on('renderer-log', (event, level, msg) => {
      if (level === 'error') console.error('[Renderer]', msg);
      else console.log('[Renderer]', msg);
    });

    console.log('IPC listeners initialized');
  }
}

module.exports = IPCHandler;
