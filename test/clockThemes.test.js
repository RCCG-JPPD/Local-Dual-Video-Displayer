const { test } = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, resolveTheme } = require('../src/utils/clockThemes');

test('THEMES includes the expected packs', () => {
  const keys = THEMES.map(t => t.key);
  for (const k of ['auto', 'dark', 'light', 'glass-white', 'glass-black', 'midnight', 'ocean', 'sunset', 'forest', 'contrast', 'terminal', 'amber', 'rccg']) {
    assert.ok(keys.includes(k), `missing theme ${k}`);
  }
});

test('transparent themes resolve to a transparent background', () => {
  assert.deepEqual(resolveTheme('glass-white'), { bg: 'transparent', text: '#ffffff' });
  assert.deepEqual(resolveTheme('glass-black'), { bg: 'transparent', text: '#111111' });
});

test('resolveTheme returns a named theme', () => {
  assert.deepEqual(resolveTheme('light'), { bg: '#ffffff', text: '#111111' });
  assert.deepEqual(resolveTheme('rccg'), { bg: '#3b1f5e', text: '#ffd700' });
});

test('resolveTheme auto tints to the active holiday', () => {
  assert.deepEqual(resolveTheme('auto', 'christmas'), { bg: '#1b4332', text: '#ffccd5' });
  assert.deepEqual(resolveTheme('auto', 'newyear'), { bg: '#0d0d0d', text: '#ffd700' });
});

test('resolveTheme auto with no holiday falls back to dark', () => {
  assert.deepEqual(resolveTheme('auto', null), { bg: '#0d1117', text: '#ffffff' });
});

test('resolveTheme unknown key falls back to dark', () => {
  assert.deepEqual(resolveTheme('nope'), { bg: '#0d1117', text: '#ffffff' });
});
