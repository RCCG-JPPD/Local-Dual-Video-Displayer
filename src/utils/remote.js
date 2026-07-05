/**
 * Pure helpers for Remote Mode (Firebase-based phone/web presentation control).
 *
 * These have NO Firebase or DOM dependencies so they can be unit-tested with
 * `node --test` and shared between the Electron controller (via preload) and the
 * web controller app. Mirrors the convention of youtube.js / weburl.js / slideshow.js.
 */

// Crockford base32 alphabet — excludes I, L, O, U so codes are unambiguous to
// read off a screen and type on a phone.
const SESSION_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Public URL where the web controller is hosted (Firebase Hosting).
const DEFAULT_REMOTE_BASE = 'https://multi-displayer.web.app';

// Every command a paired device is allowed to send. Anything else is dropped.
// Scope: slides (presentation + slideshow) + video play/pause. Kept in sync with
// the dispatch table in controller.html.
const REMOTE_ACTIONS = [
  'pres.next', 'pres.prev', 'pres.goto', 'pres.blank',
  'slide.next', 'slide.prev', 'slide.playpause', 'slide.blank',
  'video.playpause', 'video.next', 'video.prev', 'video.stop',
];

/**
 * Generate a random session code from the unambiguous alphabet.
 * @param {number} length  number of characters (default 6 → ~1e9 combinations)
 * @param {() => number} rng  returns a float in [0, 1); injectable for testing
 * @returns {string}
 */
function generateSessionCode(length = 6, rng = Math.random) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SESSION_CODE_ALPHABET[Math.floor(rng() * SESSION_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Normalize user-typed input into a canonical code: uppercase, forgive the
 * ambiguous letters (O→0, I/L→1), and drop anything not in the alphabet.
 * @param {string} input
 * @returns {string}
 */
function normalizeSessionCode(input) {
  return String(input == null ? '' : input)
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(new RegExp(`[^${SESSION_CODE_ALPHABET}]`, 'g'), '');
}

/**
 * True when `code` is exactly `length` chars, all from the alphabet.
 * @param {string} code
 * @param {number} length
 * @returns {boolean}
 */
function isValidSessionCode(code, length = 6) {
  return typeof code === 'string' &&
    code.length === length &&
    [...code].every(c => SESSION_CODE_ALPHABET.includes(c));
}

/**
 * Build the deep link encoded into the QR code.
 * @param {string} code
 * @param {string} base  hosting origin (default Firebase Hosting)
 * @returns {string}  e.g. https://multi-displayer.web.app/?s=ABC123
 */
function buildRemoteUrl(code, base = DEFAULT_REMOTE_BASE) {
  return `${String(base).replace(/\/+$/, '')}/?s=${encodeURIComponent(code)}`;
}

/**
 * Extract + normalize the session code from a URL query string.
 * @param {string} search  e.g. "?s=abc123" or "s=abc123"
 * @returns {string|null}
 */
function parseSessionParam(search) {
  if (!search) return null;
  const q = search.charAt(0) === '?' ? search.slice(1) : search;
  const code = new URLSearchParams(q).get('s');
  if (!code) return null;
  const normalized = normalizeSessionCode(code);
  return normalized || null;
}

/**
 * Validate + normalize a raw command received from a paired device.
 * Returns a safe `{ action, value }` or null if the command is not allowed.
 * @param {{action?: string, value?: *}} raw
 * @returns {{action: string, value: number|null}|null}
 */
function sanitizeCommand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { action } = raw;
  if (!REMOTE_ACTIONS.includes(action)) return null;

  let value = null;
  if (action === 'pres.goto') {
    const n = Number(raw.value);
    if (!Number.isFinite(n) || n < 0) return null; // goto needs a valid slide index
    value = Math.floor(n);
  }
  return { action, value };
}

/**
 * Assemble the normalized state snapshot the desktop controller publishes for
 * the phone to render. Coerces types and fills defaults so the payload is always
 * RTDB-safe (no `undefined`).
 * @param {object} input
 * @param {number} now  timestamp (injectable for testing)
 * @returns {object}
 */
function buildStateSnapshot(input = {}, now = Date.now()) {
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const p = input.presentation || {};
  const s = input.slideshow || {};
  const v = input.video || {};
  return {
    activePanel: String(input.activePanel || 'previews'),
    presentation: { index: num(p.index), total: num(p.total) },
    slideshow: { index: num(s.index), total: num(s.total), playing: !!s.playing },
    video: {
      playing: !!v.playing,
      index: num(v.index, -1),
      playlistLength: num(v.playlistLength),
      title: String(v.title || ''),
      currentTime: num(v.currentTime),
      duration: num(v.duration),
    },
    updatedAt: num(now),
  };
}

module.exports = {
  SESSION_CODE_ALPHABET,
  DEFAULT_REMOTE_BASE,
  REMOTE_ACTIONS,
  generateSessionCode,
  normalizeSessionCode,
  isValidSessionCode,
  buildRemoteUrl,
  parseSessionParam,
  sanitizeCommand,
  buildStateSnapshot,
};
