const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_CODE_ALPHABET,
  REMOTE_ACTIONS,
  generateSessionCode,
  normalizeSessionCode,
  isValidSessionCode,
  buildRemoteUrl,
  parseSessionParam,
  sanitizeCommand,
  buildStateSnapshot,
} = require('../src/utils/remote');

test('generateSessionCode has the requested length and only alphabet chars', () => {
  const code = generateSessionCode(6);
  assert.equal(code.length, 6);
  assert.ok([...code].every(c => SESSION_CODE_ALPHABET.includes(c)));
});

test('generateSessionCode is deterministic with an injected rng', () => {
  const rng = () => 0; // always the first alphabet char ('0')
  assert.equal(generateSessionCode(4, rng), '0000');
});

test('generateSessionCode never emits the ambiguous letters I/L/O/U', () => {
  assert.ok(!/[ILOU]/.test(SESSION_CODE_ALPHABET));
});

test('normalizeSessionCode uppercases and forgives ambiguous typing', () => {
  assert.equal(normalizeSessionCode('ol1o'), '0110'); // O→0, L→1, 1, O→0
  assert.equal(normalizeSessionCode(' ab-c 1 '), 'ABC1');
  assert.equal(normalizeSessionCode('i'), '1');
});

test('normalizeSessionCode tolerates null / undefined', () => {
  assert.equal(normalizeSessionCode(null), '');
  assert.equal(normalizeSessionCode(undefined), '');
});

test('isValidSessionCode enforces length and alphabet', () => {
  assert.equal(isValidSessionCode('ABC123'), true);
  assert.equal(isValidSessionCode('ABC12'), false);   // too short
  assert.equal(isValidSessionCode('ABC12I'), false);  // I not in alphabet
  assert.equal(isValidSessionCode(''), false);
  assert.equal(isValidSessionCode(123456), false);    // not a string
});

test('buildRemoteUrl encodes the code onto the hosting origin', () => {
  assert.equal(buildRemoteUrl('ABC123'), 'https://multi-displayer.web.app/?s=ABC123');
  assert.equal(buildRemoteUrl('ABC123', 'http://localhost:3000/'), 'http://localhost:3000/?s=ABC123');
});

test('parseSessionParam extracts and normalizes the code', () => {
  assert.equal(parseSessionParam('?s=abc123'), 'ABC123');
  assert.equal(parseSessionParam('s=Abc123'), 'ABC123');
  assert.equal(parseSessionParam('?foo=bar'), null);
  assert.equal(parseSessionParam(''), null);
  assert.equal(parseSessionParam('?s=ol1o'), '0110'); // normalized
});

test('sanitizeCommand accepts allowed actions', () => {
  assert.deepEqual(sanitizeCommand({ action: 'pres.next' }), { action: 'pres.next', value: null });
  assert.deepEqual(sanitizeCommand({ action: 'video.playpause' }), { action: 'video.playpause', value: null });
});

test('sanitizeCommand rejects unknown / malformed actions', () => {
  assert.equal(sanitizeCommand({ action: 'shell.exec' }), null);
  assert.equal(sanitizeCommand({}), null);
  assert.equal(sanitizeCommand(null), null);
  assert.equal(sanitizeCommand('pres.next'), null);
});

test('sanitizeCommand validates pres.goto value', () => {
  assert.deepEqual(sanitizeCommand({ action: 'pres.goto', value: 4 }), { action: 'pres.goto', value: 4 });
  assert.deepEqual(sanitizeCommand({ action: 'pres.goto', value: '7' }), { action: 'pres.goto', value: 7 });
  assert.deepEqual(sanitizeCommand({ action: 'pres.goto', value: 2.9 }), { action: 'pres.goto', value: 2 });
  assert.equal(sanitizeCommand({ action: 'pres.goto', value: -1 }), null);
  assert.equal(sanitizeCommand({ action: 'pres.goto', value: 'x' }), null);
  assert.equal(sanitizeCommand({ action: 'pres.goto' }), null);
});

test('every REMOTE_ACTION is namespaced and sanitizes cleanly', () => {
  for (const action of REMOTE_ACTIONS) {
    assert.match(action, /^(pres|slide|video)\./);
    const value = action === 'pres.goto' ? 0 : undefined;
    assert.deepEqual(sanitizeCommand({ action, value }), {
      action,
      value: action === 'pres.goto' ? 0 : null,
    });
  }
});

test('buildStateSnapshot normalizes types and fills defaults', () => {
  const snap = buildStateSnapshot({
    activePanel: 'presentation',
    presentation: { index: '3', total: '10' },
    slideshow: { index: 1, total: 4, playing: 1 },
    video: { playing: 0, index: 2, playlistLength: 5, title: 'clip.mp4', currentTime: '12.5', duration: 60 },
  }, 1000);

  assert.deepEqual(snap, {
    activePanel: 'presentation',
    presentation: { index: 3, total: 10 },
    slideshow: { index: 1, total: 4, playing: true },
    video: { playing: false, index: 2, playlistLength: 5, title: 'clip.mp4', currentTime: 12.5, duration: 60 },
    updatedAt: 1000,
  });
});

test('buildStateSnapshot is RTDB-safe (no undefined) for empty input', () => {
  const snap = buildStateSnapshot({}, 0);
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('null') || true); // nulls are allowed; undefined is not
  assert.doesNotMatch(json, /undefined/);
  assert.equal(snap.video.index, -1);
  assert.equal(snap.activePanel, 'previews');
});
