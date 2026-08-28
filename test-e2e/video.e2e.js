/**
 * End-to-end checks for the local-video screen, run inside a real Electron.
 *
 *   npm run test:e2e
 *
 * Exists because the dead preview-capture loop was removed from
 * videoDisplay.html: that loop was tangled up with the play/pause listeners
 * that keep `isPlaying` in sync, so playback needs proving end to end.
 *
 * The test clip is recorded on the fly from Chromium's synthetic camera with
 * MediaRecorder, so the suite needs no ffmpeg and no fixture in the repo.
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui', 'videoDisplay.html');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const CLIP = path.join(os.tmpdir(), `ldvd-e2e-clip-${process.pid}.webm`);

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.disableHardwareAcceleration();

const results = [];
let currentTest = null;
function test(name, fn) { results.push({ name, fn }); }
function check(ok, detail) {
  if (!ok) throw new Error(detail);
  currentTest.checks += 1;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Mean luminance of the whole rendered window, 0..255.
 *
 * Captured twice, discarding the first: on a window created with show:false
 * the compositor hands back the previously painted frame, so a single grab
 * reports the state BEFORE the change under test and every reading here would
 * be one step behind.
 */
async function meanLuminance(w) {
  await w.webContents.capturePage();
  await sleep(120);
  const image = await w.webContents.capturePage();
  const { width, height } = image.getSize();
  const buf = image.toBitmap(); // premultiplied BGRA
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    sum += 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
  }
  return sum / (width * height);
}

let win = null;
const rendererLog = [];
const previewTraffic = []; // must stay empty: the channel is gone

function send(...args) { win.webContents.send(...args); }
function evaluate(js) { return win.webContents.executeJavaScript(js, true); }

/** Record a couple of seconds of the synthetic camera to a real .webm file. */
async function recordClip() {
  // A throwaway file:// page of its own: data: URLs are not a secure context
  // (no navigator.mediaDevices), and the app's own pages expect the preload.
  const scratch = path.join(os.tmpdir(), `ldvd-e2e-rec-${process.pid}.html`);
  fs.writeFileSync(scratch, '<!DOCTYPE html><meta charset="utf-8"><body></body>');
  const recorder = new BrowserWindow({ show: false });
  await recorder.loadFile(scratch);
  const b64 = await recorder.webContents.executeJavaScript(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(res => { rec.onstop = res; });
    rec.start();
    await new Promise(r => setTimeout(r, 2200));
    rec.stop();
    await done;
    stream.getTracks().forEach(t => t.stop());
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  })()`, true);
  recorder.destroy();
  try { fs.unlinkSync(scratch); } catch (_) { /* best effort */ }
  fs.writeFileSync(CLIP, Buffer.from(b64, 'base64'));
  return CLIP;
}

// ══════════════════════════════════════════════════════════════════════

test('the video screen loads with no errors', async () => {
  await win.loadFile(UI);
  send('window-role', 'video');
  await sleep(300);
  const errs = rendererLog.filter(l => l.level === 'error');
  check(errs.length === 0, `renderer errors on load: ${JSON.stringify(errs)}`);
});

test('a test clip can be recorded (fixture setup)', async () => {
  await recordClip();
  const size = fs.statSync(CLIP).size;
  check(size > 5000, `clip is implausibly small (${size} bytes)`);
});

test('a local file loads and actually plays', async () => {
  send('playback-command', 'load', CLIP);
  await sleep(1500);

  const state = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('vid');
    return JSON.stringify({
      src: !!v.src, ready: v.readyState, paused: v.paused,
      t: v.currentTime, dur: v.duration, w: v.videoWidth, h: v.videoHeight,
      err: v.error ? v.error.code : null,
    });
  })()`));

  check(state.err === null, `video element reported error code ${state.err}`);
  check(state.src, 'no src was set');
  check(state.ready >= 3, `readyState is ${state.ready}, expected >= 3 (HAVE_FUTURE_DATA)`);
  check(state.w > 0 && state.h > 0, `no video dimensions (${state.w}x${state.h})`);
  check(!state.paused, 'video did not start playing');

  // currentTime must actually advance - a frozen first frame would pass
  // every check above.
  const t1 = await evaluate("document.getElementById('vid').currentTime");
  await sleep(700);
  const t2 = await evaluate("document.getElementById('vid').currentTime");
  check(t2 > t1, `playback is frozen (currentTime stuck at ${t1})`);
});

test('pause and play keep isPlaying in sync', async () => {
  // These listeners used to live inside the preview-capture setup; the
  // removal had to preserve them.
  send('playback-command', 'pause');
  await sleep(300);
  let s = JSON.parse(await evaluate(
    `JSON.stringify({ paused: document.getElementById('vid').paused, flag: isPlaying })`));
  check(s.paused === true, 'video did not pause');
  check(s.flag === false, `isPlaying is ${s.flag} after pause`);

  send('playback-command', 'play');
  await sleep(400);
  s = JSON.parse(await evaluate(
    `JSON.stringify({ paused: document.getElementById('vid').paused, flag: isPlaying })`));
  check(s.paused === false, 'video did not resume');
  check(s.flag === true, `isPlaying is ${s.flag} after play`);
});

test('seeking works', async () => {
  send('playback-command', 'seek', 1.0);
  await sleep(500);
  const t = await evaluate("document.getElementById('vid').currentTime");
  check(t >= 0.8, `seek did not land near 1.0s (currentTime ${t})`);
});

test('zoom still applies to the video element', async () => {
  send('playback-command', 'setZoom', { mode: 'cover', scale: 1.5 });
  await sleep(300);
  const style = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('vid');
    return JSON.stringify({ fit: v.style.objectFit, tf: v.style.transform });
  })()`));
  check(style.fit === 'cover', `objectFit is "${style.fit}"`);
  check(style.tf.includes('1.5'), `transform is "${style.tf}"`);
});

test('the dead preview channel is really gone', async () => {
  // The whole point of the change: no full-screen JPEG encode, no IPC traffic.
  await sleep(1200); // longer than the old 500ms capture interval
  check(previewTraffic.length === 0,
    `${previewTraffic.length} preview messages were still sent`);
  const gone = await evaluate(
    "typeof electronAPI.sendPreviewData === 'undefined' "
    + "&& !document.getElementById('preview-canvas')");
  check(gone === true, 'preview capture machinery is still present in the page');
});

test('the curtain blacks the screen without touching playback', async () => {
  // The whole contract of the video on/off button: the audience sees nothing,
  // the clip carries on. Turning it back on must therefore show wherever the
  // clip has reached, not a frozen frame from when it was hidden.
  send('playback-command', 'play');
  await sleep(300);
  const litBefore = await meanLuminance(win);
  check(litBefore > 8, `no picture to hide (luminance ${litBefore.toFixed(1)})`);

  send('playback-command', 'setVisible', false);
  await sleep(700); // the fade has to finish before the pixels settle

  const dark = await meanLuminance(win);
  check(dark < 2, `the screen is not black behind the curtain (luminance ${dark.toFixed(1)})`);

  const hidden = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('vid');
    return JSON.stringify({ paused: v.paused, t: v.currentTime, flag: isPlaying,
                            visible });
  })()`));
  check(hidden.paused === false, 'the curtain paused the clip; it should play on');
  check(hidden.flag === true, `isPlaying went ${hidden.flag} behind the curtain`);
  check(hidden.visible === false, 'the screen did not record itself as hidden');

  await sleep(500);
  const later = Number(await evaluate("document.getElementById('vid').currentTime"));
  check(later > hidden.t, `the clip stopped advancing behind the curtain (${hidden.t} -> ${later})`);
});

test('raising the curtain brings the picture back', async () => {
  send('playback-command', 'setVisible', true);
  await sleep(700);
  const lit = await meanLuminance(win);
  check(lit > 8, `the picture did not come back (luminance ${lit.toFixed(1)})`);
  const shown = await evaluate('visible');
  check(shown === true, 'the screen did not record itself as visible');
});

test('the curtain fades with the shared transition setting', async () => {
  // One setting drives the camera and the video, so a show does not have two
  // different fades in it.
  send('transition-settings', { type: 'fade', durationMs: 900, easing: 'linear' });
  await sleep(100);
  const css = await evaluate(
    "getComputedStyle(document.getElementById('video-container')).transitionDuration");
  check(/0\.9s|900ms/.test(css), `the fade did not follow the setting (${css})`);
  send('transition-settings', { type: 'fade', durationMs: 80, easing: 'linear' });
  await sleep(100);
});

test('stop pauses and rewinds, keeping the clip loaded', async () => {
  send('playback-command', 'stop');
  await sleep(400);
  const s = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('vid');
    return JSON.stringify({ src: !!v.getAttribute('src'), paused: v.paused,
                            t: v.currentTime, flag: isPlaying });
  })()`));
  check(s.paused === true, 'stop did not pause');
  check(s.t < 0.1, `stop did not rewind (currentTime ${s.t})`);
  check(s.flag === false, `isPlaying is ${s.flag} after stop`);
  // stop is not clear: the clip stays loaded so play resumes instantly.
  check(s.src === true, 'stop unloaded the clip; that is what clear is for');
});

test('clear unloads the clip and blacks the screen', async () => {
  send('playback-command', 'clear');
  await sleep(400);
  const s = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('vid');
    return JSON.stringify({ src: v.getAttribute('src'), flag: isPlaying });
  })()`));
  check(!s.src, `src is still set to "${s.src}"`);
  check(s.flag === false, `isPlaying is ${s.flag} after clear`);
});

test('a screen created later comes back curtained if that is how it was left', async () => {
  // A video screen assigned mid-service must not blurt out a clip the operator
  // had deliberately taken off the air.
  curtainedConfig = true;
  await win.loadFile(UI);
  send('window-role', 'video');
  await sleep(400);
  const state = JSON.parse(await evaluate(
    "JSON.stringify({ visible, op: document.getElementById('video-container').style.opacity })"));
  check(state.visible === false, 'the screen ignored the saved curtain');
  check(state.op === '0', `the screen restored visible (opacity ${state.op})`);
  curtainedConfig = false;
});

test('a missing file is reported, not swallowed', async () => {
  await win.loadFile(UI);
  send('window-role', 'video');
  await sleep(300);
  rendererLog.length = 0;
  send('playback-command', 'load', path.join(os.tmpdir(), 'ldvd-does-not-exist.mp4'));
  await sleep(1200);
  const reported = rendererLog.some(l => l.level === 'error' && /playback error/i.test(l.msg));
  check(reported, 'a missing file produced no error report');
});

// ══════════════════════════════════════════════════════════════════════

let curtainedConfig = false;

app.whenReady().then(async () => {
  ipcMain.handle('get-config', () => (curtainedConfig
    ? { playback: { visible: false }, transition: { type: 'fade', durationMs: 80, easing: 'linear' } }
    : {}));
  ipcMain.on('renderer-log', (_e, level, msg) => rendererLog.push({ level, msg }));
  ipcMain.on('video-time', () => {});
  // If anything still sends on the removed channel, this catches it.
  ipcMain.on('canvas-preview-data', (_e, d) => previewTraffic.push(d));

  win = new BrowserWindow({
    width: 640, height: 360, show: false, frame: false,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  let failed = 0;
  for (const t of results) {
    currentTest = { checks: 0 };
    const started = Date.now();
    try {
      await t.fn();
      console.log(`  ok   ${t.name}  (${currentTest.checks} checks, ${Date.now() - started}ms)`);
    } catch (err) {
      failed += 1;
      console.log(`  FAIL ${t.name}`);
      console.log(`       ${err.message}`);
    }
  }

  console.log(`\n  ${results.length - failed}/${results.length} passed`);
  try { fs.unlinkSync(CLIP); } catch (_) { /* best effort */ }
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(failed ? 1 : 0);
});
