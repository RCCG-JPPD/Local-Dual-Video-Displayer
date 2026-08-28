const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const OcrEngine = require('../src/modules/ocrEngine');
const { unpacked, describeOcrError } = require('../src/modules/ocrEngine');

// ── asar path rewriting ───────────────────────────────────────────────
//
// This is the highest-value thing in the file to test: it is a no-op in
// development and only ever matters inside a packaged app, which is exactly
// where a mistake is hardest to notice and most expensive to find.

test('paths inside app.asar are redirected to the unpacked copy', () => {
  assert.equal(
    unpacked('/Applications/App.app/Contents/Resources/app.asar/src/vendor/tessdata'),
    '/Applications/App.app/Contents/Resources/app.asar.unpacked/src/vendor/tessdata',
  );
  assert.equal(
    unpacked('/x/app.asar/node_modules/tesseract.js/src/worker-script/node/index.js'),
    '/x/app.asar.unpacked/node_modules/tesseract.js/src/worker-script/node/index.js',
  );
});

test('Windows separators are handled too', () => {
  assert.equal(
    unpacked('C:\\Program Files\\App\\resources\\app.asar\\src\\vendor\\tessdata'),
    'C:\\Program Files\\App\\resources\\app.asar.unpacked\\src\\vendor\\tessdata',
  );
});

test('a development path is left completely alone', () => {
  const dev = '/Users/me/project/src/vendor/tessdata';
  assert.equal(unpacked(dev), dev);
  assert.equal(unpacked('/no/asar/here/index.js'), '/no/asar/here/index.js');
});

test('an already-unpacked path is not rewritten twice', () => {
  // "app.asar.unpacked/" must not match the "app.asar/" rule and become
  // "app.asar.unpacked.unpacked/".
  const already = '/x/app.asar.unpacked/src/vendor/tessdata';
  assert.equal(unpacked(already), already);
});

test('only the first asar segment is rewritten', () => {
  // A path cannot contain two archives; rewriting a later literal occurrence
  // would corrupt a directory that merely happens to be named that.
  assert.equal(
    unpacked('/x/app.asar/a/app.asar/b'),
    '/x/app.asar.unpacked/a/app.asar/b',
  );
});

test('unpacked never throws on junk', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(unpacked(bad), bad, String(bad));
  }
});

// ── operator-facing error messages ────────────────────────────────────

test('permission failures are explained, not dumped', () => {
  const msg = describeOcrError(new Error('Screen capture permission denied by TCC'));
  assert.match(msg, /Screen recording permission/i);
});

test('a missing language model is explained', () => {
  assert.match(describeOcrError(new Error('ENOENT: eng.traineddata')), /Language data missing/i);
  assert.match(describeOcrError(new Error('could not load traineddata')), /Language data missing/i);
});

test('anything else is passed through rather than swallowed', () => {
  assert.equal(describeOcrError(new Error('the screen went away')), 'the screen went away');
  assert.equal(describeOcrError('a bare string'), 'a bare string');
});

// ── engine lifecycle (no Electron, no Tesseract) ──────────────────────
//
// _read() is the only part that needs Electron, so these stub it and exercise
// the loop, the guards and the callbacks around it.

/** An engine whose reads are scripted, so the loop can be tested in isolation. */
function stubEngine(reads, opts = {}) {
  const texts = [];
  const statuses = [];
  const engine = new OcrEngine({
    onText: (t) => texts.push(t),
    onStatus: (s) => statuses.push(s),
  });
  let i = 0;
  engine._read = async () => {
    const next = reads[Math.min(i, reads.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return next;
  };
  engine.cfg = { ...engine.cfg, ...opts };
  return { engine, texts, statuses, reads: () => i };
}

const tick = () => new Promise(r => setTimeout(r, 5));

test('a new engine is idle and reports so', () => {
  const engine = new OcrEngine({});
  const st = engine.getState();
  assert.equal(st.running, false);
  assert.equal(st.lastText, '');
  assert.equal(st.error, '');
});

test('the engine survives being constructed with no callbacks', () => {
  // ipcHandler always passes them, but a throwing default would be a landmine.
  const engine = new OcrEngine();
  assert.doesNotThrow(() => engine._report({ text: 'x' }));
  assert.doesNotThrow(() => engine.stop());
});

test('readOnce reports a result without starting the loop', async () => {
  const { engine, texts } = stubEngine([{ text: 'HOLY IS THE LORD', confidence: 90 }]);
  const out = await engine.readOnce();
  assert.equal(out.text, 'HOLY IS THE LORD');
  assert.equal(engine.running, false, 'readOnce must not start the loop');
  assert.deepEqual(texts, [], 'readOnce must not push a caption to the screen');
  assert.equal(engine.getState().lastText, 'HOLY IS THE LORD');
});

test('readOnce reports a failure instead of throwing', async () => {
  const { engine } = stubEngine([new Error('no screen')]);
  const out = await engine.readOnce();
  assert.deepEqual(out, { text: '', confidence: 0 });
  assert.match(engine.getState().error, /no screen/);
});

test('the loop emits a confirmed line to the screen', async () => {
  // start() normalizes, and intervalMs has a 200ms floor, so two confirming
  // reads take one interval: the first fires immediately, the second after it.
  const { engine, texts } = stubEngine(
    [{ text: 'AMAZING GRACE', confidence: 90 }],
    { intervalMs: 200, confirmReads: 2 },
  );
  engine.start(engine.cfg);
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(texts, [], 'one read should not be enough with confirmReads: 2');
  await new Promise(r => setTimeout(r, 260));
  engine.stop();
  assert.deepEqual(texts, ['AMAZING GRACE']);
});

test('the settings floor is enforced by start(), not just by the UI', () => {
  // A hand-edited config asking for a 1ms interval would otherwise hammer
  // desktopCapturer as fast as it can return.
  const { engine } = stubEngine([{ text: 'x', confidence: 90 }]);
  engine.start({ enabled: true, intervalMs: 1 });
  assert.equal(engine.cfg.intervalMs, 200);
  engine.stop();
});

test('outputToScreen false keeps lines off the screen but still reports them', async () => {
  // The rehearsal workflow: aim the region while nothing reaches the audience.
  const { engine, texts } = stubEngine(
    [{ text: 'AMAZING GRACE', confidence: 90 }],
    { intervalMs: 5, confirmReads: 1, outputToScreen: false },
  );
  engine.start(engine.cfg);
  await tick(); await tick();
  engine.stop();
  assert.deepEqual(texts, [], 'nothing should have reached the screen');
  assert.equal(engine.getState().lastText, 'AMAZING GRACE', 'but it must still be reported');
});

test('a failing read does not kill the loop', async () => {
  // A screen can be briefly unavailable - locked, asleep, mid resolution
  // change - and the loop has to survive it.
  const { engine, statuses } = stubEngine([new Error('display asleep')],
    { intervalMs: 5 });
  engine.start(engine.cfg);
  await tick(); await tick(); await tick();
  const stillRunning = engine.running;
  engine.stop();
  assert.equal(stillRunning, true, 'the loop stopped after one failure');
  assert.ok(statuses.some(s => /display asleep/.test(s.error)), 'the failure was not reported');
});

test('start is idempotent: calling it twice does not run two loops', async () => {
  const { engine } = stubEngine([{ text: 'x', confidence: 90 }], { intervalMs: 50 });
  engine.start(engine.cfg);
  const firstTimer = engine.timer;
  engine.start(engine.cfg);
  assert.equal(engine.timer, firstTimer, 'a second start replaced the timer');
  engine.stop();
});

test('stop clears the timer and reports not running', () => {
  const { engine } = stubEngine([{ text: 'x', confidence: 90 }], { intervalMs: 50 });
  engine.start(engine.cfg);
  engine.stop();
  assert.equal(engine.running, false);
  assert.equal(engine.timer, null);
  assert.equal(engine.getState().running, false);
});

test('update starts and stops the loop from the enabled flag', () => {
  const { engine } = stubEngine([{ text: 'x', confidence: 90 }]);
  engine.update({ enabled: true, intervalMs: 500 });
  assert.equal(engine.running, true);
  engine.update({ enabled: false });
  assert.equal(engine.running, false);
});

test('the busy guard stops slow reads stacking up', async () => {
  // With setInterval a read slower than the interval would queue behind
  // itself; the guard is what keeps one read in flight at a time.
  let inFlight = 0;
  let maxInFlight = 0;
  const engine = new OcrEngine({});
  engine.cfg = { ...engine.cfg, intervalMs: 1, confirmReads: 1 };
  engine._read = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 20));
    inFlight -= 1;
    return { text: 'slow line here', confidence: 90 };
  };
  engine.start(engine.cfg);
  await new Promise(r => setTimeout(r, 120));
  engine.stop();
  assert.equal(maxInFlight, 1, `${maxInFlight} reads were in flight at once`);
});

test('stopping mid-read does not schedule another', async () => {
  const engine = new OcrEngine({});
  engine.cfg = { ...engine.cfg, intervalMs: 1 };
  engine._read = async () => {
    await new Promise(r => setTimeout(r, 15));
    return { text: 'a line of lyrics', confidence: 90 };
  };
  engine.start(engine.cfg);
  await new Promise(r => setTimeout(r, 5));
  engine.stop();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(engine.running, false);
  assert.equal(engine.timer, null, 'a read that finished after stop re-armed the timer');
});

test('the shipped language model is inside src/, so build.files ships it', () => {
  // package.json's files whitelist is src/**; a model outside it would work in
  // development and be missing from the installer.
  const dir = path.join(__dirname, '..', 'src', 'vendor', 'tessdata');
  assert.ok(require('node:fs').existsSync(path.join(dir, 'eng.traineddata')),
    'eng.traineddata is missing from src/vendor/tessdata');
});
