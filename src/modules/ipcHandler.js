/**
 * IPC Handler
 * Centralizes all IPC communication between main and renderer processes.
 */

const { ipcMain } = require('electron');
const { createSessionStore } = require('../utils/remote');
const { normalizeZoom } = require('../utils/zoom');
const { normalizeCaptions } = require('../utils/captions');
const { normalizeLogo } = require('../utils/logo');
const { normalizeTransition } = require('../utils/transition');
const { normalizeOcr, normalizeRegion } = require('../utils/ocr');
const vdoninja = require('../utils/vdoninja');
const OcrEngine = require('./ocrEngine');

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

  /**
   * Persist a slice of config, coalescing the writes.
   *
   * Settings like zoom, caption size and logo opacity arrive on every tick of a
   * slider, and updateConfig re-reads and rewrites the whole config file each
   * time — so batch the pending sections and write once the drag settles.
   * Broadcasting stays immediate, so the screens still follow the slider live.
   *
   * @param {string} section top-level config key (e.g. 'zoom', 'captions')
   * @param {object} patch   merged into whatever is already pending
   */
  _persistLater(section, patch) {
    this._pendingWrite = this._pendingWrite || {};
    this._pendingWrite[section] = { ...(this._pendingWrite[section] || {}), ...patch };
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => {
      const pending = this._pendingWrite;
      this._pendingWrite = null;
      if (pending) this.configManager.updateConfig(pending);
    }, 400);
  }

  /**
   * Persist a screen's zoom.
   * @param {'video'|'slideshow'|'youtube'|'camera'} role
   * @param {{mode: string, scale: number}} zoom
   */
  _persistZoom(role, zoom) {
    this._persistLater('zoom', { [role]: zoom });
  }

  /** True when `event` came from the FIRST window serving `role`.
   *
   * Screens report state back to the controller, and a role can be assigned to
   * several screens at once — without this guard every mirrored screen would
   * report and the controller would flicker between them.
   */
  _isPrimaryFor(role, event) {
    const [primary] = this.displayManager.getWindowsByRole(role);
    return !!primary && event.sender.id === primary.webContents.id;
  }

  /** Send to the controller window, if it's alive. */
  _toController(channel, ...args) {
    const controller = this.displayManager.windows.controller;
    if (controller && !controller.isDestroyed()) controller.webContents.send(channel, ...args);
  }

  /**
   * The OCR engine, created on first use.
   *
   * Lazy because most runs of this app never read lyrics at all, and the engine
   * spawns a Tesseract worker process the moment it starts.
   */
  _ocr() {
    if (!this.ocrEngine) {
      this.ocrEngine = new OcrEngine({
        // Main is the PRODUCER of caption lines here, so it broadcasts straight
        // to the screens rather than routing through the controller — captions
        // must survive a controller reload mid-song.
        onText: (text) => this._emitCaption({ text, source: 'ocr' }),
        onStatus: (status) => this._toController('ocr-status', status),
      });
    }
    return this.ocrEngine;
  }

  /** Fan one caption line out to every camera screen. */
  _emitCaption(payload) {
    const line = {
      text: typeof payload.text === 'string' ? payload.text : '',
      source: payload.source === 'ocr' ? 'ocr' : 'manual',
      confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
      at: Date.now(),
    };
    this.broadcastToRole('camera', 'caption-text', line);
  }

  /**
   * Clear every camera screen, revealing whatever is behind it.
   * Called by the global panic-button shortcut as well as the controller, so
   * it lives here rather than inline in the IPC handler.
   */
  resetCameraScreens() {
    this._persistLater('camera', { visible: false });
    this.broadcastToRole('camera', 'camera-command', 'reset', null);
    this._toController('camera-reset');
  }

  /** Stop background work. Called when the app is shutting down. */
  dispose() {
    clearTimeout(this._writeTimer);
    if (this._pendingWrite) {
      // Don't lose a slider adjustment made in the last 400ms before quit.
      this.configManager.updateConfig(this._pendingWrite);
      this._pendingWrite = null;
    }
    if (this.ocrEngine) this.ocrEngine.stop();
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

    // Controller → all video windows. Zoom is the one command worth persisting:
    // it's a screen setting, not a transport action, so it survives a restart.
    ipcMain.on('controller-command', (event, cmd, data) => {
      let payload = data;
      if (cmd === 'setZoom') {
        payload = normalizeZoom(data);
        this._persistZoom('video', payload);
      }
      this.broadcastToRole('video', 'playback-command', cmd, payload);
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
      let payload = data;
      if (cmd === 'goto' && typeof data === 'number') {
        this.configManager.updateConfig({ slideshow: { index: data } });
      } else if (cmd === 'setZoom') {
        payload = normalizeZoom(data);
        this._persistZoom('slideshow', payload);
      }
      this.broadcastToRole('slideshow', 'slideshow-command', cmd, payload);
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
      let payload = data;
      if (cmd === 'clear') {
        this.configManager.updateConfig({ youtube: { url: '' } });
      } else if (cmd === 'setZoom') {
        payload = normalizeZoom(data);
        this._persistZoom('youtube', payload);
      }
      this.broadcastToRole('youtube', 'youtube-command', cmd, payload);
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
    // CAMERA SCREEN
    // ════════════════════════════════════════════════════════════════

    // Controller -> every camera screen. Most commands are transport actions,
    // but the ones that describe how the screen should LOOK are persisted so
    // they survive a restart, exactly as the video screen treats zoom.
    ipcMain.on('camera-command', (event, cmd, data) => {
      let payload = data;
      switch (cmd) {
        case 'setZoom':
          payload = normalizeZoom(data);
          this._persistZoom('camera', payload);
          break;
        case 'live':
          payload = !!data;
          // Going live implies the stage is visible; otherwise the operator
          // turns the camera on and nothing appears.
          this._persistLater('camera', payload ? { live: true, visible: true } : { live: false });
          break;
        case 'setDevice':
          payload = typeof data === 'string' ? data : '';
          this._persistLater('camera', { deviceId: payload });
          break;
        case 'mirror':
          payload = !!data;
          this._persistLater('camera', { mirror: payload });
          break;
        case 'setSource':
          payload = data === 'vdo' ? 'vdo' : 'device';
          this._persistLater('camera', { source: payload });
          break;
        case 'setVdo': {
          // Validate every URL here, and strip room passwords before anything
          // reaches the config file on disk.
          const incoming = vdoninja.normalizeVdo(data);
          const sources = [];
          for (const src of incoming.sources) {
            try {
              vdoninja.validateAndNormalizeUrl(src.url);
              sources.push({ ...src, url: vdoninja.sanitizeUrlForStorage(src.url) });
            } catch (err) {
              console.warn(`Rejecting VDO.Ninja source "${src.label}": ${err.message}`);
            }
          }
          payload = vdoninja.normalizeVdo({ ...incoming, sources });
          this._persistLater('camera', { vdo: payload });
          break;
        }
        case 'setRenderMode':
          payload = data === 'canvas' ? 'canvas' : 'video';
          this._persistLater('camera', { renderMode: payload });
          break;
        case 'reset':
          this._persistLater('camera', { visible: false });
          break;
        case 'restore':
          this._persistLater('camera', { visible: true, live: true });
          break;
        default:
          break; // blank / rescanDevices are transient
      }
      this.broadcastToRole('camera', 'camera-command', cmd, payload);
    });

    // Only the first camera screen reports back, or every mirrored screen would.
    ipcMain.on('camera-status', (event, status) => {
      if (this._isPrimaryFor('camera', event)) this._toController('camera-status', status);
    });

    ipcMain.on('camera-devices', (event, devices) => {
      if (!this._isPrimaryFor('camera', event)) return;
      this._cameraDevices = Array.isArray(devices) ? devices : [];
      this._toController('camera-devices', this._cameraDevices);
    });

    // Electron fixes a window's transparency at creation, so the only way to
    // honour a change to it is to build the window again.
    ipcMain.on('camera-recreate', () => {
      this.displayManager.recreateCameraWindows(this.configManager.loadConfig());
    });

    // ════════════════════════════════════════════════════════════════
    // CAPTIONS / LOGO / TRANSITIONS
    // ════════════════════════════════════════════════════════════════

    ipcMain.on('caption-settings', (event, settings) => {
      const payload = normalizeCaptions(settings);
      this._persistLater('captions', payload);
      this.broadcastToRole('camera', 'caption-settings', payload);
    });

    // Caption LINES are never persisted — they change every few seconds, and a
    // whole-file config write per lyric would be absurd. Both OCR and the
    // controller's manual input arrive here, so the caption layer works
    // identically whether or not OCR is running.
    ipcMain.on('caption-text', (event, payload) => {
      this._emitCaption(payload && typeof payload === 'object' ? payload : { text: payload });
    });

    ipcMain.on('logo-settings', (event, settings) => {
      const payload = normalizeLogo(settings);
      this._persistLater('logo', payload);
      this.broadcastToRole('camera', 'logo-settings', payload);
    });

    ipcMain.on('transition-settings', (event, settings) => {
      const payload = normalizeTransition(settings);
      this._persistLater('transition', payload);
      this.broadcastToRole('camera', 'transition-settings', payload);
    });

    ipcMain.handle('select-logo-file', async () => {
      const [file] = await this._openFiles(
        'Choose a logo image',
        [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg', 'gif', 'svg'] }],
        false,
      );
      return file || '';
    });

    // ════════════════════════════════════════════════════════════════
    // LYRIC OCR
    // ════════════════════════════════════════════════════════════════

    ipcMain.on('ocr-command', (event, cmd, data) => {
      const cfg = this.configManager.loadConfig();
      const current = normalizeOcr(cfg.ocr);

      switch (cmd) {
        case 'start':
          this._persistLater('ocr', { enabled: true });
          this._ocr().start({ ...current, enabled: true });
          break;
        case 'stop':
          this._persistLater('ocr', { enabled: false });
          this._ocr().stop();
          break;
        case 'setRegion': {
          const region = normalizeRegion(data && data.region);
          const displayId = data && Number.isFinite(Number(data.displayId))
            ? Number(data.displayId)
            : current.displayId;
          const next = { ...current, region, displayId };
          this._persistLater('ocr', { region, displayId });
          this._ocr().update(next);
          break;
        }
        case 'setTuning': {
          const next = normalizeOcr({ ...current, ...(data || {}) });
          this._persistLater('ocr', next);
          this._ocr().update(next);
          break;
        }
        case 'setOutput': {
          const outputToScreen = !!data;
          this._persistLater('ocr', { outputToScreen });
          this._ocr().update({ ...current, outputToScreen });
          break;
        }
        case 'once':
          this._ocr().readOnce({ ...current });
          break;
        default:
          console.warn('Unknown OCR command:', cmd);
      }
    });

    ipcMain.handle('ocr-get-state', () => this._ocr().getState());

    // A full still of one screen, so the controller can draw the region picker.
    ipcMain.handle('ocr-capture-frame', async (event, opts) => {
      const { desktopCapturer, screen } = require('electron');
      const size = (opts && opts.thumbnailSize) || { width: 1600, height: 1000 };
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
        const wanted = opts && Number.isFinite(Number(opts.displayId)) ? Number(opts.displayId) : null;
        const source = (wanted !== null && sources.find(s => Number(s.display_id) === wanted))
          || sources[0];
        if (!source) return null;
        return {
          displayId: source.display_id ? Number(source.display_id) : null,
          name: source.name,
          dataURL: source.thumbnail.toDataURL(),
          size: source.thumbnail.getSize(),
          displays: screen.getAllDisplays().map((d, i) => ({
            id: d.id, index: i, label: d.label || `Display ${i + 1}`, bounds: d.bounds,
          })),
        };
      } catch (err) {
        console.error('ocr-capture-frame failed:', err);
        return null;
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
