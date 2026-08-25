/**
 * Pure helpers for VDO.Ninja sources — remote cameras (phones, other machines)
 * that stream in over WebRTC and are shown on a camera screen.
 *
 * Ported from ../virtualcam-helper (config.py), which solved the same problem
 * for the same venue. The important part to carry across is its security
 * model, not its plumbing: that project needed a whole WebSocket bridge only
 * because it re-published frames to a virtual camera in Python. Here the page
 * is displayed directly, so the bridge is unnecessary — but the URL handling
 * is exactly as load-bearing and is reproduced faithfully.
 *
 * THE URL IS THE SECURITY BOUNDARY. It is operator-supplied and untrusted. It
 * is validated here and thereafter only ever assigned to an iframe `src`; it
 * is never passed to a shell, interpolated into markup, or used to build a
 * filesystem path.
 *
 * No DOM or Electron dependencies, so it is unit-tested with `node --test`.
 */

// Exact hosts only. A substring or endsWith check would happily accept
// something like "vdo.ninja.example.com".
const DEFAULT_ALLOWED_HOSTS = ['vdo.ninja', 'backup.vdo.ninja', 'insecure.cam'];

// A link must name a stream one of these ways, or it shows nothing.
const STREAM_PARAMS = ['view', 'push', 'room', 'scene'];

// Matches virtualcam-helper: enough for a multi-camera setup, few enough that
// the machine can decode them all.
const MAX_SOURCES = 6;

// Query parameters that may carry a room password or auth token. Stripped
// before a URL is written to disk.
const SECRET_PARAMS = ['password', 'pass', 'pw', 'hash', 'token', 'key', 'secret'];

/** Raised for an unusable URL, with something an operator can act on. */
class InvalidUrlError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'InvalidUrlError';
    this.hint = hint || '';
  }
}

/**
 * Split a raw query string into [key, value] pairs WITHOUT decoding.
 *
 * Deliberately not URLSearchParams: that re-encodes on the way out, and
 * VDO.Ninja has parameters whose exact literal spelling matters.
 * @param {string} query
 * @returns {Array<[string, string]>}
 */
function rawPairs(query) {
  if (!query) return [];
  return query.split('&').filter(Boolean).map((part) => {
    const eq = part.indexOf('=');
    return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
  });
}

/**
 * Validate a VDO.Ninja link and return it with `&cleanoutput` applied.
 *
 * `cleanoutput` is what strips VDO.Ninja's own UI chrome, so the screen shows
 * the video and nothing else.
 *
 * @param {string} raw
 * @param {string[]} [allowedHosts]
 * @returns {string} the normalized URL
 * @throws {InvalidUrlError}
 */
function validateAndNormalizeUrl(raw, allowedHosts) {
  const hosts = new Set((allowedHosts && allowedHosts.length ? allowedHosts : DEFAULT_ALLOWED_HOSTS)
    .map(h => String(h).toLowerCase()));

  if (raw === null || raw === undefined || !String(raw).trim()) {
    throw new InvalidUrlError('Enter a VDO.Ninja link.',
      'For example: https://vdo.ninja/?view=abc123');
  }

  const text = String(raw).trim();
  let parts;
  try {
    parts = new URL(text);
  } catch (_) {
    throw new InvalidUrlError('That does not look like a valid link.',
      'For example: https://vdo.ninja/?view=abc123');
  }

  const scheme = parts.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'https') {
    throw new InvalidUrlError(
      `Only https:// links are allowed (this one starts with ${scheme}:).`,
      'VDO.Ninja needs HTTPS for the video to connect.');
  }

  if (parts.username || parts.password) {
    throw new InvalidUrlError('Links containing a username or password are not accepted.');
  }

  const host = (parts.hostname || '').toLowerCase();
  if (!host) throw new InvalidUrlError('The link is missing a website address.');
  if (!hosts.has(host)) {
    throw new InvalidUrlError(
      `'${host}' is not an approved VDO.Ninja address.`,
      `Approved addresses: ${[...hosts].sort().join(', ')}`);
  }

  const query = parts.search.startsWith('?') ? parts.search.slice(1) : parts.search;
  const pairs = rawPairs(query);
  const keys = new Set(pairs.map(([k]) => k.toLowerCase()));

  if (!STREAM_PARAMS.some(p => keys.has(p))) {
    throw new InvalidUrlError(
      'That VDO.Ninja link does not say which stream to show.',
      'A view link looks like https://vdo.ninja/?view=abc123');
  }

  for (const [key, value] of pairs) {
    // Decode for the emptiness check only - "?view=%20" is just as empty as
    // "?view=" - while still rebuilding the query from the raw text below.
    let decoded = value;
    try { decoded = decodeURIComponent(value.replace(/\+/g, ' ')); } catch (_) { /* keep raw */ }
    if (key.toLowerCase() === 'view' && !decoded.trim()) {
      throw new InvalidUrlError("The '?view=' part of the link is empty.",
        "Paste the whole link, including the stream ID after '?view='.");
    }
  }

  // Append without re-encoding the rest of the query.
  const nextQuery = keys.has('cleanoutput')
    ? query
    : (query ? `${query}&cleanoutput` : 'cleanoutput');

  return `${parts.protocol}//${parts.host}${parts.pathname || '/'}`
    + (nextQuery ? `?${nextQuery}` : '')
    + (parts.hash || '');
}

/** True when the link is usable, without throwing — for live UI feedback. */
function isValidUrl(raw, allowedHosts) {
  try {
    validateAndNormalizeUrl(raw, allowedHosts);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Strip password/token parameters so nothing secret is written to disk.
 * The config file is plain JSON in the user's profile; a room password does
 * not belong in it.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeUrlForStorage(raw) {
  if (!raw) return '';
  let parts;
  try {
    parts = new URL(String(raw));
  } catch (_) {
    return '';
  }
  const query = parts.search.startsWith('?') ? parts.search.slice(1) : parts.search;
  const pairs = rawPairs(query);
  if (!pairs.some(([k]) => SECRET_PARAMS.includes(k.toLowerCase()))) return String(raw);

  const kept = pairs
    .filter(([k]) => !SECRET_PARAMS.includes(k.toLowerCase()))
    .map(([k, v]) => (v === '' ? k : `${k}=${v}`));

  return `${parts.protocol}//${parts.host}${parts.pathname || '/'}`
    + (kept.length ? `?${kept.join('&')}` : '')
    + (parts.hash || '');
}

/** A short label for a link, for the source list: the stream id if we can find one. */
function labelForUrl(raw) {
  try {
    const parts = new URL(String(raw));
    const pairs = rawPairs(parts.search.replace(/^\?/, ''));
    for (const name of STREAM_PARAMS) {
      const hit = pairs.find(([k]) => k.toLowerCase() === name);
      if (hit && hit[1]) return decodeURIComponent(hit[1]).slice(0, 24);
    }
    return parts.hostname;
  } catch (_) {
    return 'Source';
  }
}

/**
 * Coerce anything into a safe source entry.
 * @param {*} input
 * @param {number} [index] used to name an unlabelled source
 */
function normalizeSource(input, index = 0) {
  const src = (input && typeof input === 'object') ? input : {};
  const url = typeof src.url === 'string' ? src.url : '';
  return {
    id: typeof src.id === 'string' && src.id ? src.id : `src${index + 1}`,
    label: typeof src.label === 'string' && src.label.trim()
      ? src.label.trim().slice(0, 40)
      : (url ? labelForUrl(url) : `Camera ${index + 1}`),
    url,
  };
}

/**
 * Coerce the whole VDO.Ninja settings block into something safe.
 * Caps the list at MAX_SOURCES and guarantees `activeId` names a real source
 * (or is null), so the screen can never be told to show one that isn't there.
 * @param {*} input
 */
function normalizeVdo(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const list = Array.isArray(src.sources) ? src.sources : [];
  const sources = list.slice(0, MAX_SOURCES)
    .map((s, i) => normalizeSource(s, i))
    .filter(s => s.url);

  const activeId = sources.some(s => s.id === src.activeId) ? src.activeId : null;
  return { sources, activeId };
}

/** The source currently on air, or null. */
function activeSource(vdo) {
  const v = normalizeVdo(vdo);
  return v.sources.find(s => s.id === v.activeId) || null;
}

module.exports = {
  DEFAULT_ALLOWED_HOSTS,
  STREAM_PARAMS,
  SECRET_PARAMS,
  MAX_SOURCES,
  InvalidUrlError,
  validateAndNormalizeUrl,
  isValidUrl,
  sanitizeUrlForStorage,
  labelForUrl,
  normalizeSource,
  normalizeVdo,
  activeSource,
};
