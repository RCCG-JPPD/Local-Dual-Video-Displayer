/**
 * Canvas Preview Manager
 * Handles real-time canvas mirroring for display windows
 * Sends preview images to controller for live monitoring
 */

class CanvasPreviewManager {
  constructor() {
    this.previewIntervals = {};
    this.config = {
      enabled: true,
      updateInterval: 500, // ms
      previewSize: { width: 200, height: 150 },
      quality: 0.7,
    };
  }

  /**
   * Set up canvas preview capture for a display window
   * Call this from the display window (video or clock)
   */
  startPreviewCapture(windowId, canvasElementId, updateInterval) {
    if (this.previewIntervals[windowId]) {
      console.warn(`Preview capture already running for window ${windowId}`);
      return;
    }

    const interval = updateInterval || this.config.updateInterval;

    this.previewIntervals[windowId] = setInterval(() => {
      this.captureCanvasFrame(canvasElementId, windowId);
    }, interval);

    console.log(`Preview capture started for window ${windowId}`);
  }

  /**
   * Stop preview capture for a window
   */
  stopPreviewCapture(windowId) {
    if (this.previewIntervals[windowId]) {
      clearInterval(this.previewIntervals[windowId]);
      delete this.previewIntervals[windowId];
      console.log(`Preview capture stopped for window ${windowId}`);
    }
  }

  /**
   * Capture a canvas frame and send to controller
   * Must be called from renderer process
   */
  static captureAndSend(canvasElement, windowInfo) {
    try {
      if (!canvasElement) {
        console.warn('Canvas element not found for preview capture');
        return;
      }

      const ctx = canvasElement.getContext('2d');
      if (!ctx) {
        console.warn('Could not get canvas context');
        return;
      }

      // Create a smaller canvas for preview (bandwidth optimization)
      const previewWidth = 200;
      const previewHeight = 150;
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = previewWidth;
      previewCanvas.height = previewHeight;

      const previewCtx = previewCanvas.getContext('2d');
      previewCtx.drawImage(canvasElement, 0, 0, canvasElement.width, canvasElement.height, 0, 0, previewWidth, previewHeight);

      // Convert to JPEG for smaller file size
      const imageData = previewCanvas.toDataURL('image/jpeg', 0.7);

      // Send to main process via IPC
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('canvas-preview-data', {
        windowRole: windowInfo.role,
        imageData: imageData,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error capturing canvas for preview:', error);
    }
  }

  /**
   * Helper for capturing canvas (synchronous version for use in intervals)
   */
  captureCanvasFrame(canvasElementId, windowId) {
    try {
      const canvas = document.getElementById(canvasElementId);
      if (canvas) {
        CanvasPreviewManager.captureAndSend(canvas, { windowId });
      }
    } catch (error) {
      console.error(`Error capturing canvas frame for window ${windowId}:`, error);
    }
  }

  /**
   * Set preview quality/size preferences
   */
  setConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current preview configuration
   */
  getConfig() {
    return { ...this.config };
  }
}

module.exports = CanvasPreviewManager;
