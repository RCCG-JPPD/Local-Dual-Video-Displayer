/**
 * Telling a real camera from a virtual one, and choosing which to open.
 *
 * WHY THIS EXISTS. A virtual camera is not a camera: it is another program's
 * output dressed up as a capture device (OBS, VDO.Ninja, NDI, phone-as-webcam
 * apps). Opening one is almost never what an operator meant here, and it has a
 * cost they cannot see — a virtual camera can usually be read by only one
 * program at a time, so while this app holds it, the app that actually needs
 * it cannot find it. The reported symptom is always the same and never points
 * back here: "Zoom can't find the OBS Virtual Camera any more."
 *
 * The trap is `getUserMedia({ video: true })` with no deviceId. That opens
 * whatever Windows calls the default, which on a machine with OBS installed is
 * very often OBS Virtual Camera — so a screen that merely OPENS silently locks
 * the device out of the meeting software. Hence resolveDeviceId(): callers ask
 * for a real device by id, and never fall back to the system default.
 *
 * Labels are readable from enumerateDevices() before any stream is opened
 * (verified on the venue machine), so nothing here has to touch a device to
 * decide about it.
 *
 * No DOM or Electron dependencies, so it is unit-tested with `node --test`.
 */

/**
 * Substrings that mark a video input as another program's output.
 *
 * Matched case-insensitively against the device label. Every entry is
 * deliberately specific enough not to catch real hardware: this list must
 * never contain a bare word like "camera", "capture" or "video", or it would
 * hide the capture cards and USB cameras a venue actually films with. A
 * missed virtual camera is a minor annoyance; a hidden real one means the
 * operator cannot get their camera on screen at all.
 */
const VIRTUAL_CAMERA_PATTERNS = [
  // OBS. 'obs-camera' also covers OBS-Camera2/3/4, the extra DirectShow
  // filters OBS registers alongside the main one.
  'obs virtual camera',
  'obs-camera',
  'obs camera',
  // Catch-all for the many others that name themselves plainly. Vendors of
  // real hardware do not put "virtual" on the box.
  'virtual camera',
  'virtualcam',
  // This app talks to VDO.Ninja natively (see vdoninja.js) — routing it back
  // in through a loopback device would be a slower way to do the same thing.
  'vdo.ninja camera',
  // Named products, spelled out rather than abbreviated: 'ndi' as a substring
  // would match "SanDisk".
  'ndi video',
  'newtek',
  'snap camera',
  'manycam',
  'xsplit',
  'streamlabs',
  'nvidia broadcast',
  'e2esoft',
  'ivcam',
  'droidcam',
  'epoccam',
  'iriun',
];

/**
 * Is this label another program's output rather than a camera?
 * @param {string} label MediaDeviceInfo.label
 * @returns {boolean} false for a blank label — never guess a device away.
 */
function isVirtualCamera(label) {
  if (typeof label !== 'string' || !label.trim()) return false;
  const text = label.toLowerCase();
  return VIRTUAL_CAMERA_PATTERNS.some(p => text.includes(p));
}

/**
 * Tag every device with what it is, keeping the shape callers already expect.
 * @param {Array<{deviceId: string, label: string}>} devices
 * @returns {Array<{deviceId: string, label: string, virtual: boolean}>}
 */
function tagDevices(devices) {
  if (!Array.isArray(devices)) return [];
  return devices
    .filter(d => d && typeof d === 'object')
    .map(d => ({
      deviceId: typeof d.deviceId === 'string' ? d.deviceId : '',
      label: typeof d.label === 'string' ? d.label : '',
      virtual: isVirtualCamera(d.label),
    }));
}

/** Just the cameras — what the operator should be offered. */
function realCameras(devices) {
  return tagDevices(devices).filter(d => !d.virtual);
}

/** Just the ones being kept out of the way, so the UI can say which. */
function virtualCameras(devices) {
  return tagDevices(devices).filter(d => d.virtual);
}

/**
 * Which device should actually be opened.
 *
 * Returns a deviceId to be used as an EXACT constraint, or '' meaning "do not
 * open anything". '' is never "fall back to the system default": that default
 * is exactly the thing that grabs OBS Virtual Camera out from under Zoom.
 *
 * A preferred id is honoured when it names a real, present camera. An id that
 * has gone away, or that names a virtual camera, falls through to the first
 * real camera rather than to the default.
 *
 * @param {Array<{deviceId: string, label: string}>} devices from enumerateDevices
 * @param {string} [preferredId] the operator's saved choice
 * @returns {string} deviceId, or '' when there is no real camera to open
 */
function resolveDeviceId(devices, preferredId) {
  const real = realCameras(devices);
  const wanted = typeof preferredId === 'string' ? preferredId : '';

  const exact = real.find(d => d.deviceId && d.deviceId === wanted);
  if (exact) return exact.deviceId;

  const first = real.find(d => d.deviceId);
  return first ? first.deviceId : '';
}

/**
 * Why nothing can be opened, in words an operator can act on.
 * @param {Array<{deviceId: string, label: string}>} devices
 * @returns {string} '' when there is a real camera to open
 */
function noCameraReason(devices) {
  const all = tagDevices(devices);
  if (realCameras(all).length) return '';
  if (!all.length) return 'No camera found. Plug one in, then press Rescan.';
  const names = virtualCameras(all).map(d => d.label).join(', ');
  return `Only virtual cameras were found (${names}). Those belong to other `
    + 'programs — this app leaves them alone so Zoom and Teams can use them. '
    + 'Plug in a real camera, or use a VDO.Ninja source instead.';
}

module.exports = {
  VIRTUAL_CAMERA_PATTERNS,
  isVirtualCamera,
  tagDevices,
  realCameras,
  virtualCameras,
  resolveDeviceId,
  noCameraReason,
};
