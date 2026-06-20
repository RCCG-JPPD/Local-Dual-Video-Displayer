/**
 * Pure slideshow navigation helper. Unit-tested; exposed to the renderer via
 * preload (mirrors youtube.js / weburl.js / clockformat.js).
 */

/**
 * Compute the next item index when advancing a slideshow.
 *
 * @param {number} index   current item index
 * @param {number} length  number of items
 * @param {number} dir     +1 (forward) or -1 (backward)
 * @param {boolean} loop   wrap around at the ends
 * @returns {number} the next index, or -1 to signal "stop" (end reached, no loop)
 */
function nextIndex(index, length, dir, loop) {
  if (!length || length <= 0) return 0;
  const i = index + dir;
  if (i >= length) return loop ? 0 : -1;
  if (i < 0) return loop ? length - 1 : 0;
  return i;
}

module.exports = { nextIndex };
