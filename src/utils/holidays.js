/**
 * Christian holiday calendar + animation mapping.
 *
 * Pure, dependency-free, and unit-tested. Dates are computed in local time.
 * `getActiveHoliday(date)` returns the holiday whose window contains `date`,
 * along with the animation key the clock should render.
 */

// --- date helpers (local time, midnight-normalized) ---
function ymd(year, month, day) {
  return new Date(year, month - 1, day);
}
function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/**
 * Gregorian Easter Sunday for a given year (Anonymous Gregorian / Meeus algorithm).
 * @returns {Date} local Date at midnight
 */
function computusEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/** 4th Sunday before Christmas (1st Sunday of Advent) for a year. */
function adventStart(year) {
  const christmas = ymd(year, 12, 25);
  // Sunday before Christmas, then back 3 more weeks.
  const dow = christmas.getDay(); // 0 = Sun
  const sundayBefore = addDays(christmas, dow === 0 ? -7 : -dow);
  return addDays(sundayBefore, -21);
}

/**
 * Build the holiday windows for a given year. Each entry has a [start, end]
 * inclusive local-date window and the animation it triggers.
 */
function holidaysForYear(year) {
  const easter = computusEaster(year);
  return [
    { key: 'newyear', name: "New Year", animation: 'fireworks', start: ymd(year, 12, 31), end: ymd(year + 1, 1, 1) },
    { key: 'epiphany', name: 'Epiphany', animation: 'stars', start: ymd(year, 1, 6), end: ymd(year, 1, 6) },
    { key: 'ash-wednesday', name: 'Ash Wednesday', animation: 'none', start: addDays(easter, -46), end: addDays(easter, -46) },
    { key: 'palm-sunday', name: 'Palm Sunday', animation: 'petals', start: addDays(easter, -7), end: addDays(easter, -7) },
    { key: 'good-friday', name: 'Good Friday', animation: 'none', start: addDays(easter, -2), end: addDays(easter, -2) },
    { key: 'easter', name: 'Easter', animation: 'petals', start: easter, end: addDays(easter, 1) },
    { key: 'ascension', name: 'Ascension', animation: 'stars', start: addDays(easter, 39), end: addDays(easter, 39) },
    { key: 'pentecost', name: 'Pentecost', animation: 'flames', start: addDays(easter, 49), end: addDays(easter, 49) },
    { key: 'advent', name: 'Advent', animation: 'snow', start: adventStart(year), end: ymd(year, 12, 23) },
    { key: 'christmas', name: 'Christmas', animation: 'snow', start: ymd(year, 12, 24), end: ymd(year, 12, 26) },
  ];
}

/** Animation keys, ordered, used by both clock and controller dropdown. */
const ANIMATIONS = ['fireworks', 'snow', 'petals', 'stars', 'flames'];

/** Stable list of holidays + their default animation, for the controller UI. */
const HOLIDAY_KEYS = [
  { key: 'newyear', name: 'New Year', animation: 'fireworks' },
  { key: 'christmas', name: 'Christmas', animation: 'snow' },
  { key: 'advent', name: 'Advent', animation: 'snow' },
  { key: 'epiphany', name: 'Epiphany', animation: 'stars' },
  { key: 'palm-sunday', name: 'Palm Sunday', animation: 'petals' },
  { key: 'easter', name: 'Easter', animation: 'petals' },
  { key: 'ascension', name: 'Ascension', animation: 'stars' },
  { key: 'pentecost', name: 'Pentecost', animation: 'flames' },
];

/**
 * The holiday active on `date` (its window includes the date), or null.
 * Checks this year's and last year's windows (so New Year spanning Dec 31→Jan 1 works).
 */
function getActiveHoliday(date = new Date()) {
  const day = startOfDay(date);
  const year = day.getFullYear();
  const candidates = [...holidaysForYear(year), ...holidaysForYear(year - 1)];

  // Prefer the most specific (shortest) window if several overlap.
  const matches = candidates.filter(h => day >= startOfDay(h.start) && day <= startOfDay(h.end));
  if (matches.length === 0) return null;
  matches.sort((a, b) => daysBetween(a.start, a.end) - daysBetween(b.start, b.end));
  const h = matches[0];
  return { key: h.key, name: h.name, animation: h.animation };
}

module.exports = {
  computusEaster,
  adventStart,
  holidaysForYear,
  getActiveHoliday,
  ANIMATIONS,
  HOLIDAY_KEYS,
};
