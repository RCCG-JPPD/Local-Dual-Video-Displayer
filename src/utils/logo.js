/**
 * Pure helpers for the logo / watermark drawn over the camera screen.
 *
 * The logo lives inside the camera window's DOM rather than in its own overlay
 * window (the way the clock does). That is deliberate: the clock needs a
 * separate window because it floats over <webview> screens, which DOM cannot
 * paint over — but the camera screen is our own DOM with a plain <video>, and
 * an in-page logo composites correctly with the captions AND fades out with the
 * stage on reset. A separate window would stubbornly stay visible during the
 * one moment the operator most needs the screen clear.
 *
 * Placement shares the 9-point grid maths with captions.js, so a logo and a
 * caption asked to sit in the same corner genuinely land in the same place.
 */

const { POSITIONS, anchorStyles, unitFns } = require('./captions');

const DEFAULT_LOGO = {
  enabled: false,
  source: '',        // absolute path to an image; '' = nothing to show
  position: 'top-right',
  offsetX: 0,        // % of screen, -50..50 (free nudge on top of the margin)
  offsetY: 0,
  margin: 3,         // % gap from the screen edge, 0..25
  size: 12,          // width as a % of screen WIDTH, 1..100
  opacity: 0.9,      // 0..1
};

function clampNum(value, lo, hi, dflt) {
  // Number(null), Number('') and Number([]) are all 0, so a null in a
  // hand-edited config would silently become a real setting. Only genuine
  // numbers and numeric strings (sliders emit strings) count.
  if (typeof value !== 'number' && typeof value !== 'string') return dflt;
  if (typeof value === 'string' && value.trim() === '') return dflt;
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Coerce anything into a complete, safe logo settings object.
 * @param {*} input
 * @returns {object}
 */
function normalizeLogo(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const d = DEFAULT_LOGO;
  return {
    enabled: !!src.enabled,
    source: typeof src.source === 'string' ? src.source : d.source,
    position: POSITIONS.includes(src.position) ? src.position : d.position,
    offsetX: clampNum(src.offsetX, -50, 50, d.offsetX),
    offsetY: clampNum(src.offsetY, -50, 50, d.offsetY),
    margin: clampNum(src.margin, 0, 25, d.margin),
    size: clampNum(src.size, 1, 100, d.size),
    opacity: clampNum(src.opacity, 0, 1, d.opacity),
  };
}

/**
 * Build the inline style patch for the logo <img>.
 * The caller does `Object.assign(img.style, logoStyles(logo))`.
 *
 * Height is `auto` so a transparent PNG keeps its aspect ratio — only the
 * width is driven, as a percentage of the screen, so the logo looks identical
 * on a laptop and on a 4K projector.
 *
 * @param {*} logo
 * @param {{width: number, height: number}} [box] pixel box, for a scaled preview
 * @returns {object} a style object
 */
function logoStyles(logo, box) {
  const l = normalizeLogo(logo);
  const u = unitFns(box);
  return {
    position: 'absolute',
    ...anchorStyles(l, box),
    width: u.w(l.size),
    height: 'auto',
    opacity: String(l.opacity),
    // A logo is decoration: it must never eat a click meant for the app behind.
    pointerEvents: 'none',
    // Visibility is driven here rather than by adding/removing the element, so
    // toggling it can be animated by the stage's transition like everything else.
    display: l.enabled && l.source ? 'block' : 'none',
  };
}

module.exports = {
  DEFAULT_LOGO,
  LOGO_POSITIONS: POSITIONS,
  normalizeLogo,
  logoStyles,
};
