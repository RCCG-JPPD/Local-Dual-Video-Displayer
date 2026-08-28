/**
 * Pure helpers for the camera screen's fade transitions.
 *
 * No DOM or Electron dependencies so they can be unit-tested with `node --test`
 * and shared via preload. Mirrors the convention of zoom.js / captions.js.
 *
 * The camera window is created TRANSPARENT, so fading its stage to opacity 0
 * reveals whatever application is running underneath (at a concert, that's
 * Worship Him Power Edition). That is the "reset" the operator reaches for when
 * the camera feed needs to get out of the way — so `transitionMs` is also the
 * delay after which it's safe to stop the camera tracks.
 */

const TRANSITION_TYPES = ['cut', 'fade', 'crossfade'];
const EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];

const MIN_MS = 0;
const MAX_MS = 5000;

const DEFAULT_TRANSITION = { type: 'fade', durationMs: 600, easing: 'ease-in-out' };

/**
 * Coerce anything into a safe `{ type, durationMs, easing }`.
 * @param {*} input
 * @returns {{type: string, durationMs: number, easing: string}}
 */
function normalizeTransition(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const d = DEFAULT_TRANSITION;
  // Number(null) and Number('') are both 0, which would silently turn a null
  // in a hand-edited config into an instant cut. Only real numbers and
  // numeric strings (sliders emit strings) count.
  const raw = src.durationMs;
  const usable = (typeof raw === 'number')
    || (typeof raw === 'string' && raw.trim() !== '');
  const n = usable ? Number(raw) : NaN;
  return {
    type: TRANSITION_TYPES.includes(src.type) ? src.type : d.type,
    durationMs: Number.isFinite(n) ? Math.min(MAX_MS, Math.max(MIN_MS, Math.round(n))) : d.durationMs,
    easing: EASINGS.includes(src.easing) ? src.easing : d.easing,
  };
}

/**
 * The effective duration in ms. 'cut' is always instant, whatever the slider
 * says — callers use this both for CSS and for timing the post-fade cleanup,
 * so the two can never disagree.
 * @param {*} transition
 * @returns {number}
 */
function transitionMs(transition) {
  const t = normalizeTransition(transition);
  return t.type === 'cut' ? 0 : t.durationMs;
}

/**
 * Build the `transition` style patch for the animated element.
 * @param {*} transition
 * @param {string[]} [props] CSS properties to animate (default: opacity)
 * @returns {{transition: string}}
 */
function transitionStyles(transition, props) {
  const t = normalizeTransition(transition);
  const ms = transitionMs(t);
  if (ms === 0) return { transition: 'none' };
  const list = Array.isArray(props) && props.length ? props : ['opacity'];
  return { transition: list.map(p => `${p} ${ms}ms ${t.easing}`).join(', ') };
}

/**
 * The full style patch for showing or hiding the camera stage.
 * The caller does `Object.assign(stage.style, fadeStyles(t, visible))`.
 * @param {*} transition
 * @param {boolean} visible
 * @returns {object}
 */
function fadeStyles(transition, visible) {
  return { ...transitionStyles(transition), opacity: visible ? '1' : '0' };
}

module.exports = {
  TRANSITION_TYPES,
  EASINGS,
  MIN_MS,
  MAX_MS,
  DEFAULT_TRANSITION,
  normalizeTransition,
  transitionMs,
  transitionStyles,
  fadeStyles,
};
