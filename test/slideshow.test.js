const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextIndex } = require('../src/utils/slideshow');

test('advances forward within bounds', () => {
  assert.equal(nextIndex(0, 3, 1, true), 1);
  assert.equal(nextIndex(1, 3, 1, false), 2);
});

test('advances backward within bounds', () => {
  assert.equal(nextIndex(2, 3, -1, true), 1);
  assert.equal(nextIndex(1, 3, -1, false), 0);
});

test('wraps to start when looping past the end', () => {
  assert.equal(nextIndex(2, 3, 1, true), 0);
});

test('wraps to end when looping before the start', () => {
  assert.equal(nextIndex(0, 3, -1, true), 2);
});

test('returns -1 (stop) at the end when not looping', () => {
  assert.equal(nextIndex(2, 3, 1, false), -1);
});

test('clamps at the start when not looping', () => {
  assert.equal(nextIndex(0, 3, -1, false), 0);
});

test('empty list returns 0', () => {
  assert.equal(nextIndex(0, 0, 1, true), 0);
});
