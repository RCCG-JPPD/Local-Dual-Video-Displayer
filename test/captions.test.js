const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  POSITIONS, ANIMATIONS, OUTLINES, DEFAULT_CAPTIONS,
  normalizeCaptions, splitPosition, anchorStyles, captionStyles,
  captionAnimation, shouldReplace, similarity,
} = require('../src/utils/captions');

test('normalizeCaptions falls back to the default for junk input', () => {
  assert.deepEqual(normalizeCaptions(null), DEFAULT_CAPTIONS);
  assert.deepEqual(normalizeCaptions(undefined), DEFAULT_CAPTIONS);
  assert.deepEqual(normalizeCaptions('bottom'), DEFAULT_CAPTIONS);
  assert.deepEqual(normalizeCaptions(42), DEFAULT_CAPTIONS);
  assert.deepEqual(normalizeCaptions({}), DEFAULT_CAPTIONS);
});

test('normalizeCaptions whitelists every enum', () => {
  assert.equal(normalizeCaptions({ position: 'nowhere' }).position, DEFAULT_CAPTIONS.position);
  assert.equal(normalizeCaptions({ animation: 'explode' }).animation, DEFAULT_CAPTIONS.animation);
  assert.equal(normalizeCaptions({ outline: 'glow' }).outline, DEFAULT_CAPTIONS.outline);
  assert.equal(normalizeCaptions({ align: 'justify' }).align, DEFAULT_CAPTIONS.align);
});

test('every position and animation round-trips unchanged', () => {
  for (const position of POSITIONS) {
    assert.equal(normalizeCaptions({ position }).position, position);
  }
  for (const animation of ANIMATIONS) {
    assert.equal(normalizeCaptions({ animation }).animation, animation);
  }
});

test('normalizeCaptions clamps every numeric field', () => {
  assert.equal(normalizeCaptions({ fontSize: 999 }).fontSize, 20);
  assert.equal(normalizeCaptions({ fontSize: 0 }).fontSize, 1);
  assert.equal(normalizeCaptions({ offsetX: -900 }).offsetX, -50);
  assert.equal(normalizeCaptions({ offsetY: 900 }).offsetY, 50);
  assert.equal(normalizeCaptions({ width: 0 }).width, 10);
  assert.equal(normalizeCaptions({ margin: 99 }).margin, 25);
  assert.equal(normalizeCaptions({ animationMs: -1 }).animationMs, 0);
  assert.equal(normalizeCaptions({ animationMs: 99999 }).animationMs, 3000);
  // Strings that are really numbers are accepted (sliders emit strings).
  assert.equal(normalizeCaptions({ fontSize: '7.5' }).fontSize, 7.5);
  assert.equal(normalizeCaptions({ fontSize: NaN }).fontSize, DEFAULT_CAPTIONS.fontSize);
});

test('colour and font inputs that could inject CSS are rejected', () => {
  assert.equal(normalizeCaptions({ color: '#ff0000' }).color, '#ff0000');
  assert.equal(normalizeCaptions({ color: 'white' }).color, 'white');
  assert.equal(normalizeCaptions({ color: 'red; position:fixed' }).color, DEFAULT_CAPTIONS.color);
  assert.equal(normalizeCaptions({ color: 'url(evil)' }).color, DEFAULT_CAPTIONS.color);
  assert.equal(normalizeCaptions({ fontFamily: 'Georgia, serif' }).fontFamily, 'Georgia, serif');
  assert.equal(normalizeCaptions({ fontFamily: 'a}{x' }).fontFamily, DEFAULT_CAPTIONS.fontFamily);
});

test('splitPosition breaks the grid key into its two axes', () => {
  assert.deepEqual(splitPosition('top-left'), { v: 'top', h: 'left' });
  assert.deepEqual(splitPosition('middle-center'), { v: 'middle', h: 'center' });
  assert.deepEqual(splitPosition('bottom-right'), { v: 'bottom', h: 'right' });
  assert.deepEqual(splitPosition('nonsense'), { v: 'bottom', h: 'center' });
});

test('anchorStyles pins each corner to its own edge', () => {
  const tl = anchorStyles({ position: 'top-left', margin: 4 });
  assert.equal(tl.transform, 'translate(0%, 0%)');
  assert.match(tl.left, /^calc\(0% \+ 4vw\)$/);
  assert.match(tl.top, /^calc\(0% \+ 4vh\)$/);

  const br = anchorStyles({ position: 'bottom-right', margin: 4 });
  assert.equal(br.transform, 'translate(-100%, -100%)');
  assert.match(br.left, /^calc\(100% - 4vw\)$/);
  assert.match(br.top, /^calc\(100% - 4vh\)$/);
});

test('anchorStyles centres without a margin on the centred axis', () => {
  const mc = anchorStyles({ position: 'middle-center', margin: 10 });
  assert.equal(mc.transform, 'translate(-50%, -50%)');
  // A margin is meaningless for a centred axis and must not shift it.
  assert.equal(mc.left, 'calc(50% + 0vw)');
  assert.equal(mc.top, 'calc(50% + 0vh)');
});

test('anchorStyles never emits a signed calc operand', () => {
  for (const position of POSITIONS) {
    for (const offsetY of [-20, 0, 20]) {
      const a = anchorStyles({ position, margin: 5, offsetX: -7, offsetY });
      assert.ok(!a.left.includes('+ -'), `${position}: ${a.left}`);
      assert.ok(!a.top.includes('+ -'), `${position}: ${a.top}`);
    }
  }
});

test('captionStyles is a positioned box for every position', () => {
  for (const position of POSITIONS) {
    const s = captionStyles({ position });
    assert.equal(s.position, 'absolute');
    assert.ok(s.left && s.top && s.transform, position);
    assert.equal(s.width, '80%');
  }
});

test('captionStyles renders into a pixel box for the controller preview', () => {
  const s = captionStyles({ fontSize: 10 }, { width: 400, height: 200 });
  assert.equal(s.fontSize, '20px'); // 10% of 200px
  assert.ok(s.left.endsWith('px)'), s.left);
  // Viewport units are the default when no box is given.
  assert.equal(captionStyles({ fontSize: 10 }).fontSize, '10vh');
});

test('captionStyles emits only the decorations for the chosen outline', () => {
  const none = captionStyles({ outline: 'none' });
  assert.equal(none.textShadow, 'none');
  assert.equal(none.background, 'transparent');

  const shadow = captionStyles({ outline: 'shadow' });
  assert.notEqual(shadow.textShadow, 'none');
  assert.equal(shadow.background, 'transparent');

  const outline = captionStyles({ outline: 'outline' });
  assert.match(outline.WebkitTextStroke, /#000000$/);
  assert.equal(outline.textShadow, 'none');

  const box = captionStyles({ outline: 'box', boxColor: '#123456' });
  assert.equal(box.background, '#123456');
  assert.notEqual(box.padding, '0');
});

test('every outline mode resets the decorations it does not use', () => {
  // Switching modes live must never leave a stale shadow or padding behind.
  for (const outline of OUTLINES) {
    const s = captionStyles({ outline });
    for (const key of ['textShadow', 'WebkitTextStroke', 'background', 'padding', 'borderRadius']) {
      assert.ok(key in s, `${outline} is missing ${key}`);
    }
  }
});

test('captionStyles emits no float noise in derived sizes', () => {
  for (const outline of OUTLINES) {
    const s = captionStyles({ outline, fontSize: 5 });
    const joined = Object.values(s).join(' ');
    assert.ok(!/\d\.\d{6,}/.test(joined), `${outline}: ${joined}`);
  }
});

test('captionAnimation gives a usable enter/exit pair for every animation', () => {
  for (const animation of ANIMATIONS) {
    const a = captionAnimation({ animation, animationMs: 400 });
    assert.equal(a.hidden.opacity, 0, animation);
    assert.equal(a.shown.opacity, 1, animation);
    assert.equal(a.leaving.opacity, 0, animation);
    assert.ok(a.shown.transform, animation);
  }
});

test('captionAnimation collapses to an instant swap for "none"', () => {
  const a = captionAnimation({ animation: 'none', animationMs: 900 });
  assert.equal(a.durationMs, 0);
  assert.equal(a.shown.transition, 'none');
  assert.equal(a.typewriter, false);
});

test('captionAnimation flags typewriter for the renderer to drive', () => {
  assert.equal(captionAnimation({ animation: 'typewriter' }).typewriter, true);
  assert.equal(captionAnimation({ animation: 'fade' }).typewriter, false);
});

test('slide-up and slide-down enter from opposite directions', () => {
  const up = captionAnimation({ animation: 'slide-up' });
  const down = captionAnimation({ animation: 'slide-down' });
  assert.notEqual(up.hidden.transform, down.hidden.transform);
  assert.match(up.hidden.transform, /translate\(0px, 24px\)/);
  assert.match(down.hidden.transform, /translate\(0px, -24px\)/);
});

test('shouldReplace ignores an unchanged line', () => {
  assert.equal(shouldReplace('Amazing grace how sweet', 'Amazing grace how sweet'), false);
  // Whitespace and case are not a change.
  assert.equal(shouldReplace('Amazing grace', '  amazing   GRACE '), false);
});

test('shouldReplace ignores a one-character OCR wobble', () => {
  // This is the whole point: without it the caption re-animates every tick.
  assert.equal(shouldReplace('HOLY IS THE LORD', 'HOLY 1S THE LORD'), false);
  assert.equal(shouldReplace('Amazing grace how sweet', 'Amazing grace how sweel'), false);
});

test('shouldReplace accepts a genuinely different line', () => {
  assert.equal(shouldReplace('Amazing grace how sweet', 'That saved a wretch like me'), true);
});

test('shouldReplace always accepts appearing and clearing', () => {
  assert.equal(shouldReplace('', 'Amazing grace'), true);
  assert.equal(shouldReplace('Amazing grace', ''), true);
  assert.equal(shouldReplace(null, 'Amazing grace'), true);
  assert.equal(shouldReplace('', ''), false);
});

test('shouldReplace does not treat short lines as noise', () => {
  // "Amen" vs "Amend" is 80% similar but is a real change; the ratio test is
  // only trustworthy once there is enough text to judge.
  assert.equal(shouldReplace('Amen', 'Amend'), true);
  assert.equal(shouldReplace('Yes', 'No'), true);
});

test('shouldReplace honours a caller-supplied threshold', () => {
  // A threshold of 1 means only an exact match counts as unchanged.
  assert.equal(shouldReplace('HOLY IS THE LORD', 'HOLY 1S THE LORD', { threshold: 1 }), true);
  assert.equal(shouldReplace('HOLY IS THE LORD', 'HOLY 1S THE LORD', { threshold: 0 }), false);
});

test('shouldReplace never throws on junk', () => {
  assert.equal(shouldReplace(undefined, undefined), false);
  assert.equal(typeof shouldReplace(42, { a: 1 }), 'boolean');
});

test('similarity is 1 for identical and 0 for wholly different strings', () => {
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('abc', 'abc'), 1);
  assert.equal(similarity('abc', 'xyz'), 0);
  assert.ok(similarity('abcd', 'abcx') > 0.7);
});
