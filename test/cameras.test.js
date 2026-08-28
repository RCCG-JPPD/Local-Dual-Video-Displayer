const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isVirtualCamera, tagDevices, realCameras, virtualCameras,
  resolveDeviceId, noCameraReason,
} = require('../src/utils/cameras');

// The real device list from the venue machine, read with enumerateDevices()
// before any stream was opened. The whole point of this module is to get this
// exact list right, so it is the fixture.
const VENUE = [
  { deviceId: 'c16923c1', label: 'USB  Camera (0c45:6366)' },
  { deviceId: 'ffe1e7e6', label: 'Game Capture 4K60 Pro MK.2' },
  { deviceId: 'e986a839', label: 'OBS-Camera' },
  { deviceId: '0a8f7b97', label: 'OBS-Camera2' },
  { deviceId: '27fddab4', label: 'VDO.Ninja Camera' },
  { deviceId: '52740b56', label: 'OBS Virtual Camera' },
  { deviceId: '9221894c', label: 'Elgato Screen Link' },
];

// ── what counts as virtual ────────────────────────────────────────────

test('every OBS device is recognised, including the numbered filters', () => {
  ['OBS Virtual Camera', 'OBS-Camera', 'OBS-Camera2', 'OBS-Camera3', 'OBS-Camera4']
    .forEach(l => assert.equal(isVirtualCamera(l), true, l));
});

test('other software virtual cameras are recognised', () => {
  ['VDO.Ninja Camera', 'Snap Camera', 'ManyCam Virtual Webcam', 'XSplit VCam',
    'NVIDIA Broadcast', 'DroidCam Source', 'Iriun Webcam', 'EpocCam Camera',
    'e2eSoft iVCam', 'NewTek NDI Video', 'Streamlabs Desktop Virtual Camera']
    .forEach(l => assert.equal(isVirtualCamera(l), true, l));
});

test('real hardware is never hidden', () => {
  // The expensive failure: hiding the camera the venue actually films with
  // leaves the operator with no way to get a picture on screen at all.
  ['USB  Camera (0c45:6366)', 'Game Capture 4K60 Pro MK.2', 'Elgato Screen Link',
    'Logitech BRIO', 'HD Pro Webcam C920', 'Integrated Webcam',
    'SanDisk Video Capture', 'AV.io HD', 'Cam Link 4K', 'Elgato Capture Card']
    .forEach(l => assert.equal(isVirtualCamera(l), false, l));
});

test('a blank label is never guessed away', () => {
  // Labels can be empty before the media permission has ever been granted.
  // Treating unknown as virtual would hide every camera on the machine.
  [undefined, null, '', '   ', 42, {}].forEach(l =>
    assert.equal(isVirtualCamera(l), false, String(l)));
});

test('matching ignores case', () => {
  assert.equal(isVirtualCamera('obs virtual camera'), true);
  assert.equal(isVirtualCamera('OBS VIRTUAL CAMERA'), true);
});

// ── splitting the list ────────────────────────────────────────────────

test('the venue list splits into three real cameras and four virtual ones', () => {
  const real = realCameras(VENUE).map(d => d.label);
  assert.deepEqual(real,
    ['USB  Camera (0c45:6366)', 'Game Capture 4K60 Pro MK.2', 'Elgato Screen Link']);
  assert.deepEqual(virtualCameras(VENUE).map(d => d.label),
    ['OBS-Camera', 'OBS-Camera2', 'VDO.Ninja Camera', 'OBS Virtual Camera']);
});

test('tagDevices keeps the shape callers already expect', () => {
  const [first] = tagDevices(VENUE);
  assert.deepEqual(Object.keys(first).sort(), ['deviceId', 'label', 'virtual']);
});

test('junk in never throws', () => {
  for (const bad of [null, undefined, 42, 'x', [null], [{}], [{ label: 7 }]]) {
    assert.ok(Array.isArray(tagDevices(bad)), String(bad));
    assert.ok(Array.isArray(realCameras(bad)), String(bad));
  }
});

// ── choosing what to open ─────────────────────────────────────────────

test('with no preference, the first REAL camera is chosen — never the default', () => {
  // Passing no deviceId at all is what hands OBS Virtual Camera to this app
  // and takes it away from Zoom. There must always be an explicit id.
  assert.equal(resolveDeviceId(VENUE, ''), 'c16923c1');
  assert.equal(resolveDeviceId(VENUE, undefined), 'c16923c1');
});

test('the operator\'s saved camera is honoured', () => {
  assert.equal(resolveDeviceId(VENUE, 'ffe1e7e6'), 'ffe1e7e6');
});

test('a saved choice that is now a virtual camera is refused, not opened', () => {
  // An older config could name OBS Virtual Camera, saved before this rule
  // existed. Honouring it would recreate the exact bug.
  assert.equal(resolveDeviceId(VENUE, '52740b56'), 'c16923c1');
  assert.equal(resolveDeviceId(VENUE, 'e986a839'), 'c16923c1');
});

test('a camera that has been unplugged falls back to a real one', () => {
  assert.equal(resolveDeviceId(VENUE, 'gone-away'), 'c16923c1');
});

test('with only virtual cameras present, nothing is opened at all', () => {
  const onlyVirtual = VENUE.filter(d => isVirtualCamera(d.label));
  assert.equal(resolveDeviceId(onlyVirtual, ''), '');
  assert.equal(resolveDeviceId(onlyVirtual, '52740b56'), '');
  assert.equal(resolveDeviceId([], ''), '');
});

// ── explaining it ─────────────────────────────────────────────────────

test('nothing is explained away when a real camera exists', () => {
  assert.equal(noCameraReason(VENUE), '');
});

test('an all-virtual machine is told why, and which', () => {
  const msg = noCameraReason(VENUE.filter(d => isVirtualCamera(d.label)));
  assert.match(msg, /OBS Virtual Camera/);
  assert.match(msg, /Zoom/);
});

test('an empty list says to plug something in', () => {
  assert.match(noCameraReason([]), /Plug one in/);
});
