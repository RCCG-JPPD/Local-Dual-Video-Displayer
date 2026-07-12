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
  createSessionStore,
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

// A valid sample value per action that requires one (mirrors VALUE_SPECS).
const SAMPLE_VALUES = {
  'pres.goto': [0, 0], 'slide.goto': [3, 3], 'video.goto': [2, 2], 'excel.sheet': [1, 1],
  'video.seek': [0.5, 0.5], 'video.volume': [0.8, 0.8], 'yt.volume': [1, 1],
  'yt.load': ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'], 'web.load': ['example.com', 'example.com'],
};

test('every REMOTE_ACTION is namespaced and sanitizes cleanly', () => {
  for (const action of REMOTE_ACTIONS) {
    assert.match(action, /^(pres|slide|video|yt|web|excel)\./);
    const [value, expected] = SAMPLE_VALUES[action] || [undefined, null];
    assert.deepEqual(sanitizeCommand({ action, value }), { action, value: expected });
  }
});

test('sanitizeCommand clamps fraction values to [0, 1]', () => {
  assert.deepEqual(sanitizeCommand({ action: 'video.seek', value: 1.5 }), { action: 'video.seek', value: 1 });
  assert.deepEqual(sanitizeCommand({ action: 'video.volume', value: -0.2 }), { action: 'video.volume', value: 0 });
  assert.deepEqual(sanitizeCommand({ action: 'yt.volume', value: '0.4' }), { action: 'yt.volume', value: 0.4 });
  assert.equal(sanitizeCommand({ action: 'video.seek', value: 'x' }), null);
  assert.equal(sanitizeCommand({ action: 'video.seek' }), null);
});

test('sanitizeCommand validates index values for goto-style actions', () => {
  assert.deepEqual(sanitizeCommand({ action: 'video.goto', value: '3' }), { action: 'video.goto', value: 3 });
  assert.deepEqual(sanitizeCommand({ action: 'slide.goto', value: 2.7 }), { action: 'slide.goto', value: 2 });
  assert.equal(sanitizeCommand({ action: 'excel.sheet', value: -1 }), null);
  assert.equal(sanitizeCommand({ action: 'excel.sheet', value: 'first' }), null);
});

test('sanitizeCommand trims, caps, and type-checks string values', () => {
  assert.deepEqual(sanitizeCommand({ action: 'web.load', value: '  example.com  ' }),
    { action: 'web.load', value: 'example.com' });
  assert.equal(sanitizeCommand({ action: 'web.load', value: '   ' }), null);
  assert.equal(sanitizeCommand({ action: 'web.load', value: 42 }), null);
  assert.equal(sanitizeCommand({ action: 'yt.load', value: 'a'.repeat(500) }).value.length, 300);
  assert.equal(sanitizeCommand({ action: 'web.load', value: 'b'.repeat(5000) }).value.length, 1024);
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
    roles: null, // caller didn't say — phone shows all sections
    presentation: { index: 3, total: 10 },
    slideshow: { index: 1, total: 4, playing: true },
    video: {
      playing: false, index: 2, playlistLength: 5, title: 'clip.mp4',
      currentTime: 12.5, duration: 60, volume: 1, playlist: [],
    },
    youtube: { url: '', muted: false, volume: 1 },
    web: { url: '' },
    excel: { sheets: [], active: 0 },
    updatedAt: 1000,
  });
});

test('buildStateSnapshot carries full-remote state (volume, playlist, yt, web, excel, roles)', () => {
  const snap = buildStateSnapshot({
    roles: { video: 1, youtube: 0, web: true, presentation: true, slideshow: false, excel: false },
    video: { volume: '0.3', playlist: ['a.mp4', 'b.mp4'] },
    youtube: { url: 'https://youtu.be/x', muted: 1, volume: 2 },
    web: { url: 'https://example.com' },
    excel: { sheets: ['Sheet1', 'Totals'], active: '1' },
  }, 0);

  assert.deepEqual(snap.roles, {
    presentation: true, slideshow: false, video: true, youtube: false, web: true, excel: false,
  });
  assert.equal(snap.video.volume, 0.3);
  assert.deepEqual(snap.video.playlist, ['a.mp4', 'b.mp4']);
  assert.deepEqual(snap.youtube, { url: 'https://youtu.be/x', muted: true, volume: 1 }); // volume clamped
  assert.equal(snap.web.url, 'https://example.com');
  assert.deepEqual(snap.excel, { sheets: ['Sheet1', 'Totals'], active: 1 });
});

test('buildStateSnapshot caps list sizes and string lengths (RTDB payload safety)', () => {
  const snap = buildStateSnapshot({
    video: { playlist: Array.from({ length: 150 }, (_, i) => 'v' + i + 'x'.repeat(300)) },
    excel: { sheets: Array.from({ length: 80 }, () => 's'.repeat(200)) },
    web: { url: 'u'.repeat(3000) },
  }, 0);
  assert.equal(snap.video.playlist.length, 100);
  assert.equal(snap.video.playlist[0].length, 120);
  assert.equal(snap.excel.sheets.length, 50);
  assert.equal(snap.excel.sheets[0].length, 80);
  assert.equal(snap.web.url.length, 1024);
});

test('buildStateSnapshot is RTDB-safe (no undefined) for empty input', () => {
  const snap = buildStateSnapshot({}, 0);
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('null') || true); // nulls are allowed; undefined is not
  assert.doesNotMatch(json, /undefined/);
  assert.equal(snap.video.index, -1);
  assert.equal(snap.activePanel, 'previews');
});

test('createSessionStore generates the code lazily and keeps it for the run', () => {
  let calls = 0;
  const store = createSessionStore(() => { calls++; return 'ABC12' + calls; });
  assert.equal(calls, 0); // nothing generated until first use
  assert.equal(store.getState().code, 'ABC121');
  assert.equal(store.getState().code, 'ABC121'); // same code on every call
  assert.equal(calls, 1);
});

test('createSessionStore keeps the same code across enable/disable toggles', () => {
  const store = createSessionStore(() => 'ZZZ999');
  assert.deepEqual(store.getState(), { code: 'ZZZ999', enabled: false });
  store.setEnabled(true);
  assert.deepEqual(store.getState(), { code: 'ZZZ999', enabled: true });
  store.setEnabled(false);
  assert.deepEqual(store.getState(), { code: 'ZZZ999', enabled: false });
});

test('createSessionStore coerces enabled to a boolean', () => {
  const store = createSessionStore(() => 'ABC123');
  store.setEnabled(1);
  assert.equal(store.getState().enabled, true);
  store.setEnabled(null);
  assert.equal(store.getState().enabled, false);
});

test('createSessionStore uses the real generator by default', () => {
  const { code } = createSessionStore().getState();
  assert.equal(isValidSessionCode(code), true);
});

test('a fresh store (new app run) gets a fresh code', () => {
  let n = 0;
  const gen = () => 'RUN00' + (++n);
  assert.equal(createSessionStore(gen).getState().code, 'RUN001');
  assert.equal(createSessionStore(gen).getState().code, 'RUN002');
});

test('createSessionStore seeds from a valid persisted code (keep-code opt-in)', () => {
  let calls = 0;
  const store = createSessionStore(() => { calls++; return 'NEW111'; }, 'ABC123');
  assert.equal(store.getState().code, 'ABC123'); // reused, not regenerated
  assert.equal(calls, 0);
});

test('createSessionStore ignores an invalid persisted code', () => {
  assert.equal(createSessionStore(() => 'NEW111', 'bogus!').getState().code, 'NEW111');
  assert.equal(createSessionStore(() => 'NEW111', '').getState().code, 'NEW111');
  assert.equal(createSessionStore(() => 'NEW111', null).getState().code, 'NEW111');
});

test('resetCode issues a different code and keeps the enabled flag', () => {
  let n = 0;
  const store = createSessionStore(() => 'CODE0' + (n++));
  store.setEnabled(true);
  const first = store.getState().code;
  const st = store.resetCode();
  assert.notEqual(st.code, first);
  assert.equal(st.enabled, true);
  assert.equal(store.getState().code, st.code); // new code sticks
});

test('resetCode retries when the generator repeats the current code', () => {
  const codes = ['SAME00', 'SAME00', 'DIFF00'];
  let i = 0;
  const store = createSessionStore(() => codes[Math.min(i++, codes.length - 1)]);
  assert.equal(store.getState().code, 'SAME00');
  assert.equal(store.resetCode().code, 'DIFF00');
});
