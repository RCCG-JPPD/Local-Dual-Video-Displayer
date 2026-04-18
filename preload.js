/**
 * Preload Script
 * Provides secure IPC bridge between renderer and main process
 * Implements context isolation security best practices
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
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

  // ════════════════════════════════════════════════════════════════
  // FILE OPERATIONS
  // ════════════════════════════════════════════════════════════════

  // Open file dialog for video selection
  selectVideoFiles: () => ipcRenderer.invoke('open-file-dialog'),

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

  // Selector requests displays list
  requestDisplays: () => {
    ipcRenderer.send('request-displays');
  },

  // Selector receives displays
  onDisplaysDetected: (callback) => {
    ipcRenderer.on('displays-detected', (event, displays) => {
      callback(displays);
    });
  },

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
