const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUrl } = require('../src/utils/weburl');

test('prefixes https:// for a bare domain', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
});

test('leaves http:// URLs untouched', () => {
  assert.equal(normalizeUrl('http://example.com/path'), 'http://example.com/path');
});

test('leaves https:// URLs untouched', () => {
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
});

test('is case-insensitive about the scheme', () => {
  assert.equal(normalizeUrl('HTTPS://Example.com'), 'HTTPS://Example.com');
});

test('leaves about: URLs untouched', () => {
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
});

test('trims whitespace', () => {
  assert.equal(normalizeUrl('  example.com  '), 'https://example.com');
});

test('returns empty string for empty/invalid input', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl('   '), '');
  assert.equal(normalizeUrl(null), '');
});
