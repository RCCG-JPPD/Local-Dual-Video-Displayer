/**
 * Pure helpers for screen zoom (how media is scaled onto a display screen).
 *
 * No DOM or Electron dependencies so they can be unit-tested with `node --test`
 * and shared between the main process, the controller, and the display windows
 * (via preload). Mirrors the convention of remote.js / slideshow.js / youtube.js.
 *
 * A zoom is `{ mode, scale }`:
 *   'contain' → Fit:  whole frame visible, letterboxed. Upscales small media.
 *   'cover'   → Fill: fills the screen, cropping whatever overflows.
 *   'native'  → 100%: intrinsic pixel size, never upscaled.
 * `scale` is a multiplier applied on top of the mode via a CSS transform.
 */

const ZOOM_MODES = ['contain', 'cover', 'native'];

// UI slider range is 0.5–3; the clamp is wider so a hand-edited config or an
// older remote can't be rejected outright, only pulled back to something sane.
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

const DEFAULT_ZOOM = { mode: 'contain', scale: 1 };

// Named presets behind the Fit / Fill / 100% buttons.
const ZOOM_PRESETS = {
  fit: { mode: 'contain', scale: 1 },
  fill: { mode: 'cover', scale: 1 },
  native: { mode: 'native', scale: 1 },
};

/**
 * Coerce anything into a safe `{ mode, scale }`. Unknown modes fall back to
 * 'contain' and non-finite scales to 1, so a malformed payload can never end up
 * in the config file or on a screen.
 * @param {*} input
 * @returns {{mode: string, scale: number}}
 */
function normalizeZoom(input) {
  if (!input || typeof input !== 'object') return { ...DEFAULT_ZOOM };
  const mode = ZOOM_MODES.includes(input.mode) ? input.mode : DEFAULT_ZOOM.mode;
  const n = Number(input.scale);
  const scale = Number.isFinite(n) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, n)) : DEFAULT_ZOOM.scale;
  return { mode, scale };
}

/**
 * Build the inline style patch for a media element (<video> / <img>).
 * The caller does `Object.assign(el.style, zoomStyles(z))`.
 *
 * 'native' keeps the old max-width/height behaviour (shrink-to-fit only), while
 * contain/cover set explicit 100% box sizing so object-fit can scale small media
 * UP to the screen — the fix for tiny videos sitting in the middle of a screen.
 * @param {*} zoom
 * @returns {object} a style object
 */
function zoomStyles(zoom) {
  const { mode, scale } = normalizeZoom(zoom);
  const box = mode === 'native'
    ? { width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
    : { width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', objectFit: mode };
  return { ...box, transform: `scale(${scale})`, transformOrigin: 'center center' };
}

module.exports = {
  ZOOM_MODES,
  ZOOM_PRESETS,
  DEFAULT_ZOOM,
  MIN_SCALE,
  MAX_SCALE,
  normalizeZoom,
  zoomStyles,
};
