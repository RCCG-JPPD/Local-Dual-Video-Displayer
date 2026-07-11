/**
 * Preload Script
 * Provides secure IPC bridge between renderer and main process
 * Implements context isolation security best practices
 */

const { contextBridge, ipcRenderer } = require('electron');
const { extractVideoId } = require('./src/utils/youtube');
const { normalizeUrl } = require('./src/utils/weburl');
const { formatClock, formatDuration, secondsUntil } = require('./src/utils/clockformat');
const { nextIndex: slideshowNextIndex } = require('./src/utils/slideshow');
const { getActiveHoliday, HOLIDAY_KEYS, ANIMATIONS } = require('./src/utils/holidays');
const { THEMES, resolveTheme } = require('./src/utils/clockThemes');
const remote = require('./src/utils/remote');

// Expose safe IPC APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ════════════════════════════════════════════════════════════════
  // PURE HELPERS (shared with unit tests via src/utils/*)
  // ════════════════════════════════════════════════════════════════

  extractYouTubeId: (urlOrId) => extractVideoId(urlOrId),
  normalizeWebUrl: (url) => normalizeUrl(url),
  slideshowNextIndex: (index, length, dir, loop) => slideshowNextIndex(index, length, dir, loop),

  // Clock helpers (formatting + holiday calendar)
  formatClock: (date, opts) => formatClock(date, opts),
  formatDuration: (s) => formatDuration(s),
  secondsUntil: (target, now) => secondsUntil(target, now),
  getActiveHoliday: (date) => getActiveHoliday(date),
  holidayList: () => HOLIDAY_KEYS,
  animationList: () => ANIMATIONS,
  clockThemes: () => THEMES,
  resolveClockTheme: (themeKey, holidayKey) => resolveTheme(themeKey, holidayKey),

  // Remote Mode pure helpers (Firebase phone/web presentation control).
  // The Firebase SDK itself is loaded in the renderer via vendored <script> tags;
  // these are the DOM-free helpers shared with unit tests (src/utils/remote.js).
  remote: {
    generateSessionCode: (len) => remote.generateSessionCode(len),
    normalizeSessionCode: (s) => remote.normalizeSessionCode(s),
    isValidSessionCode: (c, len) => remote.isValidSessionCode(c, len),
    buildRemoteUrl: (code, base) => remote.buildRemoteUrl(code, base),
    sanitizeCommand: (raw) => remote.sanitizeCommand(raw),
    buildStateSnapshot: (input, now) => remote.buildStateSnapshot(input, now),
    // Per-run pairing state held by the main process: the code is generated
    // once per app run, so it survives display reconfigures and controller
    // reloads — a new code only appears after quitting and reopening the app.
    getState: () => ipcRenderer.invoke('remote-get-state'),
    setEnabled: (on) => ipcRenderer.send('remote-set-enabled', !!on),
  },

  // ════════════════════════════════════════════════════════════════
  // CONFIG & STATE
  // ════════════════════════════════════════════════════════════════

  getConfig: () => ipcRenderer.invoke('get-config'),
  getWindowStatus: () => ipcRenderer.invoke('get-window-status'),

  // ════════════════════════════════════════════════════════════════
  // PLAYBACK CONTROL
  // ════════════════════════════════════════════════════════════════

  // Send playback commands to video windows
  sendPlaybackCommand: (cmd, data) => {
    ipcRenderer.send('controller-command', cmd, data);
  },

  // Video windows listen for playback commands from controller
  onPlaybackCommand: (callback) => {
    ipcRenderer.on('playback-command', (event, cmd, data) => {
      callback(cmd, data);
    });
  },

  // Listen for video time updates
  onVideoTime: (callback) => {
    ipcRenderer.on('video-time', (event, currentTime, duration) => {
      callback(currentTime, duration);
    });
  },

  // Send video time updates to controller
  sendVideoTime: (currentTime, duration) => {
    ipcRenderer.send('video-time', currentTime, duration);
  },

  // ════════════════════════════════════════════════════════════════
  // WEB BROWSER CONTROL
  // ════════════════════════════════════════════════════════════════

  // Send URL to web browsers
  sendWebUrl: (url) => {
    ipcRenderer.send('web-url-change', url);
  },

  // Web displays listen for URL changes
  onWebUrlChange: (callback) => {
    ipcRenderer.on('web-url-change', (event, url) => {
      callback(url);
    });
  },

  // ════════════════════════════════════════════════════════════════
  // YOUTUBE CONTROL
  // ════════════════════════════════════════════════════════════════

  // Send YouTube video ID/URL to players
  sendYouTubeUrl: (url) => {
    ipcRenderer.send('youtube-url-change', url);
  },

  // YouTube displays listen for URL changes
  onYouTubeUrlChange: (callback) => {
    ipcRenderer.on('youtube-url-change', (event, url) => {
      callback(url);
    });
  },

  // Controller → YouTube playback commands (play/pause/setVolume/mute)
  sendYouTubeCommand: (cmd, data) => ipcRenderer.send('youtube-command', cmd, data),
  onYouTubeCommand: (callback) => {
    ipcRenderer.on('youtube-command', (event, cmd, data) => callback(cmd, data));
  },

  // ════════════════════════════════════════════════════════════════
  // CLOCK CONTROL
  // ════════════════════════════════════════════════════════════════

  // Controller pushes clock settings (persisted + broadcast to clock screens)
  sendClockSettings: (settings) => ipcRenderer.send('clock-settings', settings),

  // Toggle a clock overlay on a specific screen (coexists with its content)
  setClockOverlay: (displayIndex, on) => ipcRenderer.send('set-clock-overlay', displayIndex, on),

  // Clock screens listen for live settings updates
  onClockSettings: (callback) => {
    ipcRenderer.on('clock-settings', (event, settings) => callback(settings));
  },

  // ════════════════════════════════════════════════════════════════
  // SCREEN PREVIEWS (identify which physical screen is which)
  // ════════════════════════════════════════════════════════════════

  // Returns [{ id, dataURL }] thumbnails of each physical display's contents.
  // Pass { thumbnailSize: { width, height } } for a larger capture (enlarge view).
  getScreenPreviews: (opts) => ipcRenderer.invoke('get-screen-previews', opts),

  // ════════════════════════════════════════════════════════════════
  // PRESENTATION (role 'powerpoint')
  // ════════════════════════════════════════════════════════════════

  selectPresentationFiles: () => ipcRenderer.invoke('open-presentation-dialog'),
  // Resolve a chosen file to renderable sources (converts PowerPoint via
  // LibreOffice): a PDF, plus an animated SVG when the deck has one.
  convertPresentation: (filePath) => ipcRenderer.invoke('convert-presentation', filePath),
  sendPresentationLoad: (data) => ipcRenderer.send('presentation-load', data),
  sendPresentationCommand: (cmd, data) => ipcRenderer.send('presentation-command', cmd, data),
  onPresentationLoad: (cb) => ipcRenderer.on('presentation-load', (e, data) => cb(data)),
  onPresentationCommand: (cb) => ipcRenderer.on('presentation-command', (e, cmd, data) => cb(cmd, data)),
  // Display → controller: the live slide index (animations consume presses).
  sendPresentationIndex: (index) => ipcRenderer.send('presentation-index', index),
  onPresentationIndex: (cb) => ipcRenderer.on('presentation-index', (e, index) => cb(index)),

  // ════════════════════════════════════════════════════════════════
  // SLIDESHOW (role 'slideshow')
  // ════════════════════════════════════════════════════════════════

  selectMediaFiles: () => ipcRenderer.invoke('open-media-dialog'),
  sendSlideshowLoad: (data) => ipcRenderer.send('slideshow-load', data),
  sendSlideshowCommand: (cmd, data) => ipcRenderer.send('slideshow-command', cmd, data),
  onSlideshowLoad: (cb) => ipcRenderer.on('slideshow-load', (e, data) => cb(data)),
  onSlideshowCommand: (cb) => ipcRenderer.on('slideshow-command', (e, cmd, data) => cb(cmd, data)),
  // Display → controller: the live current index (for the next-slide preview).
  sendSlideshowIndex: (index) => ipcRenderer.send('slideshow-index', index),
  onSlideshowIndex: (cb) => ipcRenderer.on('slideshow-index', (e, index) => cb(index)),

  // ════════════════════════════════════════════════════════════════
  // SPREADSHEET (role 'excel')
  // ════════════════════════════════════════════════════════════════

  selectSpreadsheet: () => ipcRenderer.invoke('open-spreadsheet-dialog'),
  loadSpreadsheet: (filePath) => ipcRenderer.invoke('load-spreadsheet', filePath),
  sendExcelCommand: (cmd, data) => ipcRenderer.send('excel-command', cmd, data),
  onExcelLoad: (cb) => ipcRenderer.on('excel-load', (e, data) => cb(data)),
  onExcelCommand: (cb) => ipcRenderer.on('excel-command', (e, cmd, data) => cb(cmd, data)),

  // ════════════════════════════════════════════════════════════════
  // FILE OPERATIONS
  // ════════════════════════════════════════════════════════════════

  // Open file dialog for video selection
  selectVideoFiles: () => ipcRenderer.invoke('open-file-dialog'),

  // Convert an absolute filesystem path into a correct file:// URL.
  // Uses Node's pathToFileURL so Windows drive letters (C:\), spaces and
  // unicode are encoded properly — `file://${path}` breaks on Windows.
  toFileURL: (p) => require('url').pathToFileURL(p).href,

  // ════════════════════════════════════════════════════════════════
  // DISPLAY CONFIGURATION
  // ════════════════════════════════════════════════════════════════

  // Request display reconfiguration
  reconfigureDisplays: () => {
    ipcRenderer.send('request-reconfigure-displays');
  },

  // Listen for reconfigure request
  onReconfigureRequested: (callback) => {
    ipcRenderer.on('reconfigure-requested', callback);
  },

  // ════════════════════════════════════════════════════════════════
  // PREVIEW / CANVAS
  // ════════════════════════════════════════════════════════════════

  // Send canvas preview data
  sendPreviewData: (data) => {
    ipcRenderer.send('canvas-preview-data', data);
  },

  // Listen for preview updates
  onPreviewUpdate: (callback) => {
    ipcRenderer.on('preview-updated', (event, data) => {
      callback(data);
    });
  },

  // ════════════════════════════════════════════════════════════════
  // WINDOW INFO
  // ════════════════════════════════════════════════════════════════

  // Receive window role (public, private, clock, controller)
  onWindowRole: (callback) => {
    ipcRenderer.on('window-role', (event, role) => {
      callback(role);
    });
  },

  // Receive config after loading
  onConfigLoaded: (callback) => {
    ipcRenderer.on('config-loaded', (event, config) => {
      callback(config);
    });
  },

  // ════════════════════════════════════════════════════════════════
  // DISPLAY SELECTOR SPECIFIC
  // ════════════════════════════════════════════════════════════════

  // Selector fetches displays via request/response (no timing race, no temp file)
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Flash a number on each physical screen so the user can identify them
  identifyScreens: () => ipcRenderer.send('identify-screens'),

  // Open the in-app Help / tutorial window
  openHelp: () => ipcRenderer.send('open-help'),

  // Send log messages to main process terminal (essential for Windows debugging)
  log: (level, msg) => ipcRenderer.send('renderer-log', level, msg),

  // Selector saves configuration
  saveDisplayConfig: (displays) => {
    ipcRenderer.send('display-config-saved', displays);
  },

  // Selector closes
  closeSelector: () => {
    ipcRenderer.send('close-selector');
  },

  // Receive confirmation
  onConfigSaved: (callback) => {
    ipcRenderer.on('config-saved', callback);
  },
});

// Expose Node modules (minimal, secure set)
contextBridge.exposeInMainWorld('nodeAPI', {
  path: {
    basename: require('path').basename,
    dirname: require('path').dirname,
  },
  fs: {
    existsSync: require('fs').existsSync,
    // Read a file's bytes (used by pdf.js to load a PDF without a file:// fetch).
    readBytes: (p) => new Uint8Array(require('fs').readFileSync(p)),
  },
  platform: process.platform,
  isDebug: process.env.DEBUG === 'true',
});
