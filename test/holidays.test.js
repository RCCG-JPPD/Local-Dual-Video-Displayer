const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computusEaster, getActiveHoliday, holidaysForYear } = require('../src/utils/holidays');

// Known Gregorian Easter Sundays.
const KNOWN_EASTER = {
  2024: '2024-03-31',
  2025: '2025-04-20',
  2026: '2026-04-05',
  2027: '2027-03-28',
  2030: '2030-04-21',
};

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('computusEaster matches known dates', () => {
  for (const [year, expected] of Object.entries(KNOWN_EASTER)) {
    assert.equal(iso(computusEaster(Number(year))), expected, `Easter ${year}`);
  }
});

test('getActiveHoliday: Christmas Day', () => {
  const h = getActiveHoliday(new Date(2025, 11, 25));
  assert.equal(h.key, 'christmas');
  assert.equal(h.animation, 'snow');
});

test('getActiveHoliday: New Year spans Dec 31 -> Jan 1', () => {
  assert.equal(getActiveHoliday(new Date(2025, 11, 31)).key, 'newyear');
  assert.equal(getActiveHoliday(new Date(2026, 0, 1)).key, 'newyear');
  assert.equal(getActiveHoliday(new Date(2026, 0, 1)).animation, 'fireworks');
});

test('getActiveHoliday: Easter Sunday 2025 (Apr 20)', () => {
  const h = getActiveHoliday(new Date(2025, 3, 20));
  assert.equal(h.key, 'easter');
  assert.equal(h.animation, 'petals');
});

test('getActiveHoliday: ordinary day returns null', () => {
  assert.equal(getActiveHoliday(new Date(2025, 6, 15)), null); // mid-July
});

test('holidaysForYear includes all expected feasts', () => {
  const keys = holidaysForYear(2025).map(h => h.key);
  for (const k of ['newyear', 'epiphany', 'ash-wednesday', 'palm-sunday', 'good-friday', 'easter', 'ascension', 'pentecost', 'advent', 'christmas']) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
});
