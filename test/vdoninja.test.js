const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALLOWED_HOSTS, STREAM_PARAMS, MAX_SOURCES, InvalidUrlError,
  validateAndNormalizeUrl, isValidUrl, sanitizeUrlForStorage, labelForUrl,
  normalizeSource, normalizeVdo, activeSource, FORCED_PARAMS,
} = require('../src/utils/vdoninja');

const OK = 'https://vdo.ninja/?view=abc123';

// ── the security boundary ─────────────────────────────────────────────

test('a plain view link is accepted and gets the forced flags', () => {
  // cleanoutput removes VDO.Ninja's own UI; noaudio/muted keep the link silent.
  assert.equal(validateAndNormalizeUrl(OK),
    'https://vdo.ninja/?view=abc123&cleanoutput&noaudio&muted');
});

test('the forced flags are not added twice', () => {
  const once = validateAndNormalizeUrl(OK);
  assert.equal(validateAndNormalizeUrl(once), once);
});

test('every approved host is accepted, and nothing else', () => {
  for (const host of DEFAULT_ALLOWED_HOSTS) {
    assert.ok(isValidUrl(`https://${host}/?view=x`), host);
  }
  // The classic bug an endsWith/substring check would let through.
  assert.throws(() => validateAndNormalizeUrl('https://vdo.ninja.example.com/?view=x'),
    InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('https://evil.com/?view=x'), InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('https://notvdo.ninja/?view=x'), InvalidUrlError);
});

test('only https is accepted', () => {
  assert.throws(() => validateAndNormalizeUrl('http://vdo.ninja/?view=x'), InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('file:///etc/passwd'), InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('javascript:alert(1)'), InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('data:text/html,<script>'), InvalidUrlError);
});

test('credentials embedded in the URL are refused', () => {
  assert.throws(() => validateAndNormalizeUrl('https://user:pw@vdo.ninja/?view=x'),
    InvalidUrlError);
  // The userinfo trick that makes a bad host look like a good one.
  assert.throws(() => validateAndNormalizeUrl('https://vdo.ninja@evil.com/?view=x'),
    InvalidUrlError);
});

test('a link that names no stream is refused', () => {
  assert.throws(() => validateAndNormalizeUrl('https://vdo.ninja/'), InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('https://vdo.ninja/?foo=bar'), InvalidUrlError);
});

test('every stream parameter form is accepted', () => {
  for (const p of STREAM_PARAMS) {
    assert.ok(isValidUrl(`https://vdo.ninja/?${p}=abc`), p);
  }
});

test('an empty ?view= is refused', () => {
  assert.throws(() => validateAndNormalizeUrl('https://vdo.ninja/?view='), InvalidUrlError);
  assert.throws(() => validateAndNormalizeUrl('https://vdo.ninja/?view=%20'), InvalidUrlError);
});

test('empty and junk input is refused with a readable message', () => {
  for (const bad of ['', '   ', null, undefined, 'not a url', 42]) {
    assert.throws(() => validateAndNormalizeUrl(bad), InvalidUrlError, String(bad));
  }
  try {
    validateAndNormalizeUrl('');
  } catch (err) {
    assert.match(err.message, /Enter a VDO\.Ninja link/);
    assert.match(err.hint, /vdo\.ninja/);
  }
});

test('the rest of the query is preserved exactly, not re-encoded', () => {
  // VDO.Ninja has parameters whose literal spelling matters, so the query is
  // carried through verbatim rather than round-tripped through a parser.
  const url = 'https://vdo.ninja/?view=abc&bitrate=2500&codec=h264&noaudio';
  const out = validateAndNormalizeUrl(url);
  assert.ok(out.startsWith(url), out);
  // noaudio was already there, so only the two it was missing get appended.
  assert.equal(out, `${url}&cleanoutput&muted`);
});

test('a fragment survives normalization', () => {
  assert.equal(validateAndNormalizeUrl('https://vdo.ninja/?view=a#x'),
    'https://vdo.ninja/?view=a&cleanoutput&noaudio&muted#x');
});

test('isValidUrl never throws', () => {
  for (const bad of [null, undefined, '', 42, {}, [], 'http://x']) {
    assert.equal(isValidUrl(bad), false, String(bad));
  }
  assert.equal(isValidUrl(OK), true);
});

// ── secrets must not reach the config file ────────────────────────────

test('secret parameters are stripped before storage', () => {
  assert.equal(
    sanitizeUrlForStorage('https://vdo.ninja/?view=abc&password=hunter2'),
    'https://vdo.ninja/?view=abc',
  );
  assert.equal(
    sanitizeUrlForStorage('https://vdo.ninja/?view=abc&token=t&pw=p&hash=h&key=k&secret=s'),
    'https://vdo.ninja/?view=abc',
  );
});

test('stripping is case-insensitive and keeps everything else', () => {
  assert.equal(
    sanitizeUrlForStorage('https://vdo.ninja/?view=abc&PASSWORD=x&bitrate=2500'),
    'https://vdo.ninja/?view=abc&bitrate=2500',
  );
});

test('a URL with no secrets is returned untouched', () => {
  const url = 'https://vdo.ninja/?view=abc&cleanoutput';
  assert.equal(sanitizeUrlForStorage(url), url);
});

test('sanitizeUrlForStorage never throws', () => {
  assert.equal(sanitizeUrlForStorage(''), '');
  assert.equal(sanitizeUrlForStorage(null), '');
  assert.equal(sanitizeUrlForStorage('nonsense'), '');
});

// ── source list ───────────────────────────────────────────────────────

test('labelForUrl uses the stream id', () => {
  assert.equal(labelForUrl('https://vdo.ninja/?view=stageLeft'), 'stageLeft');
  assert.equal(labelForUrl('https://vdo.ninja/?room=myroom'), 'myroom');
  assert.equal(labelForUrl('https://vdo.ninja/'), 'vdo.ninja');
  assert.equal(labelForUrl('rubbish'), 'Source');
});

test('normalizeSource fills in an id and a label', () => {
  const s = normalizeSource({ url: 'https://vdo.ninja/?view=drums' }, 0);
  assert.equal(s.id, 'src1');
  assert.equal(s.label, 'drums');
  assert.equal(normalizeSource({}, 2).label, 'Camera 3');
  assert.equal(normalizeSource(null, 0).url, '');
});

test('normalizeVdo drops sources with no URL and caps the list', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://vdo.ninja/?view=s${i}` }));
  assert.equal(normalizeVdo({ sources: many }).sources.length, MAX_SOURCES);
  assert.equal(normalizeVdo({ sources: [{ url: '' }, { url: OK }] }).sources.length, 1);
});

test('activeId can never name a source that is not there', () => {
  // Otherwise the screen would be told to show a stream that does not exist.
  const v = normalizeVdo({ sources: [{ id: 'a', url: OK }], activeId: 'ghost' });
  assert.equal(v.activeId, null);
  const ok = normalizeVdo({ sources: [{ id: 'a', url: OK }], activeId: 'a' });
  assert.equal(ok.activeId, 'a');
});

test('normalizeVdo carries preloadAll through', () => {
  // The camera screen reads preloadAll back off the NORMALIZED object to decide
  // whether to keep every source mounted. Dropping it here left only the on-air
  // camera connected, so every cut became a fresh WebRTC handshake and a
  // cross-fade had no outgoing picture to fade from.
  assert.equal(normalizeVdo({ sources: [], preloadAll: true }).preloadAll, true);
  assert.equal(normalizeVdo({ sources: [], preloadAll: false }).preloadAll, false);
  // Absent means on, matching the config default and the controller checkbox.
  assert.equal(normalizeVdo({ sources: [] }).preloadAll, true);
  assert.equal(normalizeVdo(null).preloadAll, true);
});

test('normalizeVdo never throws on junk', () => {
  for (const bad of [null, undefined, 42, 'x', { sources: 'no' }, { sources: [1, 2] }]) {
    const v = normalizeVdo(bad);
    assert.ok(Array.isArray(v.sources), String(bad));
    assert.equal(v.activeId, null);
    assert.equal(typeof v.preloadAll, 'boolean', String(bad));
  }
});

test('activeSource returns the live entry or null', () => {
  const vdo = { sources: [{ id: 'a', url: OK }, { id: 'b', url: 'https://vdo.ninja/?view=b' }],
    activeId: 'b' };
  assert.equal(activeSource(vdo).id, 'b');
  assert.equal(activeSource({ sources: [], activeId: null }), null);
  assert.equal(activeSource(null), null);
});

// ── silence ───────────────────────────────────────────────────────────

test('every accepted link comes back silent', () => {
  // Sources stay mounted so cuts are instant, so ALL of them receive at once.
  // Audio on any of them is a feedback loop next to the PA — on air just as
  // much as in the operator's preview. No camera ever needs to be heard.
  for (const raw of [OK, 'https://vdo.ninja/?view=a&bitrate=800',
    'https://vdo.ninja/?room=r&scene=1', 'https://backup.vdo.ninja/?view=z']) {
    const url = validateAndNormalizeUrl(raw);
    FORCED_PARAMS.forEach(p => assert.ok(url.includes(p), `${p} missing from ${url}`));
  }
});

test('a flag the operator already set is not duplicated', () => {
  const url = validateAndNormalizeUrl('https://vdo.ninja/?view=a&muted');
  assert.equal(url.match(/muted/g).length, 1, url);
});

test('the forced flags keep the rest of the query and the fragment intact', () => {
  const url = validateAndNormalizeUrl('https://vdo.ninja/?view=abc123&bitrate=800#x');
  assert.ok(url.includes('bitrate=800'), url);
  assert.ok(url.endsWith('#x'), url);
});
