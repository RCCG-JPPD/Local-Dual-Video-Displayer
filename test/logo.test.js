const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_LOGO, LOGO_POSITIONS, normalizeLogo, logoStyles } = require('../src/utils/logo');
const { anchorStyles } = require('../src/utils/captions');

test('normalizeLogo falls back to the default for junk input', () => {
  assert.deepEqual(normalizeLogo(null), DEFAULT_LOGO);
  assert.deepEqual(normalizeLogo('logo.png'), DEFAULT_LOGO);
  assert.deepEqual(normalizeLogo(7), DEFAULT_LOGO);
  assert.deepEqual(normalizeLogo({}), DEFAULT_LOGO);
});

test('normalizeLogo keeps a real source path and rejects a non-string', () => {
  assert.equal(normalizeLogo({ source: '/tmp/logo.png' }).source, '/tmp/logo.png');
  assert.equal(normalizeLogo({ source: 42 }).source, '');
  assert.equal(normalizeLogo({ source: null }).source, '');
});

test('normalizeLogo whitelists the position and clamps the numbers', () => {
  assert.equal(normalizeLogo({ position: 'nowhere' }).position, DEFAULT_LOGO.position);
  assert.equal(normalizeLogo({ size: 0 }).size, 1);
  assert.equal(normalizeLogo({ size: 999 }).size, 100);
  assert.equal(normalizeLogo({ opacity: -1 }).opacity, 0);
  assert.equal(normalizeLogo({ opacity: 5 }).opacity, 1);
  assert.equal(normalizeLogo({ opacity: '0.5' }).opacity, 0.5);
  assert.equal(normalizeLogo({ margin: 99 }).margin, 25);
  assert.equal(normalizeLogo({ offsetX: -900 }).offsetX, -50);
  assert.equal(normalizeLogo({ size: null }).size, DEFAULT_LOGO.size);
});

test('every position round-trips unchanged', () => {
  for (const position of LOGO_POSITIONS) {
    assert.equal(normalizeLogo({ position }).position, position);
  }
});

test('logoStyles keeps the aspect ratio by driving width only', () => {
  const s = logoStyles({ enabled: true, source: '/a.png', size: 12 });
  assert.equal(s.width, '12vw');
  assert.equal(s.height, 'auto');
});

test('logoStyles hides the logo when disabled or sourceless', () => {
  assert.equal(logoStyles({ enabled: false, source: '/a.png' }).display, 'none');
  assert.equal(logoStyles({ enabled: true, source: '' }).display, 'none');
  assert.equal(logoStyles({ enabled: true, source: '/a.png' }).display, 'block');
});

test('logoStyles never intercepts a click', () => {
  // The camera window is click-through; a logo that ate clicks would break that.
  assert.equal(logoStyles({ enabled: true, source: '/a.png' }).pointerEvents, 'none');
});

test('logoStyles shares its corner maths with captions', () => {
  // A logo and a caption sent to the same corner must land in the same place.
  for (const position of LOGO_POSITIONS) {
    const logo = { enabled: true, source: '/a.png', position, margin: 4, offsetX: 2, offsetY: -3 };
    const s = logoStyles(logo);
    const expected = anchorStyles({ position, margin: 4, offsetX: 2, offsetY: -3 });
    assert.equal(s.left, expected.left, position);
    assert.equal(s.top, expected.top, position);
    assert.equal(s.transform, expected.transform, position);
  }
});

test('logoStyles renders into a pixel box for a scaled preview', () => {
  const s = logoStyles({ enabled: true, source: '/a.png', size: 25 }, { width: 400, height: 225 });
  assert.equal(s.width, '100px'); // 25% of 400px
  assert.ok(s.left.endsWith('px)'), s.left);
});

test('logoStyles emits no float noise', () => {
  const s = logoStyles({ enabled: true, source: '/a.png', size: 12.345, margin: 3.7 });
  const joined = Object.values(s).join(' ');
  assert.ok(!/\d\.\d{6,}/.test(joined), joined);
});
