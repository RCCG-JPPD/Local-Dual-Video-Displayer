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

test('saveConfig serves reads from memory and flush() persists for a fresh reader', () => {
  const { mgr, dir } = makeManager();
  mgr.saveConfig({ displays: [{ role: 'clock' }], version: '2.0.0' });
  // Same manager sees the write immediately (memory), before any disk flush.
  assert.equal(mgr.loadConfig().displays[0].role, 'clock');
  mgr.flush();
  // A brand-new manager on the same dir (≈ next app run) reads the flushed file.
  const mgr2 = new ConfigManager({ getPath: () => dir });
  assert.equal(mgr2.loadConfig().displays[0].role, 'clock');
});

test('resetConfig drops the cache and any pending write', () => {
  const { mgr, dir } = makeManager();
  mgr.saveConfig({ displays: [{ role: 'video' }], version: '2.0.0' });
  mgr.resetConfig();
  mgr.flush(); // must not resurrect the deleted config
  const mgr2 = new ConfigManager({ getPath: () => dir });
  assert.equal(mgr2.loadConfig().displays.length, 0); // back to defaults
});
