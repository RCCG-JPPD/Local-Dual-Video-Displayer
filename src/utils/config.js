/**
 * Configuration Schema
 * Defines the structure and defaults for the unified application
 */

// The camera/captions/OCR/logo/transition defaults live with the pure helpers
// that validate them, so the schema and the normalizers can never drift apart.
const { DEFAULT_CAPTIONS } = require('./captions');
const { DEFAULT_OCR } = require('./ocr');
const { DEFAULT_LOGO } = require('./logo');
const { DEFAULT_TRANSITION } = require('./transition');

module.exports = {
  // Default display configuration
  displays: [
    // Each display object contains:
    // {
    //   id: number (unique identifier from electron screen.getAllDisplays())
    //   displayIndex: number (0, 1, 2, etc)
    //   role: 'video' | 'youtube' | 'web' | 'clock' | 'powerpoint' | 'slideshow' | 'excel' | 'camera' | 'unassigned'
    //         (the same role may be assigned to several screens)
    //   clockOverlay: boolean (optional) — also float a clock widget over this
    //         screen's content (toggled live from the controller's Clock tab)
    //   label: string (e.g., "Display 1")
    //   bounds: { x, y, width, height }
    // }
  ],

  // Video/Playback settings
  playback: {
    currentPlaylistIndex: 0,
    playlist: [],
    volume: 1.0,
    loopPlaylist: false,
    mutePrivateWindow: true,
  },

  // Per-screen zoom: how media is scaled onto the screen.
  //   mode  'contain' = fit (letterboxed, upscales small media) — the default
  //         'cover'   = fill the screen and crop the overflow
  //         'native'  = intrinsic pixel size, never upscaled
  //   scale extra multiplier applied on top (0.25–4).
  // The YouTube screen is a <webview>, so only `scale` applies there.
  zoom: {
    video: { mode: 'contain', scale: 1.0 },
    slideshow: { mode: 'contain', scale: 1.0 },
    youtube: { mode: 'contain', scale: 1.0 },
    // The camera screen defaults to Fill: a crowd shot should cover the screen,
    // not sit letterboxed in the middle of it.
    camera: { mode: 'cover', scale: 1.0 },
  },

  // Controller window preferences
  controller: {
    x: null, // null = auto-position on primary display
    y: null,
    width: 1000,
    height: 700,
    alwaysOnTop: true,
    rememberedPosition: false,
  },

  // Clock display settings (a corner widget on a solid background)
  clock: {
    mode: 'time',          // 'time' | 'countdown' | 'timer'
    theme: 'dark',         // 'dark' (black bg/white text) | 'light' (white bg/black text)
    size: 'medium',        // 'tiny' | 'verysmall' | 'small' | 'medium' | 'large'
    corner: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
    showSeconds: true,
    hour12: false,         // false = 24h, true = 12h with AM/PM
    countdown: { hours: 0, minutes: 5, seconds: 0 }, // for mode 'countdown'
    targetTime: '',        // ISO datetime-local string, for mode 'timer'
    holiday: 'auto',       // 'auto' | 'off' | a holiday key (e.g. 'christmas')
    updateInterval: 1000,
  },

  // Presentation viewer (role 'powerpoint'): slides from a PDF or a set of images.
  presentation: {
    type: 'pdf',     // 'pdf' | 'images'
    source: '',      // absolute path of the PDF (type 'pdf')
    images: [],      // absolute paths of slide images (type 'images')
    index: 0,        // current slide (0-based)
    count: 0,        // total slides (pages or images)
  },

  // Media slideshow (role 'slideshow'): images + videos shown in sequence.
  slideshow: {
    items: [],       // ordered list of absolute file paths (images and videos)
    duration: 5,     // seconds each image is shown before advancing
    loop: true,      // restart from the beginning after the last item
    index: 0,        // current item (0-based)
    autoPlay: true,  // start advancing automatically
  },

  // Spreadsheet viewer (role 'excel'): a sheet rendered as an HTML table.
  spreadsheet: {
    source: '',      // absolute path of the loaded workbook
    activeSheet: 0,  // index of the visible sheet
  },

  // YouTube screen (role 'youtube'): the last loaded video URL, restored when
  // a YouTube screen is (re)created — so a video can be queued before any
  // screen has the role.
  youtube: {
    url: '',
  },

  // Web screen (role 'web'): the last mirrored page URL, restored the same way.
  web: {
    url: '',
  },

  // Camera screen (role 'camera'): a live webcam / capture-card feed.
  //
  // It runs in a TRANSPARENT always-on-top window, so fading the stage out
  // reveals whatever is running underneath (at a concert, the lyrics software).
  // `transparentWindow` is read only at window-creation time — Electron cannot
  // toggle transparency on a live window — so changing it needs a screen restart.
  camera: {
    source: 'device',        // 'device' = a local camera, 'vdo' = a VDO.Ninja stream
    deviceId: '',            // MediaDeviceInfo.deviceId; '' = system default
    deviceLabel: '',         // remembered so the picker still reads right after a restart
    live: false,             // is the feed running
    visible: true,           // false = stage faded out (the RESET state)
    mirror: false,           // flip horizontally (front-facing cameras)
    transparentWindow: true, // see above — needs a screen restart to change
    renderMode: 'video',     // 'video' | 'canvas' (compatibility fallback, see cameraDisplay.html)

    // VDO.Ninja sources: phones and other machines streaming in over WebRTC,
    // the way ../virtualcam-helper works. Up to MAX_SOURCES of them, with one
    // on air at a time. See src/utils/vdoninja.js — URLs are validated there
    // and stored with any room password stripped out.
    vdo: {
      sources: [],           // [{ id, label, url }]
      activeId: null,        // which one is on air (null = none)
      // Keep every source connected in a hidden frame so cutting between
      // cameras is instant. Costs bandwidth for streams nobody is watching;
      // turn it off on a poor connection and accept a few seconds per cut.
      preloadAll: true,
    },
  },

  // Lyric captions drawn over the camera feed (src/utils/captions.js).
  captions: { ...DEFAULT_CAPTIONS },

  // Lyric OCR: read another screen's text and re-render it as captions
  // (src/utils/ocr.js).
  ocr: { ...DEFAULT_OCR },

  // Logo / watermark drawn inside the camera screen (src/utils/logo.js).
  logo: { ...DEFAULT_LOGO },

  // How the camera stage fades in and out (src/utils/transition.js).
  transition: { ...DEFAULT_TRANSITION },

  // Remote Mode (phone/web control) pairing code.
  remote: {
    persistCode: false, // opt-in: reuse the same pairing code across app runs
    code: '',           // the saved code (only meaningful when persistCode is on)
  },

  // Canvas preview settings
  preview: {
    enabled: true,
    updateInterval: 500, // ms - send canvas updates this frequently
    previewSize: {
      width: 200,
      height: 150,
    },
    quality: 0.7, // JPEG quality for compressed preview
  },

  // Application metadata
  version: '2.0.0',
  lastModified: null,
};
