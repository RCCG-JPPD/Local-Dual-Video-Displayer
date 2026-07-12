/**
 * IPC Handler
 * Centralizes all IPC communication between main and renderer processes.
 */

const { ipcMain } = require('electron');
const { createSessionStore } = require('../utils/remote');

class IPCHandler {
  constructor(displayManager, configManager, callbacks = {}) {
    this.displayManager = displayManager;
    this.configManager = configManager;
    this.callbacks = callbacks;
    // Remote Mode pairing state — kept here (main process) so the code is
    // per-app-run: it survives controller reloads and display reconfigures.
    // With the opt-in "keep code between sessions" setting, the saved code
    // seeds the store so it also survives app restarts.
    const savedRemote = this.configManager.loadConfig().remote || {};
    this.remoteSession = createSessionStore(
      undefined,
      savedRemote.persistCode ? savedRemote.code : null,
    );
  }

  /** Session state + the persisted-code preference, for the Remote panel. */
  _remoteState() {
    const cfg = this.configManager.loadConfig();
    return {
      ...this.remoteSession.getState(),
      persistCode: !!(cfg.remote && cfg.remote.persistCode),
    };
  }

  /** Send to every live window currently serving `role`. */
  broadcastToRole(role, channel, ...args) {
    this.displayManager.getWindowsByRole(role).forEach(win => {
      win.webContents.send(channel, ...args);
    });
  }

  /** Show an open-file dialog parented to the controller. Returns selected paths. */
  async _openFiles(title, filters, multi = true) {
    const { dialog } = require('electron');
    const controller = this.displayManager.windows.controller;
    if (!controller || controller.isDestroyed()) return [];
    const properties = multi ? ['openFile', 'multiSelections'] : ['openFile'];
    const { canceled, filePaths } = await dialog.showOpenDialog(controller, { title, properties, filters });
    return canceled ? [] : filePaths;
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

    // Controller persists playlist edits (remove / clear) — additions are
    // persisted by the open-file-dialog handler above.
    ipcMain.on('save-playlist', (event, playlist) => {
      this.configManager.savePlaylist(Array.isArray(playlist) ? playlist : []);
    });

    // Presentation: pick a PowerPoint/PDF or a set of slide images.
    ipcMain.handle('open-presentation-dialog', async () => {
      return this._openFiles('Choose a presentation, PDF, or slide images', [
        { name: 'Presentations & images', extensions: ['pptx', 'ppt', 'odp', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'PowerPoint / PDF', extensions: ['pptx', 'ppt', 'odp', 'pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      ]);
    });

    // Resolve a chosen presentation file for the viewer. PDFs pass through.
    // PowerPoint/ODP get TWO LibreOffice conversions: a PDF (page counting,
    // thumbnails, static fallback) and an animated SVG whose embedded
    // presentation engine plays the deck's transitions and animations.
    ipcMain.handle('convert-presentation', async (event, filePath) => {
      if (!filePath) return { error: 'No file selected' };
      const path = require('path');
      const ext = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath);
      if (ext === '.pdf') return { type: 'pdf', source: filePath, name };

      if (['.pptx', '.ppt', '.odp'].includes(ext)) {
        const { app } = require('electron');
        const { findSoffice, convertToPdf, convertToSvg } = require('./officeConvert');
        if (!findSoffice()) {
          return { error: 'LibreOffice was not found. Install LibreOffice (free, libreoffice.org) to open PowerPoint files directly — or export your deck to PDF and open that.' };
        }
        try {
          const outDir = path.join(app.getPath('userData'), 'cache', 'presentations');
          const pdf = await convertToPdf(filePath, outDir);
          let svg = '';
          try {
            svg = await convertToSvg(filePath, outDir);
          } catch (err) {
            // Older LibreOffice or export hiccup — slides still work, statically.
            console.warn('SVG (animated) conversion failed, using static PDF:', err.message);
          }
          return { type: 'pdf', source: pdf, svg, name };
        } catch (err) {
          console.error('convert-presentation failed:', err);
          return { error: 'Could not convert this presentation: ' + (err && err.message ? err.message : String(err)) };
        }
      }
      return { error: 'Unsupported file type: ' + ext };
    });

    // Slideshow: pick images and/or videos.
    ipcMain.handle('open-media-dialog', async () => {
      return this._openFiles('Choose images and videos', [
        { name: 'Images & videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] },
      ]);
    });

    // Spreadsheet: pick one workbook.
    ipcMain.handle('open-spreadsheet-dialog', async () => {
      const paths = await this._openFiles('Choose a spreadsheet', [
        { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'xlsm', 'csv'] },
      ], false);
      return paths[0] || null;
    });

    // ════════════════════════════════════════════════════════════════
    // PRESENTATION (role 'powerpoint')
    // ════════════════════════════════════════════════════════════════

    // Controller sets the source (PDF / images). Persist + broadcast to the screen(s).
    ipcMain.on('presentation-load', (event, data) => {
      this.configManager.updateConfig({ presentation: data });
      this.broadcastToRole('powerpoint', 'presentation-load', data);
    });

    // Controller navigates slides (next / prev / goto). Persist the index on goto.
    ipcMain.on('presentation-command', (event, cmd, data) => {
      if (cmd === 'goto' && typeof data === 'number') {
        this.configManager.updateConfig({ presentation: { index: data } });
      }
      this.broadcastToRole('powerpoint', 'presentation-command', cmd, data);
    });

    // The display owns the live slide index (animations consume "next" presses
    // in animated SVG mode), so the primary screen reports it back for the
    // controller's counter / remote status. Persisted for restart restore.
    ipcMain.on('presentation-index', (event, index) => {
      const [primary] = this.displayManager.getWindowsByRole('powerpoint');
      if (primary && event.sender.id === primary.webContents.id && typeof index === 'number') {
        this.configManager.updateConfig({ presentation: { index } });
        const controller = this.displayManager.windows.controller;
        if (controller && !controller.isDestroyed()) {
          controller.webContents.send('presentation-index', index);
        }
      }
    });

    // ════════════════════════════════════════════════════════════════
    // SLIDESHOW (role 'slideshow')
    // ════════════════════════════════════════════════════════════════

    ipcMain.on('slideshow-load', (event, data) => {
      this.configManager.updateConfig({ slideshow: data });
      this.broadcastToRole('slideshow', 'slideshow-load', data);
    });

    ipcMain.on('slideshow-command', (event, cmd, data) => {
      if (cmd === 'goto' && typeof data === 'number') {
        this.configManager.updateConfig({ slideshow: { index: data } });
      }
      this.broadcastToRole('slideshow', 'slideshow-command', cmd, data);
    });

    // The slideshow window auto-advances on its own timer; the first/primary screen
    // reports the live index back so the controller can show the "next" thumbnail.
    ipcMain.on('slideshow-index', (event, index) => {
      const [primary] = this.displayManager.getWindowsByRole('slideshow');
      if (primary && event.sender.id === primary.webContents.id) {
        const controller = this.displayManager.windows.controller;
        if (controller && !controller.isDestroyed()) {
          controller.webContents.send('slideshow-index', index);
        }
      }
    });

    // ════════════════════════════════════════════════════════════════
    // SPREADSHEET (role 'excel')
    // ════════════════════════════════════════════════════════════════

    // Parse a workbook with SheetJS (main process) → { sheetNames, htmlBySheet }.
    // Also persist the source and broadcast to the excel screen(s).
    ipcMain.handle('load-spreadsheet', async (event, filePath) => {
      if (!filePath) return null;
      let data;
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(filePath);
        const sheetNames = wb.SheetNames;
        const htmlBySheet = sheetNames.map(name =>
          XLSX.utils.sheet_to_html(wb.Sheets[name], { id: 'sheet', editable: false }));
        data = { source: filePath, sheetNames, htmlBySheet, activeSheet: 0 };
      } catch (err) {
        console.error('load-spreadsheet failed:', err);
        return { error: err && err.message ? err.message : String(err) };
      }
      this.configManager.updateConfig({ spreadsheet: { source: filePath, activeSheet: 0 } });
      this.broadcastToRole('excel', 'excel-load', data);
      return data;
    });

    ipcMain.on('excel-command', (event, cmd, data) => {
      if (cmd === 'selectSheet' && typeof data === 'number') {
        this.configManager.updateConfig({ spreadsheet: { activeSheet: data } });
      } else if (cmd === 'clear') {
        this.configManager.updateConfig({ spreadsheet: { source: '', activeSheet: 0 } });
      }
      this.broadcastToRole('excel', 'excel-command', cmd, data);
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

    // URLs are persisted so a Web/YouTube screen assigned later (or on the
    // next run) restores the page — content can be prepared before any
    // screen has the role. 'about:blank' means cleared.
    ipcMain.on('web-url-change', (event, url) => {
      this.configManager.updateConfig({ web: { url: url === 'about:blank' ? '' : url } });
      this.broadcastToRole('web', 'web-url-change', url);
    });

    ipcMain.on('youtube-url-change', (event, url) => {
      this.configManager.updateConfig({ youtube: { url } });
      this.broadcastToRole('youtube', 'youtube-url-change', url);
    });

    // Controller → YouTube screens: play / pause / setVolume / mute / clear.
    ipcMain.on('youtube-command', (event, cmd, data) => {
      if (cmd === 'clear') this.configManager.updateConfig({ youtube: { url: '' } });
      this.broadcastToRole('youtube', 'youtube-command', cmd, data);
    });

    // ════════════════════════════════════════════════════════════════
    // CLOCK SETTINGS
    // ════════════════════════════════════════════════════════════════

    // Controller updates clock settings → persist, resize/reposition the clock
    // widgets (size/corner), and live-update their contents (theme/mode/text).
    ipcMain.on('clock-settings', (event, settings) => {
      this.configManager.updateConfig({ clock: settings });
      this.displayManager.applyClockWindowLayout(settings);
      this.broadcastToRole('clock', 'clock-settings', settings);
    });

    // Toggle a clock overlay on a single screen (coexists with its content).
    ipcMain.on('set-clock-overlay', (event, displayIndex, on) => {
      const config = this.configManager.loadConfig();
      const displays = (config.displays || []).map(d =>
        d.displayIndex === displayIndex ? { ...d, clockOverlay: !!on } : d);
      this.configManager.saveDisplayConfig(displays);
      this.displayManager.setClockOverlay(displayIndex, !!on, config.clock || {});
    });

    // ════════════════════════════════════════════════════════════════
    // SCREEN PREVIEWS (desktopCapturer)
    // ════════════════════════════════════════════════════════════════

    // Live thumbnails of each physical display's current contents so the user
    // can tell which screen is which when assigning roles.
    ipcMain.handle('get-screen-previews', async (event, opts) => {
      const { desktopCapturer } = require('electron');
      // Caller may request a larger capture (used by the click-to-enlarge lightbox).
      const thumbnailSize = (opts && opts.thumbnailSize) || { width: 320, height: 200 };
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize,
        });
        return sources.map(s => ({
          id: s.display_id ? Number(s.display_id) : null,
          name: s.name,
          dataURL: s.thumbnail.toDataURL(),
        }));
      } catch (err) {
        console.error('get-screen-previews failed:', err);
        return [];
      }
    });

    // ════════════════════════════════════════════════════════════════
    // STATE
    // ════════════════════════════════════════════════════════════════

    ipcMain.handle('get-config', () => this.configManager.loadConfig());
    ipcMain.handle('get-window-status', () => this.displayManager.getWindowStatus());

    // ════════════════════════════════════════════════════════════════
    // REMOTE MODE (phone/web control)
    // ════════════════════════════════════════════════════════════════

    // The controller fetches the per-run pairing code (generated lazily on
    // first use) and reports the on/off toggle so a reloaded controller can
    // re-arm Remote Mode with the same code.
    ipcMain.handle('remote-get-state', () => this._remoteState());
    ipcMain.on('remote-set-enabled', (event, on) => this.remoteSession.setEnabled(on));

    // Invalidate the current pairing code and issue a fresh one. If the code
    // is persisted across sessions, the new one replaces it on disk.
    ipcMain.handle('remote-reset-code', () => {
      this.remoteSession.resetCode();
      const cfg = this.configManager.loadConfig();
      if (cfg.remote && cfg.remote.persistCode) {
        this.configManager.updateConfig({ remote: { code: this.remoteSession.getState().code } });
      }
      return this._remoteState();
    });

    // Opt in/out of reusing the pairing code across app runs (off by default).
    // Opting in saves the current code; opting out wipes it so the next run
    // generates a fresh one.
    ipcMain.handle('remote-set-persist', (event, on) => {
      const persist = !!on;
      this.configManager.updateConfig({
        remote: {
          persistCode: persist,
          code: persist ? this.remoteSession.getState().code : '',
        },
      });
      return this._remoteState();
    });

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
