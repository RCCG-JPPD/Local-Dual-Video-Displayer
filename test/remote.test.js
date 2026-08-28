const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
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
const ZOOM_IN = { mode: 'cover', scale: 1.5 };
const SAMPLE_VALUES = {
  'pres.goto': [0, 0], 'slide.goto': [3, 3], 'video.goto': [2, 2], 'excel.sheet': [1, 1],
  'video.seek': [0.5, 0.5], 'video.volume': [0.8, 0.8], 'yt.volume': [1, 1],
  'yt.load': ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'], 'web.load': ['example.com', 'example.com'],
  'video.zoom': [ZOOM_IN, ZOOM_IN], 'slide.zoom': [ZOOM_IN, ZOOM_IN], 'yt.zoom': [ZOOM_IN, ZOOM_IN],
  'caption.text': ['Holy is the Lord', 'Holy is the Lord'],
  'cam.zoom': [ZOOM_IN, ZOOM_IN],
  'cam.take': [1, 1],
};

test('every REMOTE_ACTION is namespaced and sanitizes cleanly', () => {
  for (const action of REMOTE_ACTIONS) {
    assert.match(action, /^(pres|slide|video|yt|web|excel|cam|ocr|caption)\./);
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

test('sanitizeCommand normalizes zoom values and rejects non-objects', () => {
  assert.deepEqual(sanitizeCommand({ action: 'video.zoom', value: { mode: 'cover', scale: '2' } }),
    { action: 'video.zoom', value: { mode: 'cover', scale: 2 } });
  // Unknown mode / out-of-range scale are pulled back rather than rejected.
  assert.deepEqual(sanitizeCommand({ action: 'slide.zoom', value: { mode: 'bogus', scale: 99 } }),
    { action: 'slide.zoom', value: { mode: 'contain', scale: 4 } });
  assert.deepEqual(sanitizeCommand({ action: 'yt.zoom', value: {} }),
    { action: 'yt.zoom', value: { mode: 'contain', scale: 1 } });
  // A zoom is an object — a bare number or a missing value is a malformed command.
  assert.equal(sanitizeCommand({ action: 'video.zoom', value: 1.5 }), null);
  assert.equal(sanitizeCommand({ action: 'video.zoom' }), null);
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

  const FIT = { mode: 'contain', scale: 1 }; // default zoom, filled in per screen
  assert.deepEqual(snap, {
    activePanel: 'presentation',
    roles: null, // caller didn't say — phone shows all sections
    presentation: { index: 3, total: 10 },
    slideshow: { index: 1, total: 4, playing: true, zoom: FIT },
    video: {
      playing: false, index: 2, playlistLength: 5, title: 'clip.mp4',
      currentTime: 12.5, duration: 60, volume: 1, zoom: FIT, playlist: [],
    },
    youtube: { url: '', muted: false, volume: 1, zoom: FIT },
    web: { url: '' },
    excel: { sheets: [], active: 0 },
    camera: { live: false, visible: true, zoom: FIT, source: 'device',
              cameras: [], activeCamera: -1 },
    ocr: { running: false, lastText: '' },
    updatedAt: 1000,
  });
});

test('buildStateSnapshot carries full-remote state (volume, playlist, yt, web, excel, roles)', () => {
  const snap = buildStateSnapshot({
    roles: {
      video: 1, youtube: 0, web: true, presentation: true, slideshow: false,
      excel: false, camera: true,
    },
    video: { volume: '0.3', playlist: ['a.mp4', 'b.mp4'] },
    youtube: { url: 'https://youtu.be/x', muted: 1, volume: 2 },
    web: { url: 'https://example.com' },
    excel: { sheets: ['Sheet1', 'Totals'], active: '1' },
  }, 0);

  assert.deepEqual(snap.roles, {
    presentation: true, slideshow: false, video: true, youtube: false, web: true,
    excel: false, camera: true,
  });
  assert.equal(snap.video.volume, 0.3);
  assert.deepEqual(snap.video.playlist, ['a.mp4', 'b.mp4']);
  assert.deepEqual(snap.youtube, {
    url: 'https://youtu.be/x', muted: true, volume: 1, // volume clamped
    zoom: { mode: 'contain', scale: 1 },               // defaulted when absent
  });
  assert.equal(snap.web.url, 'https://example.com');
  assert.deepEqual(snap.excel, { sheets: ['Sheet1', 'Totals'], active: 1 });
});

test('buildStateSnapshot carries camera and OCR state', () => {
  const snap = buildStateSnapshot({
    camera: {
      live: 1, visible: false, zoom: { mode: 'cover', scale: '1.2' },
      source: 'vdo', cameras: ['Stage left', 'Drums'], activeCamera: '1',
    },
    ocr: { running: 1, lastText: 'Holy is the Lord' },
  }, 0);
  assert.deepEqual(snap.camera, {
    live: true, visible: false, zoom: { mode: 'cover', scale: 1.2 },
    source: 'vdo', cameras: ['Stage left', 'Drums'], activeCamera: 1,
  });
  assert.deepEqual(snap.ocr, { running: true, lastText: 'Holy is the Lord' });
});

test('buildStateSnapshot defaults the camera to visible and caps the lyric line', () => {
  // `visible` defaults to true: an absent value must not read as "reset".
  assert.equal(buildStateSnapshot({}, 0).camera.visible, true);
  const long = buildStateSnapshot({ ocr: { lastText: 'x'.repeat(500) } }, 0);
  assert.equal(long.ocr.lastText.length, 240);
});

test('the snapshot carries camera LABELS only, never their URLs', () => {
  // A VDO.Ninja link can contain a room password; it must not be published to
  // the phone, which reaches it over the internet.
  const snap = buildStateSnapshot({
    camera: { cameras: ['Stage left'], activeCamera: 0 },
  }, 0);
  assert.deepEqual(snap.camera.cameras, ['Stage left']);
  assert.ok(!JSON.stringify(snap).includes('vdo.ninja'));
});

test('buildStateSnapshot normalizes zoom for every screen', () => {
  const snap = buildStateSnapshot({
    video: { zoom: { mode: 'cover', scale: '1.5' } },
    slideshow: { zoom: { mode: 'native', scale: 1 } },
    youtube: { zoom: { mode: 'bogus', scale: 99 } },
  }, 0);
  assert.deepEqual(snap.video.zoom, { mode: 'cover', scale: 1.5 });
  assert.deepEqual(snap.slideshow.zoom, { mode: 'native', scale: 1 });
  assert.deepEqual(snap.youtube.zoom, { mode: 'contain', scale: 4 }); // clamped + fallback
  // Absent zoom must still be a real object — RTDB rejects undefined.
  assert.deepEqual(buildStateSnapshot({}, 0).video.zoom, { mode: 'contain', scale: 1 });
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

// The phone app carries a hand-written copy of the action list — there is no
// build step linking the two, and a drift fails SILENTLY on the phone (the
// desktop rejects an unknown action and the button just does nothing). This
// reads the web copy as text so the guard needs no bundler and no ESM loader.
test('the web remote mirrors every desktop action', () => {
  const webRemote = path.join(__dirname, '..', 'remote_mode', 'remote-controller', 'src', 'remote.js');
  const src = fs.readFileSync(webRemote, 'utf8');
  const mirrored = new Set([...src.matchAll(/'([a-z]+\.[a-zA-Z]+)'/g)].map(m => m[1]));

  const missing = REMOTE_ACTIONS.filter(a => !mirrored.has(a));
  assert.deepEqual(missing, [],
    `these actions exist on the desktop but not in the phone app: ${missing.join(', ')}`);

  const extra = [...mirrored].filter(a => !REMOTE_ACTIONS.includes(a));
  assert.deepEqual(extra, [],
    `the phone app sends actions the desktop will reject: ${extra.join(', ')}`);
});
