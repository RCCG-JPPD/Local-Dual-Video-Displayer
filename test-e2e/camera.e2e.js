/**
 * End-to-end checks for the camera screen, run inside a real Electron.
 *
 *   npm run test:e2e
 *
 * These assert on ACTUAL RENDERED PIXELS from `capturePage()`, which is the
 * only way to prove the things that unit tests cannot reach: that the caption
 * lands where the settings say, that RESET really fades to nothing, that the
 * logo is drawn, and that a camera stream reaches the <video> element.
 *
 * The camera is Chromium's synthetic capture device
 * (--use-fake-device-for-media-stream), a rolling colour pattern, so the
 * getUserMedia path is exercised for real with no hardware and no permission
 * prompt.
 *
 * Kept out of `test/` on purpose: `npm test` is `node --test`, which cannot
 * load Electron. Kept out of build.files on purpose: it must not ship.
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const UI = path.join(__dirname, '..', 'src', 'ui', 'cameraDisplay.html');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const W = 800;
const H = 450; // 16:9, matching the aspect the caption maths assumes

// A synthetic camera, and no permission prompt for it.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.disableHardwareAcceleration(); // deterministic pixels in a headless run

// ── tiny test harness ─────────────────────────────────────────────────
const results = [];
let currentTest = null;

function test(name, fn) { results.push({ name, fn }); }

function check(ok, detail) {
  if (!ok) throw new Error(detail);
  currentTest.checks += 1;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── pixel helpers ─────────────────────────────────────────────────────

/**
 * capturePage → a BGRA bitmap plus helpers.
 * Electron gives back premultiplied BGRA in the platform's byte order.
 */
async function grab(win) {
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const buf = image.toBitmap();
  const at = (x, y) => {
    const i = (Math.floor(y) * size.width + Math.floor(x)) * 4;
    return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] };
  };
  return {
    size,
    at,
    /** Mean luminance over a fractional rect of the image, 0..255. */
    brightness(fx, fy, fw, fh) {
      const x0 = Math.floor(fx * size.width);
      const y0 = Math.floor(fy * size.height);
      const x1 = Math.min(size.width, Math.ceil((fx + fw) * size.width));
      const y1 = Math.min(size.height, Math.ceil((fy + fh) * size.height));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = at(x, y);
          sum += 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
          n += 1;
        }
      }
      return n ? sum / n : 0;
    },
    /** How many pixels in a fractional rect are brighter than `threshold`. */
    brightPixels(fx, fy, fw, fh, threshold = 200) {
      const x0 = Math.floor(fx * size.width);
      const y0 = Math.floor(fy * size.height);
      const x1 = Math.min(size.width, Math.ceil((fx + fw) * size.width));
      const y1 = Math.min(size.height, Math.ceil((fy + fh) * size.height));
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const p = at(x, y);
          if (0.299 * p.r + 0.587 * p.g + 0.114 * p.b > threshold) n += 1;
        }
      }
      return n;
    },
  };
}

// ── the window under test ─────────────────────────────────────────────

let win = null;
const rendererLog = [];

/** Config handed to the screen, standing in for the real config file. */
let testConfig = {};

function makeConfig(over = {}) {
  return {
    camera: { deviceId: '', live: false, visible: true, mirror: false, renderMode: 'video' },
    zoom: { camera: { mode: 'cover', scale: 1 } },
    captions: {},
    logo: {},
    transition: { type: 'fade', durationMs: 80, easing: 'linear' },
    ...over,
  };
}

async function openWindow(config) {
  testConfig = config;
  win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    // The real camera window is transparent; a black backdrop is painted
    // underneath in the tests that need to measure the feed.
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: false,
    },
  });
  await win.loadFile(UI);
  await sleep(250); // let the self-restore from config settle
  return win;
}

/** Drive the screen exactly as IPCHandler.broadcastToRole would. */
function send(channel, ...args) {
  win.webContents.send(channel, ...args);
}

/** Read a value out of the page. */
function evaluate(js) {
  return win.webContents.executeJavaScript(js, true);
}

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

test('the camera screen loads and reports no errors', async () => {
  await openWindow(makeConfig());
  const errors = rendererLog.filter(l => l.level === 'error');
  check(errors.length === 0, `renderer errors on load: ${JSON.stringify(errors)}`);
  const title = await evaluate('document.title');
  check(title === 'Camera Display', `unexpected title: ${title}`);
});

test('getUserMedia delivers a live camera stream to the <video>', async () => {
  send('camera-command', 'live', true);
  await sleep(1200); // the fake device takes a moment to produce frames

  const state = await evaluate(`(() => {
    const v = document.getElementById('cam');
    return JSON.stringify({
      w: v.videoWidth, h: v.videoHeight,
      hasStream: !!v.srcObject,
      tracks: v.srcObject ? v.srcObject.getVideoTracks().length : 0,
      live: v.srcObject ? v.srcObject.getVideoTracks()[0].readyState : 'none',
      paused: v.paused,
    });
  })()`);
  const s = JSON.parse(state);
  check(s.hasStream, 'no MediaStream attached to the <video>');
  check(s.tracks === 1, `expected 1 video track, got ${s.tracks}`);
  check(s.live === 'live', `track readyState is "${s.live}"`);
  check(s.w > 0 && s.h > 0, `video has no dimensions (${s.w}x${s.h})`);
  check(!s.paused, 'the video element is paused');

  // And it is genuinely painting: the fake device is a bright colour pattern.
  const shot = await grab(win);
  const lit = shot.brightness(0.2, 0.2, 0.6, 0.6);
  check(lit > 12, `frame looks blank (mean luminance ${lit.toFixed(1)})`);
});

test('audio is never captured (feedback safety)', async () => {
  const audio = await evaluate(`(() => {
    const v = document.getElementById('cam');
    return v.srcObject ? v.srcObject.getAudioTracks().length : -1;
  })()`);
  check(audio === 0, `expected 0 audio tracks, got ${audio}`);
});

test('a caption renders where the settings say, and moves when they change', async () => {
  const style = {
    fontSize: 9, width: 90, color: '#ffffff', outline: 'none',
    animation: 'none', uppercase: true, margin: 4,
  };

  // Bottom-centre: ink in the bottom third, none in the top third.
  send('caption-settings', { ...style, position: 'bottom-center' });
  send('caption-text', { text: 'AMAZING GRACE', source: 'manual' });
  await sleep(350);
  let shot = await grab(win);
  const bottom = shot.brightPixels(0, 0.66, 1, 0.34);
  const top = shot.brightPixels(0, 0, 1, 0.34);
  check(bottom > 150, `expected caption ink in the bottom third, found ${bottom}px`);
  check(bottom > top * 3, `caption is not bottom-weighted (bottom ${bottom}px vs top ${top}px)`);

  // Same text, top-centre: the weighting must invert.
  send('caption-settings', { ...style, position: 'top-center' });
  send('caption-text', { text: 'HOLY IS THE LORD', source: 'manual' });
  await sleep(350);
  shot = await grab(win);
  const top2 = shot.brightPixels(0, 0, 1, 0.34);
  const bottom2 = shot.brightPixels(0, 0.66, 1, 0.34);
  check(top2 > 150, `expected caption ink in the top third, found ${top2}px`);
  check(top2 > bottom2 * 3, `caption did not move to the top (top ${top2}px vs bottom ${bottom2}px)`);
});

test('the caption clears when asked', async () => {
  send('caption-text', { text: '', source: 'manual' });
  await sleep(350);
  const shown = await evaluate(
    `[...document.querySelectorAll('.caption')].map(e => e.textContent.trim()).join('|')`,
  );
  check(shown === '|' || shown === '', `captions still read "${shown}"`);
});

test('an unchanged lyric does not re-animate (the anti-flicker guarantee)', async () => {
  send('caption-settings', { animation: 'fade', animationMs: 200, position: 'bottom-center' });
  send('caption-text', { text: 'THAT SAVED A WRETCH LIKE ME', source: 'ocr' });
  await sleep(400);

  // Which buffer is showing, and what it says, must not change when the same
  // line arrives again - that is what stops the caption strobing on stage.
  const before = await evaluate(`(() => {
    const a = document.getElementById('cap-a'), b = document.getElementById('cap-b');
    return JSON.stringify({ a: a.textContent, b: b.textContent,
      ao: getComputedStyle(a).opacity, bo: getComputedStyle(b).opacity });
  })()`);

  for (let i = 0; i < 4; i += 1) {
    send('caption-text', { text: 'THAT SAVED A WRETCH LIKE ME', source: 'ocr' });
    await sleep(60);
  }
  await sleep(300);

  const after = await evaluate(`(() => {
    const a = document.getElementById('cap-a'), b = document.getElementById('cap-b');
    return JSON.stringify({ a: a.textContent, b: b.textContent,
      ao: getComputedStyle(a).opacity, bo: getComputedStyle(b).opacity });
  })()`);
  check(before === after, `the caption re-animated on an identical line:\n  ${before}\n  ${after}`);

  // A one-character OCR wobble must also be absorbed.
  send('caption-text', { text: 'THAT SAVED A WRETCH L1KE ME', source: 'ocr' });
  await sleep(300);
  const wobbled = await evaluate(
    `document.getElementById('cap-a').textContent + '|' + document.getElementById('cap-b').textContent`,
  );
  check(wobbled.includes('THAT SAVED A WRETCH LIKE ME'),
    `an OCR wobble replaced the caption: "${wobbled}"`);
});

test('a genuinely new line DOES replace the caption', async () => {
  send('caption-text', { text: 'I ONCE WAS LOST BUT NOW AM FOUND', source: 'ocr' });
  await sleep(400);
  const shown = await evaluate(
    `[...document.querySelectorAll('.caption')].map(e => e.textContent).join('|')`,
  );
  check(shown.includes('I ONCE WAS LOST BUT NOW AM FOUND'),
    `the new line was not shown: "${shown}"`);
});

test('caption text is never interpreted as markup', async () => {
  // Caption text is OCR of ANOTHER application's screen. It is machine-read
  // from content this app does not control, so it must reach the DOM as text
  // and never as markup.
  const nasty = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  send('caption-settings', { animation: 'none', position: 'bottom-center' });
  send('caption-text', { text: nasty, source: 'ocr' });
  await sleep(400);

  const result = JSON.parse(await evaluate(`(() => {
    const els = [...document.querySelectorAll('.caption')];
    return JSON.stringify({
      pwned: !!window.__pwned,
      imgs: document.querySelectorAll('.caption img').length,
      scripts: document.querySelectorAll('.caption script').length,
      text: els.map(e => e.textContent).join(''),
    });
  })()`));

  check(result.pwned === false, 'injected script executed');
  check(result.imgs === 0, `${result.imgs} <img> element(s) were created from caption text`);
  check(result.scripts === 0, `${result.scripts} <script> element(s) were created`);
  check(result.text.includes('<img'), 'the text was not shown verbatim');

  send('caption-text', { text: '', source: 'manual' });
  await sleep(300);
});

test('the typewriter animation actually types', async () => {
  send('caption-settings', {
    animation: 'typewriter', animationMs: 900, position: 'bottom-center', fontSize: 7,
  });
  send('caption-text', { text: 'AMAZING GRACE HOW SWEET THE SOUND', source: 'manual' });
  await sleep(250);

  const partial = await evaluate(
    "[...document.querySelectorAll('.caption')].map(e => e.textContent).join('|')");
  await sleep(1100);
  const full = await evaluate(
    "[...document.querySelectorAll('.caption')].map(e => e.textContent).join('|')");

  const target = 'AMAZING GRACE HOW SWEET THE SOUND';
  check(full.includes(target), `the line never completed: "${full}"`);
  // Mid-flight it must be a strict prefix, not the whole line at once.
  const shown = partial.replace(/\|/g, '');
  check(shown.length < target.length, `typewriter showed everything at once: "${partial}"`);
  check(target.startsWith(shown.trim()) || shown.trim() === '',
    `typewriter output is not a prefix of the line: "${shown}"`);

  send('caption-settings', { animation: 'none' });
  send('caption-text', { text: '', source: 'manual' });
  await sleep(300);
});

test('every caption position and animation renders without error', async () => {
  // A cheap sweep: any combination that threw would leave the screen blank
  // mid-song, and there are 63 of them.
  const positions = await evaluate('JSON.stringify(electronAPI.captions.POSITIONS)');
  const animations = await evaluate('JSON.stringify(electronAPI.captions.ANIMATIONS)');
  const before = rendererLog.filter(l => l.level === 'error').length;

  for (const position of JSON.parse(positions)) {
    for (const animation of JSON.parse(animations)) {
      send('caption-settings', { position, animation, animationMs: 0, fontSize: 6 });
      send('caption-text', { text: `${position} / ${animation}`, source: 'manual' });
    }
  }
  await sleep(900);

  const errs = rendererLog.filter(l => l.level === 'error').slice(before);
  check(errs.length === 0, `errors while sweeping caption styles: ${JSON.stringify(errs)}`);

  // And the caption layer still works afterwards - the failure this guards
  // against is a bad combination leaving a buffer stuck invisible.
  send('caption-settings', {
    position: 'bottom-center', animation: 'none', fontSize: 9, width: 90,
    color: '#ffffff', outline: 'none', uppercase: true,
  });
  send('caption-text', { text: 'STILL WORKING', source: 'manual' });
  await sleep(500);
  const shot = await grab(win);
  check(shot.brightPixels(0, 0.66, 1, 0.34) > 100,
    'the caption layer stopped drawing after sweeping every style');

  send('caption-text', { text: '', source: 'manual' });
  await sleep(300);
});

test('zoom and mirror reach the camera element', async () => {
  send('camera-command', 'live', true);
  await sleep(900);
  send('camera-command', 'setZoom', { mode: 'cover', scale: 1.4 });
  await sleep(250);
  let st = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('cam');
    return JSON.stringify({ fit: v.style.objectFit, tf: v.style.transform });
  })()`));
  check(st.fit === 'cover', `objectFit is "${st.fit}"`);
  check(st.tf.includes('1.4'), `transform is "${st.tf}"`);
  check(!st.tf.includes('scaleX(-1)'), 'mirrored before being asked to');

  send('camera-command', 'mirror', true);
  await sleep(250);
  st = JSON.parse(await evaluate(`(() => {
    const v = document.getElementById('cam');
    return JSON.stringify({ tf: v.style.transform });
  })()`));
  check(st.tf.includes('scaleX(-1)'), `mirror did not apply: "${st.tf}"`);
  // Mirroring rides on top of the zoom, so both must survive together.
  check(st.tf.includes('1.4'), `mirror clobbered the zoom: "${st.tf}"`);

  send('camera-command', 'mirror', false);
  await sleep(200);
});

test('RESET fades the screen to fully transparent', async () => {
  // Something must be on screen first, or the test proves nothing.
  send('camera-command', 'live', true);
  send('caption-text', { text: 'BEFORE RESET', source: 'manual' });
  await sleep(600);
  const before = await grab(win);
  const litBefore = before.brightness(0, 0, 1, 1);
  check(litBefore > 8, `nothing visible before RESET (luminance ${litBefore.toFixed(1)})`);

  send('camera-command', 'reset', null);
  await sleep(500); // fade is 80ms in the test config

  const opacity = await evaluate("getComputedStyle(document.getElementById('stage')).opacity");
  check(Number(opacity) === 0, `stage opacity is ${opacity}, expected 0`);

  // The window is transparent, so a faded stage must leave zero alpha - this
  // is what lets the app behind (the lyrics software) show through.
  const after = await grab(win);
  const centre = after.at(after.size.width / 2, after.size.height / 2);
  check(centre.a === 0, `pixel alpha after RESET is ${centre.a}, expected 0 (fully see-through)`);
  const litAfter = after.brightness(0, 0, 1, 1);
  check(litAfter < 1, `screen is not blank after RESET (luminance ${litAfter.toFixed(1)})`);
});

test('the camera stream is released after a reset', async () => {
  // The fade deliberately outlives the stop, so give it room.
  await sleep(400);
  const tracks = await evaluate(`(() => {
    const v = document.getElementById('cam');
    return v.srcObject ? v.srcObject.getVideoTracks().filter(t => t.readyState === 'live').length : 0;
  })()`);
  check(tracks === 0, `${tracks} camera track(s) still live after RESET — the camera light stays on`);
});

test('restore brings the screen back', async () => {
  send('camera-command', 'restore', null);
  await sleep(900);
  const opacity = await evaluate("getComputedStyle(document.getElementById('stage')).opacity");
  check(Number(opacity) === 1, `stage opacity is ${opacity}, expected 1`);
  const shot = await grab(win);
  const lit = shot.brightness(0.2, 0.2, 0.6, 0.6);
  check(lit > 8, `screen still blank after restore (luminance ${lit.toFixed(1)})`);
});

test('the logo is drawn in the corner it is given', async () => {
  // An 8x8 solid red PNG, inlined so the test needs no fixture on disk.
  const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mP4z8CAFTEMLQkAKP8/wc53yE8AAAAASUVORK5CYII=';

  // logoStyles() drives the geometry; point the <img> straight at the data URI
  // so this test covers placement without depending on the file dialog.
  await evaluate(`(() => {
    const l = document.getElementById('logo');
    Object.assign(l.style, electronAPI.logo.styles(
      { enabled: true, source: 'x.png', position: 'top-right', size: 20, opacity: 1, margin: 4 }));
    l.src = ${JSON.stringify(RED_PNG)};
    return true;
  })()`);
  // Wait for the decode instead of guessing - a broken data URI would
  // otherwise look identical to a placement bug.
  const loaded = await evaluate(`(() => {
    const l = document.getElementById('logo');
    return new Promise(res => {
      if (l.complete && l.naturalWidth) return res(l.naturalWidth);
      l.onload = () => res(l.naturalWidth);
      l.onerror = () => res(-1);
      setTimeout(() => res(l.naturalWidth || 0), 2000);
    });
  })()`);
  check(loaded > 0, `the logo image failed to decode (naturalWidth ${loaded})`);
  await sleep(250);

  const shot = await grab(win);
  const redness = (fx, fy) => {
    let n = 0;
    const x0 = Math.floor(fx * shot.size.width);
    const y0 = Math.floor(fy * shot.size.height);
    for (let y = y0; y < y0 + Math.floor(0.15 * shot.size.height); y += 1) {
      for (let x = x0; x < x0 + Math.floor(0.2 * shot.size.width); x += 1) {
        const p = shot.at(x, y);
        if (p.r > 120 && p.r > p.g * 2 && p.r > p.b * 2) n += 1;
      }
    }
    return n;
  };
  const topRight = redness(0.78, 0.02);
  const topLeft = redness(0.02, 0.02);
  check(topRight > 50, `no logo found in the top-right (${topRight} red px)`);
  check(topRight > topLeft * 3, `logo is not in the right corner (right ${topRight} vs left ${topLeft})`);
});

test('blackout covers the screen (and is not the same as RESET)', async () => {
  send('camera-command', 'blank', true);
  await sleep(250);
  const shot = await grab(win);
  const centre = shot.at(shot.size.width / 2, shot.size.height / 2);
  check(centre.a > 250, `blackout should be OPAQUE, alpha was ${centre.a}`);
  check(centre.r < 12 && centre.g < 12 && centre.b < 12,
    `blackout is not black: rgb(${centre.r},${centre.g},${centre.b})`);
  send('camera-command', 'blank', false);
  await sleep(200);
});

test('VDO.Ninja sources mount as visible, fadeable iframes', async () => {
  // A local stand-in for vdo.ninja: this proves the mounting, switching and
  // compositing, which is what could break. The real service needs a network
  // and a phone, so it cannot live in an automated suite.
  const fs = require('fs');
  const os = require('os');
  // Name and colour kept separate: a '#' in the filename gets decoded back
  // out of the file:// URL and the load fails.
  const guest = (name, css) => {
    const f = path.join(os.tmpdir(), `ldvd-vdo-${name}-${process.pid}.html`);
    fs.writeFileSync(f, '<!DOCTYPE html><meta charset="utf-8">'
      + `<body style="margin:0;background:${css}"></body>`);
    return f;
  };
  const red = guest('red', 'rgb(255,0,0)');
  const blue = guest('blue', 'rgb(0,0,255)');

  send('camera-command', 'setSource', 'vdo');
  await sleep(200);

  // Inject the frames directly: the production path validates against the
  // vdo.ninja allowlist, which a file:// stand-in cannot satisfy.
  await evaluate(`(() => {
    const layer = document.getElementById('vdo-layer');
    layer.innerHTML = '';
    for (const [id, src] of [['a', ${JSON.stringify('file://' + red)}],
                             ['b', ${JSON.stringify('file://' + blue)}]]) {
      const f = document.createElement('iframe');
      f.dataset.sourceId = id; f.src = src;
      layer.appendChild(f);
    }
    // applyVdo() hides the hint when a source is on air; this test injects the
    // frames directly, so do it by hand or the hint's 45%-black panel sits
    // over the sample point.
    document.getElementById('hint').classList.add('hidden');
    return true;
  })()`);
  // Drive the real cut function rather than poking the DOM, so the transition
  // logic is under test too.
  await evaluate("takeSource('a'); true");
  await sleep(700);

  const isRed = (p) => p.r > 120 && p.r > p.g * 2 && p.r > p.b * 2;
  const isBlue = (p) => p.b > 120 && p.b > p.r * 2 && p.b > p.g * 2;

  let shot = await grab(win);
  let mid = shot.at(shot.size.width / 2, shot.size.height / 2);
  if (!isRed(mid)) {
    // Say WHY rather than just "not red": the usual causes are the hint panel
    // sitting over the sample point, or the frame never coming up.
    const why = await evaluate(`(() => {
      const cs = getComputedStyle;
      const f = document.querySelector('[data-source-id="a"]');
      return JSON.stringify({
        hint: cs(document.getElementById('hint')).display,
        stage: cs(document.getElementById('stage')).opacity,
        frameOpacity: f ? cs(f).opacity : 'no frame',
        frames: document.getElementById('vdo-layer').children.length,
        body: document.body.className,
      });
    })()`);
    check(false, `source A is not on screen: rgb(${mid.r},${mid.g},${mid.b}) — ${why}`);
  }
  check(isRed(mid), 'source A is on screen');

  // Cut to the other camera.
  send('transition-settings', { type: 'cut', durationMs: 0 });
  await sleep(150);
  await evaluate("takeSource('b'); true");
  await sleep(300);
  shot = await grab(win);
  mid = shot.at(shot.size.width / 2, shot.size.height / 2);
  check(isBlue(mid), `cut to source B did not take: rgb(${mid.r},${mid.g},${mid.b})`);

  // And RESET must still fade an embedded page to fully see-through - the
  // reason this is an <iframe> and not a <webview>.
  send('camera-command', 'reset', null);
  await sleep(500);
  shot = await grab(win);
  mid = shot.at(shot.size.width / 2, shot.size.height / 2);
  check(mid.a === 0, `RESET left alpha ${mid.a} over a VDO.Ninja frame, expected 0`);

  send('camera-command', 'restore', null);
  await sleep(600);
  send('camera-command', 'setSource', 'device');
  await sleep(300);
  [red, blue].forEach(f => { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } });
});

test('cutting between cameras honours the chosen transition', async () => {
  const fs = require('fs');
  const os = require('os');
  const guest = (name, css) => {
    const f = path.join(os.tmpdir(), `ldvd-tr-${name}-${process.pid}.html`);
    fs.writeFileSync(f, '<!DOCTYPE html><meta charset="utf-8">'
      + `<body style="margin:0;background:${css}"></body>`);
    return f;
  };
  const red = guest('red', 'rgb(255,0,0)');
  const blue = guest('blue', 'rgb(0,0,255)');

  send('camera-command', 'setSource', 'vdo');
  await sleep(200);
  await evaluate(`(() => {
    const layer = document.getElementById('vdo-layer');
    layer.innerHTML = '';
    for (const [id, src] of [['a', ${JSON.stringify('file://' + red)}],
                             ['b', ${JSON.stringify('file://' + blue)}]]) {
      const f = document.createElement('iframe');
      f.dataset.sourceId = id; f.src = src;
      layer.appendChild(f);
    }
    document.getElementById('hint').classList.add('hidden');
    return true;
  })()`);
  await sleep(600);

  // A cut is instant: no CSS transition at all.
  send('transition-settings', { type: 'cut', durationMs: 800 });
  await sleep(200);
  await evaluate("takeSource('a'); true");
  await sleep(150);
  const cutCss = await evaluate(
    "getComputedStyle(document.querySelector('[data-source-id=\"a\"]')).transitionDuration");
  check(cutCss === '0s' || cutCss === '', `a cut should not animate, got "${cutCss}"`);

  // A cross-fade overlaps: mid-transition BOTH frames are partly visible.
  send('transition-settings', { type: 'crossfade', durationMs: 900, easing: 'linear' });
  await sleep(200);
  await evaluate("takeSource('b'); true");
  await sleep(400); // roughly mid-fade
  const mid = JSON.parse(await evaluate(`(() => {
    const o = (id) => Number(getComputedStyle(
      document.querySelector('[data-source-id="' + id + '"]')).opacity);
    return JSON.stringify({ a: o('a'), b: o('b') });
  })()`));
  check(mid.a > 0.05 && mid.b > 0.05,
    `a cross-fade should overlap, saw a=${mid.a} b=${mid.b}`);

  await sleep(800);
  const done = JSON.parse(await evaluate(`(() => {
    const o = (id) => Number(getComputedStyle(
      document.querySelector('[data-source-id="' + id + '"]')).opacity);
    return JSON.stringify({ a: o('a'), b: o('b') });
  })()`));
  check(done.b > 0.95 && done.a < 0.05,
    `the cross-fade did not finish cleanly: a=${done.a} b=${done.b}`);

  // A fade dips through nothing: mid-transition NEITHER is fully up, and the
  // incoming one has not started yet.
  send('transition-settings', { type: 'fade', durationMs: 900, easing: 'linear' });
  await sleep(200);
  await evaluate("takeSource('a'); true");
  await sleep(400);
  const dip = JSON.parse(await evaluate(`(() => {
    const o = (id) => Number(getComputedStyle(
      document.querySelector('[data-source-id="' + id + '"]')).opacity);
    return JSON.stringify({ a: o('a'), b: o('b') });
  })()`));
  check(dip.a < 0.2, `a fade should not raise the incoming camera yet, a=${dip.a}`);

  await sleep(1400);
  const settled = Number(await evaluate(
    "getComputedStyle(document.querySelector('[data-source-id=\"a\"]')).opacity"));
  check(settled > 0.95, `the fade never brought the new camera up (${settled})`);

  send('transition-settings', { type: 'fade', durationMs: 80, easing: 'linear' });
  send('camera-command', 'setSource', 'device');
  await sleep(300);
  [red, blue].forEach(f => { try { fs.unlinkSync(f); } catch (_) { /* best effort */ } });
});

test('a source with a bad URL is refused, not mounted', async () => {
  send('camera-command', 'setSource', 'vdo');
  send('camera-command', 'setVdo', {
    sources: [{ id: 'evil', label: 'evil', url: 'https://evil.example.com/?view=x' }],
    activeId: 'evil',
  });
  await sleep(400);
  const frames = await evaluate("document.getElementById('vdo-layer').children.length");
  check(frames === 0, `${frames} frame(s) mounted for a disallowed host`);
  send('camera-command', 'setSource', 'device');
  await sleep(200);
});

test('the test pattern proves the screen path with no camera and no stream', async () => {
  send('camera-command', 'setSource', 'pattern');
  await sleep(700);

  const mode = await evaluate("document.body.classList.contains('pattern-mode')");
  check(mode === true, 'pattern-mode was not applied');

  const shot = await grab(win);

  // Colour: a rainbow means several distinct hues across the width, which a
  // blank or single-colour screen would not produce.
  const hues = new Set();
  for (let i = 1; i < 20; i += 1) {
    const p = shot.at((i / 20) * shot.size.width, shot.size.height * 0.75);
    const max = Math.max(p.r, p.g, p.b);
    const min = Math.min(p.r, p.g, p.b);
    if (max - min > 40) hues.add(`${p.r > p.g}${p.g > p.b}${p.b > p.r}`);
  }
  check(hues.size >= 2, `expected a rainbow, found ${hues.size} distinct hue relation(s)`);

  // Corner ticks: their whole job is to reveal cropping, so they must be there.
  const corner = (fx, fy) => shot.brightPixels(fx, fy, 0.03, 0.05, 190);
  for (const [fx, fy, name] of [
    [0, 0, 'top-left'], [0.97, 0, 'top-right'],
    [0, 0.95, 'bottom-left'], [0.97, 0.95, 'bottom-right'],
  ]) {
    check(corner(fx, fy) > 3, `no corner tick at ${name}`);
  }

  // Motion: the pattern must actually animate, or a frozen screen would pass
  // every check above.
  const frameA = await evaluate('patternFrame');
  await sleep(400);
  const frameB = await evaluate('patternFrame');
  check(frameB > frameA, `the pattern is frozen (frame stuck at ${frameA})`);

  // And it must composite with everything else the screen draws.
  send('caption-settings', { position: 'bottom-center', fontSize: 9, outline: 'shadow' });
  send('caption-text', { text: 'PATTERN CHECK', source: 'manual' });
  await sleep(400);
  const withCaption = await grab(win);
  check(withCaption.brightPixels(0, 0.66, 1, 0.34) > 150,
    'captions do not draw over the test pattern');
});

test('leaving the test pattern stops its draw loop', async () => {
  send('camera-command', 'setSource', 'device');
  await sleep(400);
  const running = await evaluate('patternRaf !== null');
  check(running === false, 'the pattern kept animating after switching away');
});

test('the compatibility (canvas) renderer paints frames too', async () => {
  send('camera-command', 'setRenderMode', 'canvas');
  send('camera-command', 'live', true);
  await sleep(1400);

  const mode = await evaluate("document.body.classList.contains('canvas-mode')");
  check(mode === true, 'canvas-mode class was not applied');

  const painted = await evaluate(`(() => {
    const c = document.getElementById('cam-canvas');
    return JSON.stringify({ w: c.width, h: c.height });
  })()`);
  const p = JSON.parse(painted);
  check(p.w > 0 && p.h > 0, `canvas was never sized (${p.w}x${p.h})`);

  const shot = await grab(win);
  const lit = shot.brightness(0.2, 0.2, 0.6, 0.6);
  check(lit > 12, `canvas renderer produced a blank screen (luminance ${lit.toFixed(1)})`);

  send('camera-command', 'setRenderMode', 'video');
  await sleep(200);
});

// ══════════════════════════════════════════════════════════════════════

app.whenReady().then(async () => {
  // Stand in for the parts of IPCHandler the screen talks to.
  ipcMain.handle('get-config', () => testConfig);
  ipcMain.on('renderer-log', (_e, level, msg) => rendererLog.push({ level, msg }));
  ipcMain.on('camera-status', () => {});
  ipcMain.on('camera-devices', () => {});

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

  const errs = rendererLog.filter(l => l.level === 'error');
  if (errs.length) {
    console.log('\n  renderer errors reported during the run:');
    errs.forEach(e => console.log(`    ${e.msg}`));
  }

  console.log(`\n  ${results.length - failed}/${results.length} passed`);
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(failed ? 1 : 0);
});
