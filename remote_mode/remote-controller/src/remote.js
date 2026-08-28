/**
 * Shared pure helpers for the web/phone remote controller (browser ESM).
 * Mirrors the desktop app's src/utils/remote.js so the session code + command
 * contract stays identical on both ends.
 */

export const SESSION_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Actions this UI can send. Must match REMOTE_ACTIONS in the desktop app.
export const ACTIONS = {
  presPrev: 'pres.prev',
  presNext: 'pres.next',
  presGoto: 'pres.goto',
  presBlank: 'pres.blank',
  slidePrev: 'slide.prev',
  slideNext: 'slide.next',
  slideGoto: 'slide.goto',
  slidePlayPause: 'slide.playpause',
  slideBlank: 'slide.blank',
  videoPlayPause: 'video.playpause',
  videoPrev: 'video.prev',
  videoNext: 'video.next',
  videoStop: 'video.stop',
  videoGoto: 'video.goto',
  videoSeek: 'video.seek',
  videoVolume: 'video.volume',
  videoZoom: 'video.zoom',
  slideZoom: 'slide.zoom',
  ytZoom: 'yt.zoom',
  ytPlay: 'yt.play',
  ytPause: 'yt.pause',
  ytMute: 'yt.mute',
  ytVolume: 'yt.volume',
  ytLoad: 'yt.load',
  webLoad: 'web.load',
  webBack: 'web.back',
  webFwd: 'web.fwd',
  webReload: 'web.reload',
  excelSheet: 'excel.sheet',
  camLive: 'cam.live',
  camOff: 'cam.off',
  camReset: 'cam.reset',
  camRestore: 'cam.restore',
  camBlank: 'cam.blank',
  camZoom: 'cam.zoom',
  camTake: 'cam.take',
  ocrOn: 'ocr.on',
  ocrOff: 'ocr.off',
  captionText: 'caption.text',
};

/** Uppercase + forgive ambiguous typing (O→0, I/L→1), drop non-alphabet chars. */
export function normalizeSessionCode(input) {
  return String(input == null ? '' : input)
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(new RegExp(`[^${SESSION_CODE_ALPHABET}]`, 'g'), '');
}

/** True when `code` is exactly `length` chars, all from the alphabet. */
export function isValidSessionCode(code, length = 6) {
  return typeof code === 'string' &&
    code.length === length &&
    [...code].every((c) => SESSION_CODE_ALPHABET.includes(c));
}

/** Extract + normalize the session code from a URL query string (?s=CODE). */
export function parseSessionParam(search) {
  if (!search) return null;
  const q = search.charAt(0) === '?' ? search.slice(1) : search;
  const code = new URLSearchParams(q).get('s');
  if (!code) return null;
  const normalized = normalizeSessionCode(code);
  return normalized || null;
}
