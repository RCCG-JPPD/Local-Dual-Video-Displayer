/**
 * Pure helpers for reading lyrics off another screen with OCR.
 *
 * No DOM or Electron dependencies so they can be unit-tested with `node --test`
 * and shared between the main process (which runs the OCR loop) and the
 * controller (which draws the region picker). Mirrors zoom.js / captions.js.
 *
 * The hard problem here is not recognition, it's STABILITY. The same lyric
 * slide is re-read several times a second, and each read can wobble by a
 * character or two ("HOLY IS THE LORD" / "HOLY 1S THE LORD"). Naively pushing
 * every read to the screen would re-animate the caption constantly, which looks
 * broken to an audience. `reduceOcr` is the state machine that turns a noisy
 * stream of reads into the handful of caption changes that actually happened.
 */

const { similarity } = require('./captions');

// The region is stored as FRACTIONS of the source screen (0..1), never pixels,
// so a resolution change on the lyrics machine doesn't invalidate a region the
// operator tuned during rehearsal.
const DEFAULT_REGION = { x: 0.08, y: 0.72, w: 0.84, h: 0.24 };

// A region smaller than this is almost certainly a stray click, not a drag.
const MIN_REGION = 0.01;

const DEFAULT_OCR = {
  enabled: false,
  displayId: null,      // electron display.id of the screen to read
  region: { ...DEFAULT_REGION },
  intervalMs: 700,      // 200..5000
  minConfidence: 55,    // 0..100, mean word confidence from Tesseract
  confirmReads: 2,      // identical reads required before a line goes live
  blankReads: 2,        // empty reads required before the caption is cleared
  similarity: 0.85,     // 0..1 - above this, two reads are "the same line"
  maxChars: 240,
  psm: 6,               // Tesseract page-seg mode; 6 = uniform block of text
  outputToScreen: true, // false = monitor in the controller only (rehearsal)
};

/** The reducer's starting state. Treat as immutable. */
const EMPTY_OCR_STATE = Object.freeze({
  candidate: '', // the line we're waiting to confirm
  hits: 0,       // how many consecutive reads have agreed with it
  shown: '',     // what is currently on screen
  blanks: 0,     // consecutive empty reads
});

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
 * Coerce a region into a valid `{ x, y, w, h }` in 0..1.
 *
 * Handles a drag made right-to-left or bottom-to-top (which arrives as a
 * negative width or height) by flipping it, then clamps the whole rect inside
 * the screen. Never returns a zero-area region - an empty crop would make
 * Tesseract throw rather than simply read nothing.
 *
 * @param {*} region
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function normalizeRegion(region) {
  const src = (region && typeof region === 'object') ? region : {};
  let x = clampNum(src.x, -1, 1, DEFAULT_REGION.x);
  let y = clampNum(src.y, -1, 1, DEFAULT_REGION.y);
  let w = clampNum(src.w, -1, 1, DEFAULT_REGION.w);
  let h = clampNum(src.h, -1, 1, DEFAULT_REGION.h);

  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }

  x = Math.min(1 - MIN_REGION, Math.max(0, x));
  y = Math.min(1 - MIN_REGION, Math.max(0, y));
  w = Math.min(1 - x, Math.max(MIN_REGION, w));
  h = Math.min(1 - y, Math.max(MIN_REGION, h));

  return { x, y, w, h };
}

/**
 * Coerce anything into complete, safe OCR settings.
 * @param {*} input
 * @returns {object}
 */
function normalizeOcr(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const d = DEFAULT_OCR;
  // Same trap as clampNum: Number(null) is 0, and 0 looks like a real display id.
  const rawId = src.displayId;
  const id = (typeof rawId === 'number' || (typeof rawId === 'string' && rawId.trim() !== ''))
    ? Number(rawId)
    : NaN;
  return {
    enabled: !!src.enabled,
    displayId: Number.isFinite(id) ? id : d.displayId,
    region: normalizeRegion(src.region),
    intervalMs: Math.round(clampNum(src.intervalMs, 200, 5000, d.intervalMs)),
    minConfidence: clampNum(src.minConfidence, 0, 100, d.minConfidence),
    confirmReads: Math.round(clampNum(src.confirmReads, 1, 10, d.confirmReads)),
    blankReads: Math.round(clampNum(src.blankReads, 1, 10, d.blankReads)),
    similarity: clampNum(src.similarity, 0, 1, d.similarity),
    maxChars: Math.round(clampNum(src.maxChars, 10, 2000, d.maxChars)),
    psm: Math.round(clampNum(src.psm, 0, 13, d.psm)),
    outputToScreen: src.outputToScreen === undefined ? d.outputToScreen : !!src.outputToScreen,
  };
}

/**
 * Fractions -> an integer pixel rect suitable for `nativeImage.crop()`.
 * Crop throws on an out-of-bounds rect, so every edge is clamped and the
 * result is guaranteed at least 1x1 inside `bounds`.
 *
 * @param {*} region fractions of the screen
 * @param {{width: number, height: number}} bounds the captured image's size
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function regionToPixels(region, bounds) {
  const r = normalizeRegion(region);
  const bw = Math.max(1, Math.floor(clampNum(bounds && bounds.width, 1, 1e5, 1)));
  const bh = Math.max(1, Math.floor(clampNum(bounds && bounds.height, 1, 1e5, 1)));

  const x = Math.min(bw - 1, Math.max(0, Math.floor(r.x * bw)));
  const y = Math.min(bh - 1, Math.max(0, Math.floor(r.y * bh)));
  const width = Math.min(bw - x, Math.max(1, Math.round(r.w * bw)));
  const height = Math.min(bh - y, Math.max(1, Math.round(r.h * bh)));

  return { x, y, width, height };
}

/**
 * The inverse: a pixel rect from the region-picker drag -> stored fractions.
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {{width: number, height: number}} bounds
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function pixelsToRegion(rect, bounds) {
  const src = (rect && typeof rect === 'object') ? rect : {};
  const bw = Math.max(1, Number(bounds && bounds.width) || 1);
  const bh = Math.max(1, Number(bounds && bounds.height) || 1);
  return normalizeRegion({
    x: Number(src.x) / bw,
    y: Number(src.y) / bh,
    w: Number(src.width) / bw,
    h: Number(src.height) / bh,
  });
}

// Control characters Tesseract occasionally emits, minus the newlines we split
// on. Written as escapes so the source file stays plain ASCII.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Tidy a raw Tesseract result into something worth putting on a screen.
 *
 * Tesseract emits per-line newlines, stray control characters, and isolated
 * punctuation where it saw a graphic. Blank lines are dropped, real line breaks
 * inside the lyric are KEPT (a two-line lyric should stay two lines), and the
 * whole thing is capped so a mis-aimed region can't dump a paragraph on stage.
 *
 * @param {*} raw
 * @param {number} [maxChars]
 * @returns {string}
 */
function cleanOcrText(raw, maxChars) {
  if (typeof raw !== 'string') return '';
  const cap = Math.round(clampNum(maxChars, 10, 2000, DEFAULT_OCR.maxChars));

  const lines = raw
    .replace(CONTROL_CHARS, ' ')
    .split('\n')
    // Collapse horizontal whitespace (spaces, tabs, non-breaking spaces).
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    // Drop the lines Tesseract produces for a border, a rule, or the edge of a
    // graphic: nothing but punctuation, or a single stray character.
    .filter(line => line && /[\p{L}\p{N}]/u.test(line))
    .filter(line => line.replace(/[^\p{L}\p{N}]/gu, '').length > 1);

  const text = lines.join('\n').trim();
  return text.length > cap ? text.slice(0, cap).trim() : text;
}

/** Case- and whitespace-insensitive form used for all read comparisons. */
function normalizeForCompare(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Fold one OCR read into the caption state.
 *
 * This is the anti-flicker brain, and it is pure so it can be tested without an
 * Electron window or a camera. Given the previous state and a new sample it
 * returns the next state plus what (if anything) the screen should now show:
 *
 *   emit === null  ->  nothing changed; do NOT touch the caption
 *   emit === ''    ->  clear the caption
 *   emit === '...' ->  show this new line
 *
 * The rules, in order:
 *  - a read below `minConfidence` carries no information, so it is ignored
 *    entirely - it neither confirms a line nor counts towards clearing one;
 *  - an empty read only clears the caption after `blankReads` in a row, so a
 *    single dropped frame during a slide change doesn't blank the screen;
 *  - a read matching what's already shown (within `similarity`) emits null -
 *    this is what stops the caption re-animating on every tick;
 *  - a genuinely new line must be seen `confirmReads` times in a row before it
 *    goes live, so a half-rendered slide transition is never shown.
 *
 * `state` is never mutated.
 *
 * @param {object} state previous state (start from EMPTY_OCR_STATE)
 * @param {{text: string, confidence: number}} sample
 * @param {*} opts OCR settings (normalized internally)
 * @returns {{state: object, emit: (string|null)}}
 */
function reduceOcr(state, sample, opts) {
  const o = normalizeOcr(opts);
  const prev = (state && typeof state === 'object') ? state : EMPTY_OCR_STATE;
  const s = {
    candidate: typeof prev.candidate === 'string' ? prev.candidate : '',
    hits: Number.isFinite(Number(prev.hits)) ? Number(prev.hits) : 0,
    shown: typeof prev.shown === 'string' ? prev.shown : '',
    blanks: Number.isFinite(Number(prev.blanks)) ? Number(prev.blanks) : 0,
  };

  const raw = (sample && typeof sample === 'object') ? sample : {};
  const text = cleanOcrText(raw.text, o.maxChars);
  const confidence = Number(raw.confidence);

  // Nothing readable is on the screen. That is NOT the same as "no characters
  // came back": a blanked projector still yields stray marks - measured off a
  // real blank screen as "re" at confidence 9 - and treating those as a
  // low-confidence line meant `blanks` never advanced, `blankReads` was
  // unreachable, and the last lyric stayed burned over the camera for the rest
  // of the service. Anything under half of minConfidence is the recogniser's
  // noise floor rather than a hard-to-read line: genuine but marginal text
  // scores in the 40s, noise off an empty screen scores under 15.
  const noise = Number.isFinite(confidence) && confidence < o.minConfidence / 2;
  if (!text || noise) {
    const blanks = s.blanks + 1;
    // Only clear once we're sure the screen really is empty.
    if (blanks >= o.blankReads && s.shown !== '') {
      return { state: { candidate: '', hits: 0, shown: '', blanks }, emit: '' };
    }
    return { state: { ...s, candidate: '', hits: 0, blanks }, emit: null };
  }

  // Readable characters, but not confidently enough to put on a screen. Hold
  // what is showing rather than flickering on a guess - and do NOT count this
  // as a blank, or a hard-to-read background would clear a lyric that is still
  // being projected.
  if (!Number.isFinite(confidence) || confidence < o.minConfidence) {
    return { state: s, emit: null };
  }

  const key = normalizeForCompare(text);

  // Already showing this line (allowing for OCR wobble): nothing to do.
  if (s.shown && similarity(key, normalizeForCompare(s.shown)) >= o.similarity) {
    return { state: { ...s, candidate: '', hits: 0, blanks: 0 }, emit: null };
  }

  // Agreeing with the pending candidate confirms it; disagreeing restarts it.
  const agrees = !!s.candidate
    && similarity(key, normalizeForCompare(s.candidate)) >= o.similarity;
  const hits = agrees ? s.hits + 1 : 1;

  if (hits >= o.confirmReads) {
    return { state: { candidate: '', hits: 0, shown: text, blanks: 0 }, emit: text };
  }
  return { state: { candidate: text, hits, shown: s.shown, blanks: 0 }, emit: null };
}

module.exports = {
  DEFAULT_OCR,
  DEFAULT_REGION,
  MIN_REGION,
  EMPTY_OCR_STATE,
  normalizeOcr,
  normalizeRegion,
  regionToPixels,
  pixelsToRegion,
  cleanOcrText,
  reduceOcr,
};
