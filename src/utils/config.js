/**
 * Configuration Schema
 * Defines the structure and defaults for the unified application
 */

module.exports = {
  // Default display configuration
  displays: [
    // Each display object contains:
    // {
    //   id: number (unique identifier from electron screen.getAllDisplays())
    //   displayIndex: number (0, 1, 2, etc)
    //   role: 'video' | 'youtube' | 'web' | 'clock' | 'powerpoint' | 'slideshow' | 'excel' | 'unassigned'
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
