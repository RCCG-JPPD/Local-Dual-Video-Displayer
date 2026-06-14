/**
 * IPC Handler
 * Centralizes all IPC communication between main and renderer processes.
 */

const { ipcMain } = require('electron');

class IPCHandler {
  constructor(displayManager, configManager, callbacks = {}) {
    this.displayManager = displayManager;
    this.configManager = configManager;
    this.callbacks = callbacks;
  }

  /** Send to every live window currently serving `role`. */
  broadcastToRole(role, channel, ...args) {
    this.displayManager.getWindowsByRole(role).forEach(win => {
      win.webContents.send(channel, ...args);
    });
  }

  setupListeners() {
    // ════════════════════════════════════════════════════════════════
    // DISPLAY CONFIGURATION
    // ════════════════════════════════════════════════════════════════

    // Selector confirms — persist the chosen roles.
    ipcMain.on('display-config-saved', (event, displays) => {
      console.log('Display config received from selector:', displays);

      const configDisplays = displays.map(display => ({
        id: display.id,
        displayIndex: display.index,
        role: display.role,
        label: display.label,
        bounds: display.bounds,
      }));

      this.configManager.saveDisplayConfig(configDisplays);
      event.sender.send('config-saved');
    });

    // Selector (and others) fetch displays reliably via request/response.
    ipcMain.handle('get-displays', () => this.displayManager.getDisplayData());

    // Selector requests to close.
    ipcMain.on('close-selector', () => {
      const selector = this.displayManager.windows.selector;
      if (selector && !selector.isDestroyed()) selector.close();
    });

    // ════════════════════════════════════════════════════════════════
    // VIDEO PLAYBACK CONTROL
    // ════════════════════════════════════════════════════════════════

    // Controller → all video windows.
    ipcMain.on('controller-command', (event, cmd, data) => {
      this.broadcastToRole('video', 'playback-command', cmd, data);
    });

    // Only the first/primary video window reports time back to the controller.
    ipcMain.on('video-time', (event, currentTime, duration) => {
      const [primary] = this.displayManager.getWindowsByRole('video');
      if (primary && event.sender.id === primary.webContents.id) {
        const controller = this.displayManager.windows.controller;
        if (controller && !controller.isDestroyed()) {
          controller.webContents.send('video-time', currentTime, duration);
        }
      }
    });

    // ════════════════════════════════════════════════════════════════
    // FILE DIALOG
    // ════════════════════════════════════════════════════════════════

    ipcMain.handle('open-file-dialog', async () => {
      const { dialog } = require('electron');
      const controller = this.displayManager.windows.controller;
      if (!controller || controller.isDestroyed()) return [];

      const { canceled, filePaths } = await dialog.showOpenDialog(controller, {
        title: 'Choose video(s)',
        properties: ['openFile', 'multiSelections'],
        filters: [{
          name: 'Videos',
          extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'],
        }],
      });

      if (!canceled) {
        const currentConfig = this.configManager.loadConfig();
        const updatedPlaylist = [...(currentConfig.playback.playlist || []), ...filePaths];
        this.configManager.updateConfig({ playback: { playlist: updatedPlaylist } });
      }

      return canceled ? [] : filePaths;
    });

    // ════════════════════════════════════════════════════════════════
    // CANVAS PREVIEW / MIRRORING
    // ════════════════════════════════════════════════════════════════

    ipcMain.on('canvas-preview-data', (event, data) => {
      const controller = this.displayManager.windows.controller;
      if (controller && !controller.isDestroyed()) {
        controller.webContents.send('preview-updated', data);
      }
    });

    // ════════════════════════════════════════════════════════════════
    // WEB / YOUTUBE
    // ════════════════════════════════════════════════════════════════

    ipcMain.on('web-url-change', (event, url) => {
      this.broadcastToRole('web', 'web-url-change', url);
    });

    ipcMain.on('youtube-url-change', (event, url) => {
      this.broadcastToRole('youtube', 'youtube-url-change', url);
    });

    // ════════════════════════════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════════════════════════════

    ipcMain.handle('get-config', () => this.configManager.loadConfig());
    ipcMain.handle('get-window-status', () => this.displayManager.getWindowStatus());

    // ════════════════════════════════════════════════════════════════
    // DISPLAY RECONFIGURATION / TOOLS
    // ════════════════════════════════════════════════════════════════

    ipcMain.on('request-reconfigure-displays', (event) => {
      console.log('Reconfigure displays requested');
      if (this.callbacks.onReconfigure) this.callbacks.onReconfigure();
      event.sender.send('reconfigure-requested');
    });

    // Flash a number on each physical screen so the user can identify them.
    ipcMain.on('identify-screens', () => this.displayManager.identifyScreens());

    // Open the in-app Help / tutorial window.
    ipcMain.on('open-help', () => this.displayManager.createHelpWindow());

    // Renderer logs surfaced in the terminal (essential for Windows debugging).
    ipcMain.on('renderer-log', (event, level, msg) => {
      if (level === 'error') console.error('[Renderer]', msg);
      else console.log('[Renderer]', msg);
    });

    console.log('IPC listeners initialized');
  }
}

module.exports = IPCHandler;
