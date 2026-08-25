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
const zoomUtil = require('./src/utils/zoom');
const captionsUtil = require('./src/utils/captions');
const transitionUtil = require('./src/utils/transition');
const logoUtil = require('./src/utils/logo');
const ocrUtil = require('./src/utils/ocr');
const vdoUtil = require('./src/utils/vdoninja');

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
    // Invalidate the code and get a fresh one (persisted too, when opted in).
    resetCode: () => ipcRenderer.invoke('remote-reset-code'),
    // Opt in/out of keeping the same code across app runs (off by default).
    setPersist: (on) => ipcRenderer.invoke('remote-set-persist', !!on),
  },

  // Screen zoom pure helpers (src/utils/zoom.js). Display windows apply the
  // returned style patch with Object.assign(el.style, electronAPI.zoom.styles(z)).
  zoom: {
    normalize: (z) => zoomUtil.normalizeZoom(z),
    styles: (z) => zoomUtil.zoomStyles(z),
    PRESETS: zoomUtil.ZOOM_PRESETS,
    MIN_SCALE: zoomUtil.MIN_SCALE,
    MAX_SCALE: zoomUtil.MAX_SCALE,
  },

  // Lyric caption pure helpers (src/utils/captions.js). The camera screen does
  // Object.assign(el.style, electronAPI.captions.styles(settings)); the
  // controller uses the same call with a pixel box for its live preview.
  captions: {
    normalize: (c) => captionsUtil.normalizeCaptions(c),
    styles: (c, box) => captionsUtil.captionStyles(c, box),
    animation: (c) => captionsUtil.captionAnimation(c),
    // The guard that stops an unchanged lyric re-animating on every OCR tick.
    shouldReplace: (prev, next, opts) => captionsUtil.shouldReplace(prev, next, opts),
    POSITIONS: captionsUtil.POSITIONS,
    ANIMATIONS: captionsUtil.ANIMATIONS,
    OUTLINES: captionsUtil.OUTLINES,
    ALIGNS: captionsUtil.ALIGNS,
    DEFAULTS: captionsUtil.DEFAULT_CAPTIONS,
  },

  // Camera stage fade helpers (src/utils/transition.js). `ms` is the same
  // number the CSS uses, so a caller timing work to the end of a fade can
  // never disagree with the animation.
  transition: {
    normalize: (t) => transitionUtil.normalizeTransition(t),
    styles: (t, visible) => transitionUtil.fadeStyles(t, visible),
    ms: (t) => transitionUtil.transitionMs(t),
    TYPES: transitionUtil.TRANSITION_TYPES,
    EASINGS: transitionUtil.EASINGS,
    DEFAULTS: transitionUtil.DEFAULT_TRANSITION,
  },

  // Logo overlay pure helpers (src/utils/logo.js).
  logo: {
    normalize: (l) => logoUtil.normalizeLogo(l),
    styles: (l, box) => logoUtil.logoStyles(l, box),
    POSITIONS: logoUtil.LOGO_POSITIONS,
    DEFAULTS: logoUtil.DEFAULT_LOGO,
  },

  // OCR pure helpers (src/utils/ocr.js). The controller needs the region maths
  // for its drag-a-box picker; the OCR loop itself runs in the main process.
  ocr: {
    normalize: (o) => ocrUtil.normalizeOcr(o),
    normalizeRegion: (r) => ocrUtil.normalizeRegion(r),
    regionToPixels: (r, bounds) => ocrUtil.regionToPixels(r, bounds),
    pixelsToRegion: (rect, bounds) => ocrUtil.pixelsToRegion(rect, bounds),
    cleanText: (raw, max) => ocrUtil.cleanOcrText(raw, max),
    DEFAULTS: ocrUtil.DEFAULT_OCR,
  },

  // VDO.Ninja pure helpers (src/utils/vdoninja.js). `validate` throws an
  // InvalidUrlError whose .message/.hint are written for an operator, so the
  // controller can show them directly.
  vdoninja: {
    validate: (url, hosts) => vdoUtil.validateAndNormalizeUrl(url, hosts),
    isValid: (url, hosts) => vdoUtil.isValidUrl(url, hosts),
    sanitize: (url) => vdoUtil.sanitizeUrlForStorage(url),
    label: (url) => vdoUtil.labelForUrl(url),
    normalize: (v) => vdoUtil.normalizeVdo(v),
    activeSource: (v) => vdoUtil.activeSource(v),
    MAX_SOURCES: vdoUtil.MAX_SOURCES,
    ALLOWED_HOSTS: vdoUtil.DEFAULT_ALLOWED_HOSTS,
  },

  // ════════════════════════════════════════════════════════════════
  // CAMERA SCREEN / CAPTIONS / LOGO
  // ════════════════════════════════════════════════════════════════

  // Controller → every camera screen.
  // cmd: live | setDevice | setZoom | mirror | setRenderMode | reset |
  //      restore | blank | rescanDevices
  sendCameraCommand: (cmd, data) => ipcRenderer.send('camera-command', cmd, data),
  onCameraCommand: (cb) => ipcRenderer.on('camera-command', (e, cmd, data) => cb(cmd, data)),

  // Camera screen → controller: whether the feed is actually running, and why
  // not when it isn't (device in use, permission denied, unplugged).
  sendCameraStatus: (status) => ipcRenderer.send('camera-status', status),
  onCameraStatus: (cb) => ipcRenderer.on('camera-status', (e, status) => cb(status)),

  // The camera screen holds the media permission, so it is what can actually
  // enumerate devices; the controller just renders the list it reports.
  sendCameraDevices: (devices) => ipcRenderer.send('camera-devices', devices),
  onCameraDevices: (cb) => ipcRenderer.on('camera-devices', (e, devices) => cb(devices)),

  // Fired when the camera screen is cleared by the global panic shortcut, so
  // the controller's UI matches even though it wasn't the focused window.
  onCameraReset: (cb) => ipcRenderer.on('camera-reset', () => cb()),

  // Rebuild the camera screens. Needed because Electron fixes a window's
  // transparency at creation time, so that setting can only change this way.
  recreateCameraScreens: () => ipcRenderer.send('camera-recreate'),

  sendCaptionSettings: (settings) => ipcRenderer.send('caption-settings', settings),
  onCaptionSettings: (cb) => ipcRenderer.on('caption-settings', (e, settings) => cb(settings)),

  // One channel for every caption line, whether it came from OCR or was typed
  // in the controller — so the caption layer can be built and tested before any
  // OCR exists.
  sendCaptionText: (text) => ipcRenderer.send('caption-text', { text, source: 'manual' }),
  onCaptionText: (cb) => ipcRenderer.on('caption-text', (e, payload) => cb(payload)),

  sendLogoSettings: (settings) => ipcRenderer.send('logo-settings', settings),
  onLogoSettings: (cb) => ipcRenderer.on('logo-settings', (e, settings) => cb(settings)),
  selectLogoFile: () => ipcRenderer.invoke('select-logo-file'),

  sendTransitionSettings: (settings) => ipcRenderer.send('transition-settings', settings),
  onTransitionSettings: (cb) => ipcRenderer.on('transition-settings', (e, s) => cb(s)),

  // ════════════════════════════════════════════════════════════════
  // LYRIC OCR
  // ════════════════════════════════════════════════════════════════

  // cmd: start | stop | setRegion | setTuning | setOutput | once
  sendOcrCommand: (cmd, data) => ipcRenderer.send('ocr-command', cmd, data),
  // Last read, its confidence and any error — the controller's tuning readout.
  onOcrStatus: (cb) => ipcRenderer.on('ocr-status', (e, status) => cb(status)),
  getOcrState: () => ipcRenderer.invoke('ocr-get-state'),
  // A full still of one screen, for the drag-a-box region picker.
  captureScreenFrame: (opts) => ipcRenderer.invoke('ocr-capture-frame', opts),

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

  // Persist the controller's playlist after edits (remove / clear) so it
  // matches on the next run — additions are persisted by the file dialog.
  savePlaylist: (playlist) => ipcRenderer.send('save-playlist', playlist),

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
