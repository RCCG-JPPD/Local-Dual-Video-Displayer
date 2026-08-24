const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TRANSITION_TYPES, EASINGS, MIN_MS, MAX_MS, DEFAULT_TRANSITION,
  normalizeTransition, transitionMs, transitionStyles, fadeStyles,
} = require('../src/utils/transition');

test('normalizeTransition falls back to the default for junk input', () => {
  assert.deepEqual(normalizeTransition(null), DEFAULT_TRANSITION);
  assert.deepEqual(normalizeTransition(undefined), DEFAULT_TRANSITION);
  assert.deepEqual(normalizeTransition('fade'), DEFAULT_TRANSITION);
  assert.deepEqual(normalizeTransition(600), DEFAULT_TRANSITION);
  assert.deepEqual(normalizeTransition({}), DEFAULT_TRANSITION);
});

test('every type and easing round-trips unchanged', () => {
  for (const type of TRANSITION_TYPES) {
    assert.equal(normalizeTransition({ type }).type, type);
  }
  for (const easing of EASINGS) {
    assert.equal(normalizeTransition({ easing }).easing, easing);
  }
});

test('normalizeTransition whitelists type and easing', () => {
  assert.equal(normalizeTransition({ type: 'wipe' }).type, DEFAULT_TRANSITION.type);
  assert.equal(normalizeTransition({ easing: 'bounce' }).easing, DEFAULT_TRANSITION.easing);
  assert.equal(normalizeTransition({ easing: 'cubic-bezier(0,0,1,1)' }).easing,
    DEFAULT_TRANSITION.easing);
});

test('normalizeTransition clamps and rounds the duration', () => {
  assert.equal(normalizeTransition({ durationMs: -100 }).durationMs, MIN_MS);
  assert.equal(normalizeTransition({ durationMs: 1e9 }).durationMs, MAX_MS);
  assert.equal(normalizeTransition({ durationMs: '450' }).durationMs, 450);
  assert.equal(normalizeTransition({ durationMs: 450.7 }).durationMs, 451);
  assert.equal(normalizeTransition({ durationMs: NaN }).durationMs, DEFAULT_TRANSITION.durationMs);
  assert.equal(normalizeTransition({ durationMs: null }).durationMs, DEFAULT_TRANSITION.durationMs);
});

test('cut is always instant, whatever the slider says', () => {
  // CSS and the post-fade cleanup timer both read this, so they can never
  // disagree about how long the fade actually takes.
  assert.equal(transitionMs({ type: 'cut', durationMs: 5000 }), 0);
  assert.equal(transitionStyles({ type: 'cut', durationMs: 5000 }).transition, 'none');
});

test('transitionMs reports the clamped duration for animated types', () => {
  assert.equal(transitionMs({ type: 'fade', durationMs: 800 }), 800);
  assert.equal(transitionMs({ type: 'crossfade', durationMs: 99999 }), MAX_MS);
  assert.equal(transitionMs(null), DEFAULT_TRANSITION.durationMs);
});

test('a zero duration behaves like a cut', () => {
  assert.equal(transitionStyles({ type: 'fade', durationMs: 0 }).transition, 'none');
});

test('transitionStyles defaults to animating opacity', () => {
  assert.equal(
    transitionStyles({ type: 'fade', durationMs: 600, easing: 'ease-in-out' }).transition,
    'opacity 600ms ease-in-out',
  );
});

test('transitionStyles emits one entry per property', () => {
  const s = transitionStyles({ type: 'fade', durationMs: 300, easing: 'linear' },
    ['opacity', 'transform']);
  assert.equal(s.transition, 'opacity 300ms linear, transform 300ms linear');
  // An empty list is treated as "no properties given", not as "animate nothing".
  assert.equal(transitionStyles({ durationMs: 300 }, []).transition,
    'opacity 300ms ease-in-out');
  assert.equal(transitionStyles({ durationMs: 300 }, 'opacity').transition,
    'opacity 300ms ease-in-out');
});

test('fadeStyles drives opacity to 1 when visible and 0 when reset', () => {
  const shown = fadeStyles({ type: 'fade', durationMs: 600 }, true);
  const hidden = fadeStyles({ type: 'fade', durationMs: 600 }, false);
  assert.equal(shown.opacity, '1');
  assert.equal(hidden.opacity, '0');
  // Both directions carry the same transition, so the fade back in matches.
  assert.equal(shown.transition, hidden.transition);
});

test('fadeStyles never throws on junk', () => {
  assert.equal(fadeStyles(null, true).opacity, '1');
  assert.equal(fadeStyles('x', 0).opacity, '0');
});
