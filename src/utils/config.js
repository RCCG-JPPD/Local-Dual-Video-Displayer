/**
 * Configuration Schema
 * Defines the structure and defaults for the unified application
 */

module.exports = {
  // Default display configuration
  displays: [
    // Each display object contains:
    // {
    //   id: string (unique identifier from electron screen.getAllDisplays())
    //   displayIndex: number (0, 1, 2, etc)
    //   role: 'public' | 'private' | 'clock' | 'controller' | 'unassigned'
    //   label: string (e.g., "Display 1 - Public Screen")
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

  // Clock display settings
  clock: {
    enabled: true,
    format: '24h', // '12h' or '24h'
    updateInterval: 1000, // milliseconds
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
