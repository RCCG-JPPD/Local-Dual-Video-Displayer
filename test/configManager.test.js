const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ConfigManager = require('../src/modules/configManager');

// ConfigManager only needs app.getPath('userData'); point it at a temp dir.
function makeManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvd-cfg-'));
  const app = { getPath: () => dir };
  return { mgr: new ConfigManager(app), dir };
}

test('isConfigValid: false when no displays', () => {
  const { mgr } = makeManager();
  assert.equal(mgr.isConfigValid({ displays: [] }), false);
  assert.equal(mgr.isConfigValid({}), false);
});

test('isConfigValid: true when a screen has a content role', () => {
  const { mgr } = makeManager();
  assert.equal(mgr.isConfigValid({ displays: [{ role: 'video' }] }), true);
  assert.equal(mgr.isConfigValid({ displays: [{ role: 'clock' }, { role: 'unassigned' }] }), true);
});

test('isConfigValid: false when only unassigned/controller roles', () => {
  const { mgr } = makeManager();
  assert.equal(mgr.isConfigValid({ displays: [{ role: 'unassigned' }, { role: 'controller' }] }), false);
});

test('deepMerge merges nested objects without dropping siblings', () => {
  const { mgr } = makeManager();
  const merged = mgr.deepMerge(
    { playback: { volume: 1, playlist: [] }, clock: { format: '24h' } },
    { playback: { volume: 0.5 } }
  );
  assert.equal(merged.playback.volume, 0.5);
  assert.deepEqual(merged.playback.playlist, []);
  assert.equal(merged.clock.format, '24h');
});

test('saveConfig + loadConfig round-trips to disk', () => {
  const { mgr } = makeManager();
  mgr.saveConfig({ displays: [{ role: 'video', displayIndex: 0 }], version: '2.0.0' });
  const loaded = mgr.loadConfig();
  assert.equal(loaded.displays[0].role, 'video');
  assert.ok(loaded.lastModified, 'saveConfig stamps lastModified');
});

test('loadConfig returns defaults on first run', () => {
  const { mgr } = makeManager();
  const cfg = mgr.loadConfig();
  assert.ok(Array.isArray(cfg.displays));
  assert.equal(cfg.displays.length, 0);
  assert.ok(cfg.playback);
});
