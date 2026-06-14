const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatClock, formatDuration, secondsUntil } = require('../src/utils/clockformat');

test('formatClock 24h with seconds', () => {
  assert.equal(formatClock(new Date(2025, 0, 1, 14, 5, 9), { showSeconds: true, hour12: false }), '14:05:09');
});

test('formatClock 24h without seconds', () => {
  assert.equal(formatClock(new Date(2025, 0, 1, 9, 7, 3), { showSeconds: false, hour12: false }), '09:07');
});

test('formatClock 12h (2-digit hour, matches toLocaleTimeString en-US)', () => {
  assert.equal(formatClock(new Date(2025, 0, 1, 14, 5, 0), { showSeconds: false, hour12: true }), '02:05 PM');
  assert.equal(formatClock(new Date(2025, 0, 1, 0, 5, 0), { showSeconds: false, hour12: true }), '12:05 AM');
  assert.equal(formatClock(new Date(2025, 0, 1, 9, 5, 0), { showSeconds: false, hour12: true }), '09:05 AM');
});

test('formatDuration shows MM:SS under an hour', () => {
  assert.equal(formatDuration(75), '01:15');
  assert.equal(formatDuration(0), '00:00');
});

test('formatDuration shows H:MM:SS at/over an hour', () => {
  assert.equal(formatDuration(3661), '1:01:01');
});

test('formatDuration clamps negatives to zero', () => {
  assert.equal(formatDuration(-50), '00:00');
});

test('secondsUntil never negative', () => {
  const now = new Date(2025, 0, 1, 12, 0, 0);
  assert.equal(secondsUntil(new Date(2025, 0, 1, 12, 0, 30), now), 30);
  assert.equal(secondsUntil(new Date(2025, 0, 1, 11, 0, 0), now), 0);
});
