/**
 * Pure clock/countdown formatting helpers (unit-tested, exposed via preload).
 */

/**
 * Format a Date as a clock string.
 * @param {Date} date
 * @param {{ showSeconds?: boolean, hour12?: boolean }} opts
 * @returns {string} e.g. "14:05", "14:05:09", "2:05 PM"
 */
function formatClock(date, opts = {}) {
  const { showSeconds = true, hour12 = false } = opts;
  let h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  const pad = (n) => String(n).padStart(2, '0');

  let suffix = '';
  if (hour12) {
    suffix = h >= 12 ? ' PM' : ' AM';
    h = h % 12 || 12;
  }
  // Pad the hour to 2 digits in both 24h and 12h (matches toLocaleTimeString 'en-US').
  const hh = pad(h);
  let out = `${hh}:${pad(m)}`;
  if (showSeconds) out += `:${pad(s)}`;
  return out + suffix;
}

/**
 * Format a non-negative number of seconds as a countdown string.
 * Shows H:MM:SS when an hour or more remains, otherwise MM:SS.
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatDuration(totalSeconds) {
  const t = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Seconds remaining until `target` from `now` (never negative). */
function secondsUntil(target, now = new Date()) {
  return Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
}

module.exports = { formatClock, formatDuration, secondsUntil };
