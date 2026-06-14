/**
 * Preload Script
 * Provides secure IPC bridge between renderer and main process
 * Implements context isolation security best practices
 */

const { contextBridge, ipcRenderer } = require('electron');
const { extractVideoId } = require('./src/utils/youtube');
const { normalizeUrl } = require('./src/utils/weburl');
const { formatClock, formatDuration, secondsUntil } = require('./src/utils/clockformat');
const { getActiveHoliday, HOLIDAY_KEYS, ANIMATIONS } = require('./src/utils/holidays');
const { THEMES, resolveTheme } = require('./src/utils/clockThemes');

// Expose safe IPC APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ════════════════════════════════════════════════════════════════
  // PURE HELPERS (shared with unit tests via src/utils/*)
  // ════════════════════════════════════════════════════════════════

  extractYouTubeId: (urlOrId) => extractVideoId(urlOrId),
  normalizeWebUrl: (url) => normalizeUrl(url),

  // Clock helpers (formatting + holiday calendar)
  formatClock: (date, opts) => formatClock(date, opts),
  formatDuration: (s) => formatDuration(s),
  secondsUntil: (target, now) => secondsUntil(target, now),
  getActiveHoliday: (date) => getActiveHoliday(date),
  holidayList: () => HOLIDAY_KEYS,
  animationList: () => ANIMATIONS,
  clockThemes: () => THEMES,
  resolveClockTheme: (themeKey, holidayKey) => resolveTheme(themeKey, holidayKey),

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

  // Clock screens listen for live settings updates
  onClockSettings: (callback) => {
    ipcRenderer.on('clock-settings', (event, settings) => callback(settings));
  },

  // ════════════════════════════════════════════════════════════════
  // SCREEN PREVIEWS (identify which physical screen is which)
  // ════════════════════════════════════════════════════════════════

  // Returns [{ id, dataURL }] thumbnails of each physical display's contents
  getScreenPreviews: () => ipcRenderer.invoke('get-screen-previews'),

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
  },
  platform: process.platform,
  isDebug: process.env.DEBUG === 'true',
});
