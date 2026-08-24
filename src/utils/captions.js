/**
 * Pure helpers for lyric captions drawn over the camera screen.
 *
 * No DOM or Electron dependencies so they can be unit-tested with `node --test`
 * and shared between the main process, the controller, and the camera window
 * (via preload). Mirrors the convention of zoom.js / remote.js / slideshow.js.
 *
 * Captions come from OCR of another monitor, so two things matter here that
 * don't matter for ordinary text:
 *   1. Placement must be resolution-independent — a setting tuned on a laptop
 *      has to look the same on a 4K projector, so every size is a PERCENTAGE
 *      of the screen, never a pixel count.
 *   2. The same lyric is re-read many times a second. `shouldReplace` is what
 *      stops the caption re-animating on every OCR tick.
 */

// Where the caption box sits: a 9-point grid, plus free nudging via offsetX/Y.
const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

// How a new line enters (and the old one leaves).
const ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-down', 'zoom', 'typewriter', 'cross-fade'];

// How the text is separated from the camera feed behind it.
const OUTLINES = ['none', 'shadow', 'outline', 'box'];

const ALIGNS = ['left', 'center', 'right'];

const DEFAULT_CAPTIONS = {
  position: 'bottom-center',
  offsetX: 0,       // % of screen width,  -50..50
  offsetY: 0,       // % of screen height, -50..50
  margin: 4,        // % gap from the screen edge, 0..25
  width: 80,        // caption box width, % of screen, 10..100
  fontSize: 5,      // % of screen HEIGHT, 1..20
  fontFamily: 'sans-serif',
  color: '#ffffff',
  weight: 700,
  align: 'center',
  outline: 'shadow',
  boxColor: '#000000cc',
  animation: 'fade',
  animationMs: 300, // 0..3000
  uppercase: false,
  lineHeight: 1.2,  // 0.8..2.5
};

// Anchor percentages for the grid, and the matching self-translate.
const H_ANCHOR = { left: 0, center: 50, right: 100 };
const V_ANCHOR = { top: 0, middle: 50, bottom: 100 };

/** Clamp a number into [lo, hi], falling back to `dflt` for junk input. */
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

/** Accept a CSS colour only if it looks like one, so config can't inject styles. */
function safeColor(value, dflt) {
  if (typeof value !== 'string') return dflt;
  const v = value.trim();
  // #rgb / #rgba / #rrggbb / #rrggbbaa, or a plain CSS keyword like 'white'.
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^[a-zA-Z]{3,20}$/.test(v)) return v.toLowerCase();
  return dflt;
}

/** Accept a font stack only if it's free of characters that could break out. */
function safeFont(value, dflt) {
  if (typeof value !== 'string') return dflt;
  const v = value.trim();
  if (!v || v.length > 120) return dflt;
  return /^[\w\s,'"-]+$/.test(v) ? v : dflt;
}

/**
 * Coerce anything into a complete, safe caption settings object.
 * Never throws; unknown enum values fall back to the default.
 * @param {*} input
 * @returns {object}
 */
function normalizeCaptions(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const d = DEFAULT_CAPTIONS;
  return {
    position: POSITIONS.includes(src.position) ? src.position : d.position,
    offsetX: clampNum(src.offsetX, -50, 50, d.offsetX),
    offsetY: clampNum(src.offsetY, -50, 50, d.offsetY),
    margin: clampNum(src.margin, 0, 25, d.margin),
    width: clampNum(src.width, 10, 100, d.width),
    fontSize: clampNum(src.fontSize, 1, 20, d.fontSize),
    fontFamily: safeFont(src.fontFamily, d.fontFamily),
    color: safeColor(src.color, d.color),
    weight: clampNum(src.weight, 100, 900, d.weight),
    align: ALIGNS.includes(src.align) ? src.align : d.align,
    outline: OUTLINES.includes(src.outline) ? src.outline : d.outline,
    boxColor: safeColor(src.boxColor, d.boxColor),
    animation: ANIMATIONS.includes(src.animation) ? src.animation : d.animation,
    animationMs: clampNum(src.animationMs, 0, 3000, d.animationMs),
    uppercase: !!src.uppercase,
    lineHeight: clampNum(src.lineHeight, 0.8, 2.5, d.lineHeight),
  };
}

/**
 * Split the 9-grid position into its two axes.
 * @param {string} position
 * @returns {{h: 'left'|'center'|'right', v: 'top'|'middle'|'bottom'}}
 */
function splitPosition(position) {
  const p = POSITIONS.includes(position) ? position : DEFAULT_CAPTIONS.position;
  const [v, h] = p.split('-');
  return { h, v };
}

/**
 * Percent-of-screen → the unit the caller's container actually understands.
 * With no `box`, sizes are viewport units (the caption layer is full-screen).
 * With a pixel `box`, the same settings render faithfully into a small preview.
 * @param {{width: number, height: number}} [box]
 */
function unitFns(box) {
  const bw = box && Number.isFinite(Number(box.width)) ? Number(box.width) : null;
  const bh = box && Number.isFinite(Number(box.height)) ? Number(box.height) : null;
  // Round: derived sizes (0.045 * fontSize, etc.) otherwise emit float noise
  // like "0.22499999999999998vh" into inline styles.
  const r = (n) => String(Math.round(n * 1e4) / 1e4);
  return {
    w: (pct) => (bw === null ? `${r(pct)}vw` : `${r((pct / 100) * bw)}px`),
    h: (pct) => (bh === null ? `${r(pct)}vh` : `${r((pct / 100) * bh)}px`),
  };
}

/**
 * Place a box on the 9-point grid: anchor, push in from the edge by `margin`,
 * then apply the operator's free nudge.
 *
 * Translating by the anchor percentage is what keeps 'right' flush-right and
 * 'center' truly centred whatever the box's own width turns out to be.
 *
 * Shared by captions and the logo overlay — they sit on the same grid, so the
 * corner maths lives in exactly one place. (Note this is NOT the same job as
 * `clockRect` in displayManager.js, which computes a screen-pixel WINDOW rect
 * from a size enum; this returns percentage CSS for an in-page element.)
 *
 * @param {{position: string, offsetX: number, offsetY: number, margin: number}} opts
 * @param {{width: number, height: number}} [box]
 * @returns {{left: string, top: string, transform: string}}
 */
function anchorStyles(opts, box) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const { h, v } = splitPosition(o.position);
  const margin = clampNum(o.margin, 0, 25, 0);
  const offsetX = clampNum(o.offsetX, -50, 50, 0);
  const offsetY = clampNum(o.offsetY, -50, 50, 0);
  const u = unitFns(box);

  const hAnchor = H_ANCHOR[h];
  const vAnchor = V_ANCHOR[v];
  const marginX = h === 'left' ? margin : (h === 'right' ? -margin : 0);
  const marginY = v === 'top' ? margin : (v === 'bottom' ? -margin : 0);

  // Emit a real sign rather than "+ -4vh": calc() accepts a signed operand, but
  // it's a known source of silent parse failures, so avoid producing one.
  const signed = (pct, unit) => (pct < 0 ? `- ${unit(-pct)}` : `+ ${unit(pct)}`);
  return {
    left: `calc(${hAnchor}% ${signed(marginX + offsetX, u.w)})`,
    top: `calc(${vAnchor}% ${signed(marginY + offsetY, u.h)})`,
    // "-0%" is legal but noisy; keep the common cases clean.
    transform: `translate(${hAnchor ? `-${hAnchor}%` : '0%'}, ${vAnchor ? `-${vAnchor}%` : '0%'})`,
  };
}

/**
 * Build the inline style patch for the caption box.
 * The caller does `Object.assign(el.style, captionStyles(settings))`.
 *
 * Sizes are percentages of the screen, so by default they're emitted as
 * viewport units. Pass `box` ({ width, height } in px) to render the same
 * caption scaled into a smaller element — that's how the controller's live
 * preview stays faithful without duplicating any of this maths.
 *
 * @param {*} settings
 * @param {{width: number, height: number}} [box] pixel box to render into
 * @returns {object} a style object
 */
function captionStyles(settings, box) {
  const s = normalizeCaptions(settings);
  const { w: wUnit, h: hUnit } = unitFns(box);
  const anchor = anchorStyles(s, box);

  const fontPx = hUnit(s.fontSize);
  const style = {
    position: 'absolute',
    ...anchor,
    width: `${s.width}%`,
    boxSizing: 'border-box',
    margin: '0',
    textAlign: s.align,
    color: s.color,
    fontFamily: s.fontFamily,
    fontWeight: String(s.weight),
    fontSize: fontPx,
    lineHeight: String(s.lineHeight),
    textTransform: s.uppercase ? 'uppercase' : 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    pointerEvents: 'none',
    // Reset the decorations every branch below may set, so switching outline
    // modes never leaves a stale shadow or padding behind.
    textShadow: 'none',
    WebkitTextStroke: '0',
    background: 'transparent',
    padding: '0',
    borderRadius: '0',
  };

  if (s.outline === 'shadow') {
    // Two shadows: a tight dark edge for legibility on bright video, and a
    // soft drop so the text still reads against a busy crowd shot.
    style.textShadow = `0 0 ${hUnit(s.fontSize * 0.08)} rgba(0,0,0,0.95), 0 ${hUnit(s.fontSize * 0.06)} ${hUnit(s.fontSize * 0.2)} rgba(0,0,0,0.75)`;
  } else if (s.outline === 'outline') {
    style.WebkitTextStroke = `${hUnit(s.fontSize * 0.045)} #000000`;
    style.paintOrder = 'stroke fill';
  } else if (s.outline === 'box') {
    style.background = s.boxColor;
    style.padding = `${hUnit(s.fontSize * 0.3)} ${wUnit(s.fontSize * 0.25)}`;
    style.borderRadius = hUnit(s.fontSize * 0.15);
  }

  return style;
}

/**
 * The enter/exit transform pair for the configured animation.
 *
 * Returned as plain style patches rather than CSS class names so the camera
 * window can drive them with a single `Object.assign` on each of its two
 * double-buffered caption elements — no stylesheet to keep in sync.
 *
 * @param {*} settings
 * @returns {{durationMs: number, typewriter: boolean, hidden: object, shown: object, leaving: object}}
 */
function captionAnimation(settings) {
  const s = normalizeCaptions(settings);
  const ms = s.animation === 'none' ? 0 : s.animationMs;
  const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const transition = ms > 0 ? `opacity ${ms}ms ${ease}, transform ${ms}ms ${ease}` : 'none';

  // `shown` is the resting state; `hidden` is where a line starts before it
  // enters; `leaving` is where the outgoing line goes. Cross-fade deliberately
  // reuses `shown` for both ends so the two buffers overlap without moving.
  const shift = (dy, dx = 0, scale = 1) => ({
    opacity: 0,
    transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
  });

  let hidden;
  let leaving;
  switch (s.animation) {
    case 'slide-up':
      hidden = shift(24);
      leaving = shift(-24);
      break;
    case 'slide-down':
      hidden = shift(-24);
      leaving = shift(24);
      break;
    case 'zoom':
      hidden = shift(0, 0, 0.88);
      leaving = shift(0, 0, 1.08);
      break;
    case 'cross-fade':
      hidden = { opacity: 0, transform: 'translate(0px, 0px) scale(1)' };
      leaving = { opacity: 0, transform: 'translate(0px, 0px) scale(1)' };
      break;
    case 'typewriter':
    case 'fade':
    case 'none':
    default:
      hidden = { opacity: 0, transform: 'translate(0px, 0px) scale(1)' };
      leaving = { opacity: 0, transform: 'translate(0px, 0px) scale(1)' };
      break;
  }

  return {
    durationMs: ms,
    typewriter: s.animation === 'typewriter',
    hidden: { ...hidden, transition },
    shown: { opacity: 1, transform: 'translate(0px, 0px) scale(1)', transition },
    leaving: { ...leaving, transition },
  };
}

/** Normalise a caption line for comparison: collapse whitespace, drop case. */
function compareKey(text) {
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Levenshtein distance, bounded so a pathological input can't stall the loop. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Long lines are compared by prefix — lyrics differ near the start in practice,
  // and this keeps the OCR tick cheap.
  const MAX = 200;
  const s = a.length > MAX ? a.slice(0, MAX) : a;
  const t = b.length > MAX ? b.slice(0, MAX) : b;

  let prev = new Array(t.length + 1);
  let curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[t.length];
}

/** How alike two strings are, 0..1. */
function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Should `next` replace `prev` on screen?
 *
 * OCR re-reads the same slide many times a second, and each read can wobble by
 * a character or two. Without this gate the caption would re-animate on every
 * tick, which looks broken on a big screen. Returns false for an unchanged
 * line and for near-identical noise; true for a genuinely new line, and for
 * the transitions to and from empty (so clearing the screen still works).
 *
 * @param {string} prev the line currently on screen
 * @param {string} next the line just read
 * @param {{threshold?: number}} [opts] similarity above which `next` is noise
 * @returns {boolean}
 */
function shouldReplace(prev, next, opts) {
  const a = compareKey(prev);
  const b = compareKey(next);
  if (a === b) return false;
  // Appearing or clearing is always a real change, however short the text.
  if (!a || !b) return true;

  const t = opts && Number.isFinite(Number(opts.threshold))
    ? Math.min(1, Math.max(0, Number(opts.threshold)))
    : 0.9;
  // Very short lines ("Amen" vs "Amend") are too easy to call noise by ratio,
  // so only apply the similarity gate once there's enough text to judge.
  if (a.length < 8 || b.length < 8) return true;
  return similarity(a, b) < t;
}

module.exports = {
  POSITIONS,
  ANIMATIONS,
  OUTLINES,
  ALIGNS,
  DEFAULT_CAPTIONS,
  normalizeCaptions,
  splitPosition,
  unitFns,
  anchorStyles,
  captionStyles,
  captionAnimation,
  shouldReplace,
  similarity,
};
