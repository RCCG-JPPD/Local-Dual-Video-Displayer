const { test } = require('node:test');
const assert = require('node:assert/strict');

const defaults = require('../src/utils/config');
const { normalizeCaptions } = require('../src/utils/captions');
const { normalizeOcr } = require('../src/utils/ocr');
const { normalizeLogo } = require('../src/utils/logo');
const { normalizeTransition } = require('../src/utils/transition');
const { normalizeZoom } = require('../src/utils/zoom');
const { normalizeVdo } = require('../src/utils/vdoninja');

// ── the schema must agree with the code that validates it ─────────────
//
// config.js builds its defaults from the normalizers' DEFAULT_* objects, so
// these guard against that wiring being replaced by hand-copied literals that
// then drift.

test('every default section survives its own normalizer unchanged', () => {
  assert.deepEqual(normalizeCaptions(defaults.captions), defaults.captions);
  assert.deepEqual(normalizeOcr(defaults.ocr), defaults.ocr);
  assert.deepEqual(normalizeLogo(defaults.logo), defaults.logo);
  assert.deepEqual(normalizeTransition(defaults.transition), defaults.transition);
  // Round-trips whole, like every section above it. Spelling out a subset here
  // is what let normalizeVdo quietly drop preloadAll: the default said the
  // setting existed, the normalizer threw it away, and this test agreed.
  assert.deepEqual(normalizeVdo(defaults.camera.vdo), defaults.camera.vdo);
});

test('every screen listed in zoom normalizes cleanly', () => {
  for (const [role, z] of Object.entries(defaults.zoom)) {
    assert.deepEqual(normalizeZoom(z), z, `zoom.${role}`);
  }
});

test('the camera screen defaults to Fill', () => {
  // A crowd shot should cover the screen, not sit letterboxed in the middle.
  assert.equal(defaults.zoom.camera.mode, 'cover');
});

test('the camera does not start live or hidden', () => {
  // Opening the app must never put a camera on a screen by itself, and the
  // stage must not start in the RESET state or the screen looks broken.
  assert.equal(defaults.camera.live, false);
  assert.equal(defaults.camera.visible, true);
  assert.equal(defaults.camera.source, 'device');
});

test('OCR does not start reading by itself', () => {
  assert.equal(defaults.ocr.enabled, false);
});

test('the logo starts hidden and sourceless', () => {
  assert.equal(defaults.logo.enabled, false);
  assert.equal(defaults.logo.source, '');
});

test('the default OCR region is a plausible lower third', () => {
  const r = defaults.ocr.region;
  assert.ok(r.y > 0.5, 'lyrics are usually in the lower half');
  assert.ok(r.x + r.w <= 1 && r.y + r.h <= 1, 'the region must fit on the screen');
  assert.ok(r.w > 0.2 && r.h > 0.05, 'the region must be big enough to hold text');
});

test('the schema is JSON-serializable', () => {
  // It is written to disk verbatim; a function or undefined would be silently
  // dropped and the setting would vanish on the next load.
  const round = JSON.parse(JSON.stringify(defaults));
  assert.deepEqual(round.camera, defaults.camera);
  assert.deepEqual(round.captions, defaults.captions);
  assert.deepEqual(round.ocr, defaults.ocr);
});

test('the new sections do not share objects with the normalizer defaults', () => {
  // config.js spreads them; if it exported the same object instead, mutating a
  // loaded config would corrupt the defaults for the rest of the process.
  const { DEFAULT_CAPTIONS } = require('../src/utils/captions');
  assert.notEqual(defaults.captions, DEFAULT_CAPTIONS);
  const { DEFAULT_OCR } = require('../src/utils/ocr');
  assert.notEqual(defaults.ocr, DEFAULT_OCR);
});

// ── the upgrade path ──────────────────────────────────────────────────
//
// ConfigManager.loadConfig() returns the saved file VERBATIM — it does not
// merge defaults. So an install that predates a feature has none of its keys,
// and every read has to go through a normalizer. These encode that.

/** A config as written by the app before any of this existed. */
const LEGACY_CONFIG = {
  displays: [{ id: 1, displayIndex: 0, role: 'video', label: 'Display 1' }],
  playback: { currentPlaylistIndex: 0, playlist: [], volume: 1 },
  clock: { mode: 'time' },
  version: '2.0.0',
};

test('a config from before this feature yields usable settings everywhere', () => {
  const cfg = LEGACY_CONFIG;
  assert.deepEqual(normalizeCaptions(cfg.captions), defaults.captions);
  assert.deepEqual(normalizeOcr(cfg.ocr), defaults.ocr);
  assert.deepEqual(normalizeLogo(cfg.logo), defaults.logo);
  assert.deepEqual(normalizeTransition(cfg.transition), defaults.transition);
  // No vdo block at all, so an upgrading user lands on the shipped default -
  // no sources, nothing on air, and preloading on.
  assert.deepEqual(normalizeVdo(cfg.camera && cfg.camera.vdo), defaults.camera.vdo);
  // The zoom block exists in a legacy config but has no camera entry.
  assert.deepEqual(normalizeZoom((cfg.zoom || {}).camera), { mode: 'contain', scale: 1 });
});

test('a half-written or corrupted section still normalizes', () => {
  // A config edited by hand, or truncated by a crash mid-write.
  const broken = {
    captions: { position: 'somewhere', fontSize: 'big', animation: null },
    ocr: { region: { x: 'a', y: null }, intervalMs: -5, displayId: 'none' },
    logo: { size: {}, opacity: 'half' },
    transition: { type: 42, durationMs: [] },
  };
  assert.doesNotThrow(() => {
    normalizeCaptions(broken.captions);
    normalizeOcr(broken.ocr);
    normalizeLogo(broken.logo);
    normalizeTransition(broken.transition);
  });
  assert.equal(normalizeCaptions(broken.captions).position, defaults.captions.position);
  assert.equal(normalizeOcr(broken.ocr).intervalMs, 200);
  assert.equal(normalizeOcr(broken.ocr).displayId, null);
  assert.equal(normalizeLogo(broken.logo).opacity, defaults.logo.opacity);
  assert.equal(normalizeTransition(broken.transition).type, defaults.transition.type);
});

test('a config that is not an object at all does not take anything down', () => {
  for (const junk of [null, undefined, 'a string', 42, []]) {
    const cfg = junk || {};
    assert.doesNotThrow(() => {
      normalizeCaptions(cfg.captions);
      normalizeOcr(cfg.ocr);
      normalizeLogo(cfg.logo);
      normalizeTransition(cfg.transition);
      normalizeVdo(cfg.camera && cfg.camera.vdo);
    }, String(junk));
  }
});

// ── documentation that has to stay true ───────────────────────────────

test('the displays comment lists every role the app can actually create', () => {
  // The selector and the role dispatch both read from this vocabulary; a role
  // missing from the comment is a role someone will forget to thread through.
  const src = require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '..', 'src', 'utils', 'config.js'), 'utf8');
  for (const role of ['video', 'youtube', 'web', 'clock', 'powerpoint',
    'slideshow', 'excel', 'camera']) {
    assert.ok(src.includes(`'${role}'`), `role '${role}' is not documented in config.js`);
  }
});
