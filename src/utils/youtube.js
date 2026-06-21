/**
 * Extract a YouTube video ID from a URL or raw ID.
 * Handles watch URLs, youtu.be short links, /embed/ and /shorts/ paths,
 * extra query params, and bare 11-char IDs.
 *
 * @param {string} urlOrId
 * @returns {string} the 11-char video ID, or '' if none could be parsed
 */
function extractVideoId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const input = urlOrId.trim();

  // Bare 11-char ID (YouTube IDs are [A-Za-z0-9_-]{11}).
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;

  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,        // watch?v=ID
    /youtu\.be\/([A-Za-z0-9_-]{11})/,   // youtu.be/ID
    /\/embed\/([A-Za-z0-9_-]{11})/,     // /embed/ID
    /\/shorts\/([A-Za-z0-9_-]{11})/,    // /shorts/ID
    /\/v\/([A-Za-z0-9_-]{11})/,         // /v/ID
  ];

  for (const re of patterns) {
    const m = input.match(re);
    if (m) return m[1];
  }
  return '';
}

module.exports = { extractVideoId };
