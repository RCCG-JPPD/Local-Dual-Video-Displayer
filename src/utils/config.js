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
    //   role: 'video' | 'youtube' | 'web' | 'clock' | 'unassigned'
    //         (the same role may be assigned to several screens)
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
    size: 'medium',        // 'small' | 'medium' | 'large'
    corner: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
    showSeconds: true,
    hour12: false,         // false = 24h, true = 12h with AM/PM
    countdown: { hours: 0, minutes: 5, seconds: 0 }, // for mode 'countdown'
    targetTime: '',        // ISO datetime-local string, for mode 'timer'
    holiday: 'auto',       // 'auto' | 'off' | a holiday key (e.g. 'christmas')
    updateInterval: 1000,
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
