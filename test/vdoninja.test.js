const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ALLOWED_HOSTS, STREAM_PARAMS, MAX_SOURCES, InvalidUrlError,
  validateAndNormalizeUrl, isValidUrl, sanitizeUrlForStorage, labelForUrl,
  normalizeSource, normalizeVdo, activeSource,
} = require('../src/utils/vdoninja');

const OK = 'https://vdo.ninja/?view=abc123';

// ── the security boundary ─────────────────────────────────────────────

test('a plain view link is accepted and gets cleanoutput', () => {
  // cleanoutput is what removes VDO.Ninja's own UI, leaving just the video.
  assert.equal(validateAndNormalizeUrl(OK), 'https://vdo.ninja/?view=abc123&cleanoutput');
});

test('cleanoutput is not added twice', () => {
  const once = 'https://vdo.ninja/?view=abc123&cleanoutput';
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
  assert.equal(out, `${url}&cleanoutput`);
});

test('a fragment survives normalization', () => {
  assert.equal(validateAndNormalizeUrl('https://vdo.ninja/?view=a#x'),
    'https://vdo.ninja/?view=a&cleanoutput#x');
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

test('normalizeVdo never throws on junk', () => {
  for (const bad of [null, undefined, 42, 'x', { sources: 'no' }, { sources: [1, 2] }]) {
    const v = normalizeVdo(bad);
    assert.ok(Array.isArray(v.sources), String(bad));
    assert.equal(v.activeId, null);
  }
});

test('activeSource returns the live entry or null', () => {
  const vdo = { sources: [{ id: 'a', url: OK }, { id: 'b', url: 'https://vdo.ninja/?view=b' }],
    activeId: 'b' };
  assert.equal(activeSource(vdo).id, 'b');
  assert.equal(activeSource({ sources: [], activeId: null }), null);
  assert.equal(activeSource(null), null);
});
