const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeZoom, zoomStyles, ZOOM_PRESETS, DEFAULT_ZOOM, MIN_SCALE, MAX_SCALE,
} = require('../src/utils/zoom');

test('normalizeZoom passes valid zooms through', () => {
  assert.deepEqual(normalizeZoom({ mode: 'contain', scale: 1 }), { mode: 'contain', scale: 1 });
  assert.deepEqual(normalizeZoom({ mode: 'cover', scale: 1.5 }), { mode: 'cover', scale: 1.5 });
  assert.deepEqual(normalizeZoom({ mode: 'native', scale: 0.5 }), { mode: 'native', scale: 0.5 });
});

test('normalizeZoom falls back to the default for junk input', () => {
  assert.deepEqual(normalizeZoom(null), DEFAULT_ZOOM);
  assert.deepEqual(normalizeZoom(undefined), DEFAULT_ZOOM);
  assert.deepEqual(normalizeZoom('contain'), DEFAULT_ZOOM);
  assert.deepEqual(normalizeZoom(42), DEFAULT_ZOOM);
  assert.deepEqual(normalizeZoom({}), DEFAULT_ZOOM);
});

test('normalizeZoom whitelists mode and coerces scale', () => {
  assert.equal(normalizeZoom({ mode: 'fill', scale: 1 }).mode, 'contain'); // not a real mode
  assert.equal(normalizeZoom({ mode: 'cover', scale: 'x' }).scale, 1);
  assert.equal(normalizeZoom({ mode: 'cover', scale: NaN }).scale, 1);
  assert.equal(normalizeZoom({ mode: 'cover', scale: '1.25' }).scale, 1.25);
});

test('normalizeZoom clamps scale to the allowed range', () => {
  assert.equal(normalizeZoom({ mode: 'contain', scale: 99 }).scale, MAX_SCALE);
  assert.equal(normalizeZoom({ mode: 'contain', scale: -5 }).scale, MIN_SCALE);
  assert.equal(normalizeZoom({ mode: 'contain', scale: 0 }).scale, MIN_SCALE);
});

test('every preset survives normalization unchanged', () => {
  for (const [name, preset] of Object.entries(ZOOM_PRESETS)) {
    assert.deepEqual(normalizeZoom(preset), preset, `preset ${name}`);
  }
});

test('zoomStyles fills the box for contain/cover so small media scales UP', () => {
  // The original bug: width/height:auto + max-* only ever scaled DOWN, leaving a
  // 640x480 clip at 640x480 on a 1080p screen.
  const fit = zoomStyles(ZOOM_PRESETS.fit);
  assert.equal(fit.width, '100%');
  assert.equal(fit.height, '100%');
  assert.equal(fit.maxWidth, 'none');
  assert.equal(fit.maxHeight, 'none');
  assert.equal(fit.objectFit, 'contain');

  assert.equal(zoomStyles(ZOOM_PRESETS.fill).objectFit, 'cover');
});

test('zoomStyles keeps native at intrinsic size', () => {
  const native = zoomStyles(ZOOM_PRESETS.native);
  assert.equal(native.width, 'auto');
  assert.equal(native.height, 'auto');
  assert.equal(native.maxWidth, '100%');
  assert.equal(native.maxHeight, '100%');
  assert.equal(native.objectFit, 'contain');
});

test('zoomStyles emits a centred transform for the scale', () => {
  assert.equal(zoomStyles({ mode: 'contain', scale: 1 }).transform, 'scale(1)');
  assert.equal(zoomStyles({ mode: 'cover', scale: 1.25 }).transform, 'scale(1.25)');
  assert.equal(zoomStyles({ mode: 'contain', scale: 99 }).transform, `scale(${MAX_SCALE})`);
  assert.equal(zoomStyles(null).transformOrigin, 'center center');
});

test('zoomStyles never throws on junk input', () => {
  for (const junk of [null, undefined, 0, 'x', [], { mode: 1, scale: {} }]) {
    assert.equal(typeof zoomStyles(junk), 'object');
  }
});
