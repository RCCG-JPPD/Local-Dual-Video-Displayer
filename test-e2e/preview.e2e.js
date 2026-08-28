/**
 * End-to-end checks for the operator PREVIEWS in the controller window.
 *
 *   npm run test:e2e
 *
 * The preview exists so nobody has to put a camera on the big screen to find
 * out what it is pointing at. Two things have to be true for that to hold, and
 * neither can be reached by a unit test:
 *
 *   1. The local-camera preview really opens the device and shows moving
 *      frames — and lets go of it again, because on many machines only one
 *      process can hold a webcam and the SCREEN must always win that fight.
 *   2. A multiview tile's <iframe> survives a re-render. Chromium reloads an
 *      iframe whenever it is re-parented, so a list rebuilt with innerHTML
 *      would restart every WebRTC connection — the previews would blink black
 *      each time anything else on the panel changed.
 *
 * The camera is Chromium's synthetic capture device, so this needs no hardware
 * and no permission prompt. The VDO.Ninja tiles are asserted on their DOM and
 * their src, never on loaded remote content: this run has no network and does
 * not need one.
 *
 * Kept out of `test/` on purpose: `npm test` is `node --test`, which cannot
 * load Electron. Kept out of build.files on purpose: it must not ship.
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui', 'controller.html');
const PRELOAD = path.join(__dirname, '..', 'preload.js');

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.disableHardwareAcceleration();

// ── tiny test harness (same shape as camera.e2e.js) ───────────────────
const results = [];
let currentTest = null;

function test(name, fn) { results.push({ name, fn }); }

function check(ok, detail) {
  if (!ok) throw new Error(detail);
  currentTest.checks += 1;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── the window under test ─────────────────────────────────────────────

let win = null;
const sentCommands = [];   // every camera-command the controller emitted

const SOURCES = [
  { id: 'a', label: 'Front', url: 'https://vdo.ninja/?view=aaa' },
  { id: 'b', label: 'Back', url: 'https://vdo.ninja/?view=bbb' },
];

const testConfig = {
  displays: [],
  playback: { playlist: [] },
  camera: {
    source: 'vdo', deviceId: '', live: false, visible: true, mirror: false,
    renderMode: 'video', preview: true,
    vdo: { sources: SOURCES, activeId: 'a', preloadAll: true },
  },
  zoom: { camera: { mode: 'cover', scale: 1 } },
  captions: {}, ocr: {}, logo: {}, transition: {},
};

function evaluate(js) {
  return win.webContents.executeJavaScript(js, true);
}

/** Drive the controller exactly as IPCHandler would. */
function send(channel, ...args) {
  win.webContents.send(channel, ...args);
}

async function openWindow() {
  win = new BrowserWindow({
    width: 1100, height: 800, show: false,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, nodeIntegration: false,
      sandbox: false, webviewTag: true,
    },
  });
  await win.loadFile(UI);
  await sleep(600); // let initialize() settle
  await evaluate("document.querySelector('[data-tab=\"camera\"]').click()");
  await sleep(300);
  return win;
}

// ══════════════════════════════════════════════════════════════════════
// MULTIVIEW TILES
// ══════════════════════════════════════════════════════════════════════

test('every source gets a tile with a thumbnail, and the on-air one is marked', async () => {
  await openWindow();
  const state = JSON.parse(await evaluate(`(() => {
    const tiles = Array.from(document.querySelectorAll('#vdoList .vdo-row'));
    return JSON.stringify(tiles.map(t => ({
      id: t.dataset.sourceId,
      onAir: t.classList.contains('on-air'),
      tag: t.querySelector('.thumb-tag').textContent,
      src: (t.querySelector('iframe') || {}).src || '',
      takeDisabled: t.querySelector('.vdo-take').disabled,
    })));
  })()`));

  check(state.length === 2, `expected 2 tiles, got ${state.length}`);
  check(state.every(t => t.src.includes('vdo.ninja')), `a tile has no thumbnail: ${JSON.stringify(state)}`);
  const onAir = state.filter(t => t.onAir);
  check(onAir.length === 1 && onAir[0].id === 'a', `wrong tile on air: ${JSON.stringify(state)}`);
  check(onAir[0].tag.includes('ON AIR'), `on-air tile is not badged: ${onAir[0].tag}`);
  check(onAir[0].takeDisabled, 'the on-air tile still offers to be taken');
  const preview = state.find(t => !t.onAir);
  check(preview.tag === 'PREVIEW', `off-air tile is not badged PREVIEW: ${preview.tag}`);
});

test('no thumbnail asks for audio — not the preview, not the one on air', async () => {
  // Sources stay connected so cuts are instant, so every one of them receives
  // at once. Audio on any of them is a feedback loop beside the PA.
  const srcs = JSON.parse(await evaluate(`
    JSON.stringify(Array.from(document.querySelectorAll('#vdoList iframe')).map(f => f.src))`));
  check(srcs.length === 2, `expected 2 thumbnails, got ${srcs.length}`);
  srcs.forEach((s) => {
    check(s.includes('noaudio'), `thumbnail is not noaudio: ${s}`);
    check(s.includes('muted'), `thumbnail is not muted: ${s}`);
    check(s.includes('cleanoutput'), `thumbnail keeps VDO.Ninja's own UI: ${s}`);
  });
});

test('a thumbnail survives a re-render — the same element, never reloaded', async () => {
  // The point of the whole tile-reuse design: re-parenting an iframe makes
  // Chromium reload it, which would drop and re-do the WebRTC handshake.
  const stable = await evaluate(`(() => {
    const frame = document.querySelector('#vdoList .vdo-row iframe');
    frame.dataset.marked = 'yes';          // survives only if the element does
    const before = frame.src;
    renderVdo(); renderVdo(); renderVdo();
    const after = document.querySelector('#vdoList .vdo-row iframe');
    return after === frame && after.dataset.marked === 'yes' && after.src === before;
  })()`);
  check(stable, 'the thumbnail iframe was rebuilt by a re-render');
});

test('clicking a tile puts that camera on air', async () => {
  sentCommands.length = 0;
  await evaluate("document.querySelector('[data-source-id=\"b\"] .vdo-thumb').click()");
  await sleep(150);

  const take = sentCommands.filter(c => c.cmd === 'setVdo').pop();
  check(!!take, `no setVdo was sent: ${JSON.stringify(sentCommands)}`);
  check(take.data.activeId === 'b', `wrong camera taken: ${JSON.stringify(take.data)}`);

  const marks = JSON.parse(await evaluate(`(() => {
    const t = Array.from(document.querySelectorAll('#vdoList .vdo-row'));
    return JSON.stringify(t.map(x => [x.dataset.sourceId, x.classList.contains('on-air')]));
  })()`));
  check(JSON.stringify(marks) === JSON.stringify([['a', false], ['b', true]]),
    `the multiview did not follow the cut: ${JSON.stringify(marks)}`);
});

test('turning previews off drops the connections and says so', async () => {
  await evaluate('setPreviewEnabled(false)');
  await sleep(150);
  const off = JSON.parse(await evaluate(`(() => {
    const tiles = Array.from(document.querySelectorAll('#vdoList .vdo-row'));
    return JSON.stringify({
      frames: document.querySelectorAll('#vdoList iframe').length,
      msg: tiles[0].querySelector('.thumb-msg').textContent,
      camBox: document.getElementById('camPreviewBox').style.display,
    });
  })()`));
  check(off.frames === 0, `${off.frames} thumbnails still connected after switching previews off`);
  check(/off/i.test(off.msg), `no explanation shown in the tile: "${off.msg}"`);

  await evaluate('setPreviewEnabled(true)');
  await sleep(200);
  const back = Number(await evaluate("document.querySelectorAll('#vdoList iframe').length"));
  check(back === 2, `thumbnails did not come back (${back})`);
});

// ══════════════════════════════════════════════════════════════════════
// LOCAL CAMERA PREVIEW
// ══════════════════════════════════════════════════════════════════════

test('switching to the local camera opens a live preview', async () => {
  await evaluate("setSourceKind('device')");
  await sleep(1500); // the fake device takes a moment to produce frames

  const state = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('camPreview');
    return JSON.stringify({
      shown: document.getElementById('camPreviewBox').style.display !== 'none',
      w: v.videoWidth, h: v.videoHeight,
      tracks: v.srcObject ? v.srcObject.getVideoTracks().length : 0,
      audio: v.srcObject ? v.srcObject.getAudioTracks().length : 0,
      msg: document.getElementById('camPreviewMsg').textContent,
    });
  })()`));

  check(state.shown, 'the preview box is hidden on the local-camera source');
  check(state.tracks === 1, `expected one video track, got ${state.tracks} (${state.msg})`);
  check(state.audio === 0, 'the preview opened a microphone');
  check(state.w > 0 && state.h > 0, `the preview has no picture (${state.w}x${state.h})`);
});

test('the preview follows the mirror setting, so it lies the way the screen does', async () => {
  await evaluate("document.getElementById('camMirror').checked = true;"
    + "document.getElementById('camMirror').onchange({ target: { checked: true } })");
  const flipped = await evaluate("document.getElementById('camPreview').style.transform");
  check(/scaleX\(-1\)/.test(flipped), `preview was not mirrored: "${flipped}"`);

  await evaluate("document.getElementById('camMirror').onchange({ target: { checked: false } })");
  const plain = await evaluate("document.getElementById('camPreview').style.transform");
  check(!/scaleX\(-1\)/.test(plain), `preview stayed mirrored: "${plain}"`);
});

test('going on air hands the device to the screen BEFORE asking for it back', async () => {
  // The ordering is the whole safety property: on a device that only allows
  // one holder, whoever asks first wins, and that must not be the preview.
  sentCommands.length = 0;
  const order = JSON.parse(await evaluate(`(() => {
    const seen = [];
    const realStop = stopDevicePreview;
    const v = document.getElementById('camPreview');
    stopDevicePreview = () => { seen.push('released'); realStop(); };
    const realSend = electronAPI.sendCameraCommand;
    setCameraLive(true);
    seen.push('told-screen');
    stopDevicePreview = realStop;
    return JSON.stringify({ seen, held: !!v.srcObject });
  })()`));

  check(order.seen[0] === 'released',
    `the preview was still holding the camera when the screen was told: ${order.seen}`);
  check(order.held === false, 'the preview kept its stream open while going on air');

  const live = sentCommands.filter(c => c.cmd === 'live').pop();
  check(live && live.data === true, `no live command reached the screen: ${JSON.stringify(sentCommands)}`);
});

test('leaving the camera tab releases the device', async () => {
  await sleep(1600); // let the best-effort re-open happen first
  await evaluate("document.querySelector('[data-tab=\"clock\"]').click()");
  await sleep(200);
  const held = await evaluate("!!document.getElementById('camPreview').srcObject");
  check(held === false, 'the webcam is still open on a tab that is not showing it');

  await evaluate("document.querySelector('[data-tab=\"camera\"]').click()");
  await sleep(1200);
});

// ══════════════════════════════════════════════════════════════════════
// VIRTUAL CAMERAS
// ══════════════════════════════════════════════════════════════════════

// The real device list from the venue machine. A virtual camera can normally
// be read by one program at a time, so anything this app opens is taken away
// from Zoom — and the symptom never points back here.
const VENUE_DEVICES = [
  { deviceId: 'c16923c1', label: 'USB  Camera (0c45:6366)' },
  { deviceId: 'ffe1e7e6', label: 'Game Capture 4K60 Pro MK.2' },
  { deviceId: 'e986a839', label: 'OBS-Camera' },
  { deviceId: '0a8f7b97', label: 'OBS-Camera2' },
  { deviceId: '27fddab4', label: 'VDO.Ninja Camera' },
  { deviceId: '52740b56', label: 'OBS Virtual Camera' },
  { deviceId: '9221894c', label: 'Elgato Screen Link' },
];

test('the picker offers real cameras only, and says where the others went', async () => {
  await evaluate("setSourceKind('device')");
  send('camera-devices', VENUE_DEVICES.map(d => ({ ...d, virtual: /obs|vdo\.ninja/i.test(d.label) })));
  await sleep(300);

  const ui = JSON.parse(await evaluate(`(() => {
    const sel = document.getElementById('camDevice');
    return JSON.stringify({
      options: Array.from(sel.options).map(o => o.textContent),
      hint: document.getElementById('camHint').textContent,
    });
  })()`));

  check(!ui.options.some(o => /OBS/i.test(o)),
    `an OBS device is offered in the picker: ${JSON.stringify(ui.options)}`);
  check(!ui.options.some(o => /System default/i.test(o)),
    'the picker still offers the system default, which is what grabs OBS');
  check(ui.options.length === 3,
    `expected the 3 real cameras, got ${JSON.stringify(ui.options)}`);
  check(/OBS Virtual Camera/.test(ui.hint) && /Zoom/.test(ui.hint),
    `the hidden cameras are not explained: "${ui.hint}"`);
});

test('the preview never asks for a virtual camera, or for the default', async () => {
  // Record what the page actually requests, rather than what it says it does.
  await evaluate(`(() => {
    window.__asked = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => {
      window.__asked.push(JSON.stringify((c && c.video) || null));
      return real(c);
    };
    return true;
  })()`);

  await evaluate("stopDevicePreview(); syncDevicePreview();");
  await sleep(1200);

  const asked = JSON.parse(await evaluate('JSON.stringify(window.__asked)'));
  check(asked.length > 0, 'the preview asked for nothing at all');
  asked.forEach((a) => {
    check(/"exact"/.test(a), `the preview asked without an exact deviceId: ${a}`);
    ['52740b56', 'e986a839', '0a8f7b97', '27fddab4'].forEach((id) => {
      check(!a.includes(id), `the preview asked for a virtual camera: ${a}`);
    });
  });
});

test('a saved choice of OBS is refused, not honoured', async () => {
  // An older config can name OBS Virtual Camera, saved before this rule
  // existed. Opening it would recreate the exact bug.
  const chosen = await evaluate(
    "electronAPI.cameras.resolveDeviceId("
    + JSON.stringify(VENUE_DEVICES) + ", '52740b56')");
  check(chosen === 'c16923c1', `a saved OBS choice resolved to "${chosen}"`);
});

// ══════════════════════════════════════════════════════════════════════
// COMING BACK AFTER A RESET
// ══════════════════════════════════════════════════════════════════════

// Reported live, mid-service: "when I change songs the camera does not come
// back, or when I click show on screen". RESET is what an operator reaches for
// between songs, and it hides the stage while deliberately leaving the source
// running — so `live` stayed true, and the big button, which toggled on
// `live`, sent live:FALSE on the next press. For a VDO.Ninja source that does
// nothing at all, so the camera stayed gone until the button was pressed a
// second time.

test('after a RESET the button says OFF, even though the source is still running', async () => {
  await evaluate("setSourceKind('vdo'); setCameraLive(true);");
  await sleep(150);
  const on = JSON.parse(await evaluate(
    "JSON.stringify({ live: camState.live, visible: camState.visible, "
    + "red: document.getElementById('camLiveBtn').classList.contains('live') })"));
  check(on.live === true && on.visible !== false, `not on air to begin with: ${JSON.stringify(on)}`);
  check(on.red === true, 'the button is not showing ON AIR while the camera is up');

  send('camera-reset'); // the global Ctrl/Cmd+Shift+0 path
  await sleep(200);

  const after = JSON.parse(await evaluate(
    "JSON.stringify({ live: camState.live, visible: camState.visible, "
    + "red: document.getElementById('camLiveBtn').classList.contains('live') })"));
  check(after.visible === false, 'the controller did not notice the screen was cleared');
  check(after.red === false,
    'the button still claims ON AIR with nothing on the screen — its next press '
    + 'would turn the source off instead of bringing the picture back');
});

test('one press of the big button brings the camera back, not two', async () => {
  sentCommands.length = 0;
  await evaluate("document.getElementById('camLiveBtn').click()");
  await sleep(200);

  const sent = sentCommands.map(c => `${c.cmd}:${c.data}`);
  check(!sent.includes('live:false'),
    `the press turned the source OFF instead of showing it: ${JSON.stringify(sent)}`);
  check(sentCommands.some(c => c.cmd === 'restore'),
    `no restore reached the screen: ${JSON.stringify(sent)}`);

  const back = JSON.parse(await evaluate(
    "JSON.stringify({ live: camState.live, visible: camState.visible, "
    + "red: document.getElementById('camLiveBtn').classList.contains('live') })"));
  check(back.visible === true && back.live === true,
    `the camera did not come back: ${JSON.stringify(back)}`);
  check(back.red === true, 'the button does not show ON AIR after coming back');
});

test('showing the camera also lifts a blackout, so SHOW always means a picture', async () => {
  await evaluate("const b = document.getElementById('camBlank');"
    + "b.checked = true; b.onchange({ target: b });");
  sentCommands.length = 0;
  await evaluate('showCamera()');
  await sleep(150);
  const blanked = await evaluate("document.getElementById('camBlank').checked");
  check(blanked === false, 'blackout survived a SHOW, so the screen stays black');
  check(sentCommands.some(c => c.cmd === 'blank' && c.data === false),
    'the screen was never told to un-blank');
});

// NOTE: the phone's cam.off path was fixed alongside this — it used to click
// the big button, which now means SHOW when the screen is hidden, so routing
// OFF through it would have inverted the phone control. It is not covered
// here: dispatchRemote lives inside the Remote Mode IIFE and is not reachable
// from a test, and restructuring app code to reach it was not worth the risk
// mid-service.

// ══════════════════════════════════════════════════════════════════════

app.whenReady().then(async () => {
  // Stand in for the parts of IPCHandler the controller talks to.
  ipcMain.handle('get-config', () => testConfig);
  ipcMain.handle('get-displays', () => []);
  ipcMain.handle('get-window-status', () => ({}));
  ipcMain.handle('get-screen-previews', () => []);
  ipcMain.handle('ocr-get-state', () => ({ running: false }));
  ipcMain.handle('remote-get-state', () => ({ active: false, persistCode: false }));
  ipcMain.on('camera-command', (_e, cmd, data) => sentCommands.push({ cmd, data }));
  ipcMain.on('renderer-log', () => {});
  // Everything else the controller may emit but this run does not assert on.
  ['caption-settings', 'caption-text', 'logo-settings', 'transition-settings',
    'ocr-command', 'camera-recreate'].forEach(ch => ipcMain.on(ch, () => {}));

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
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(failed ? 1 : 0);
});
