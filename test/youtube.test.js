const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId } = require('../src/utils/youtube');

test('extracts ID from a standard watch URL', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('extracts ID from a watch URL with extra params', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=abc'), 'dQw4w9WgXcQ');
});

test('extracts ID from a youtu.be short link', () => {
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ?si=xyz'), 'dQw4w9WgXcQ');
});

test('extracts ID from an /embed/ URL', () => {
  assert.equal(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1'), 'dQw4w9WgXcQ');
});

test('extracts ID from a /shorts/ URL', () => {
  assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('passes through a bare 11-char ID', () => {
  assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('trims surrounding whitespace', () => {
  assert.equal(extractVideoId('  dQw4w9WgXcQ  '), 'dQw4w9WgXcQ');
});

test('returns empty string for junk / empty input', () => {
  assert.equal(extractVideoId(''), '');
  assert.equal(extractVideoId(null), '');
  assert.equal(extractVideoId('not a youtube url'), '');
});
