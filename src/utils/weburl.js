/**
 * Normalize a user-entered web address into a loadable URL.
 * - trims whitespace
 * - leaves http(s):// and about: URLs untouched
 * - otherwise prefixes https://
 *
 * @param {string} url
 * @returns {string} normalized URL, or '' if input was empty
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const input = url.trim();
  if (!input) return '';
  if (/^https?:\/\//i.test(input) || /^about:/i.test(input)) return input;
  return 'https://' + input;
}

module.exports = { normalizeUrl };
