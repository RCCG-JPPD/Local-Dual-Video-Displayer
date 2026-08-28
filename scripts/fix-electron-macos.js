#!/usr/bin/env node
/**
 * Repair the local Electron runtime on macOS.  `npm run fix:electron`
 *
 * Two things go wrong on a Mac dev machine, both unrelated to this app's code:
 *
 *  1. `npm install` can leave node_modules/electron/dist holding only the
 *     package tarball's licence files (~9 MB) instead of the ~235 MB runtime,
 *     because npm's allow-scripts gate blocks electron's postinstall.
 *
 *  2. macOS XProtect matches the ad-hoc code signature on Electron's prebuilt
 *     binary and SIGKILLs it at launch, moving the bundle to the Bin ("Malware
 *     Blocked and Moved to Bin"). It is a false positive - the download is
 *     verified against the SHA-256 that Electron publishes in its own npm
 *     package below - and re-signing ad-hoc locally changes the code hash so
 *     the match no longer fires.
 *
 * This is intentionally NOT a postinstall hook: it is macOS-only and would run
 * in CI, where neither problem exists.
 */
'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP = path.join(DIST, 'Electron.app');

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (process.platform !== 'darwin') {
  console.log('Not macOS — nothing to do.');
  process.exit(0);
}

const version = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
const zipName = `electron-v${version}-darwin-${process.arch}.zip`;

// ── 1. is the runtime actually there? ─────────────────────────────────
const binary = path.join(APP, 'Contents', 'MacOS', 'Electron');
const healthy = fs.existsSync(binary);
console.log(`Electron ${version} (${process.arch}) — runtime ${healthy ? 'present' : 'MISSING'}`);

if (!healthy) {
  // Find the cached download rather than re-fetching 96 MB.
  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'electron');
  let zip = null;
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot)) {
      const candidate = path.join(cacheRoot, dir, zipName);
      if (fs.existsSync(candidate)) { zip = candidate; break; }
    }
  }
  if (!zip) {
    fail(`No cached ${zipName}. Run:  node node_modules/electron/install.js`);
  }

  // Verify the download against Electron's own published checksum before
  // extracting anything — the whole point is to be sure this is genuine.
  const checksums = require(path.join(ROOT, 'node_modules', 'electron', 'checksums.json'));
  const expected = checksums[zipName];
  if (!expected) fail(`${zipName} is not listed in electron/checksums.json`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (actual !== expected) {
    fail(`Checksum MISMATCH for ${zipName}\n  expected ${expected}\n  actual   ${actual}\n`
      + '  Delete the cached zip and re-download; do not use this file.');
  }
  console.log(`✓ ${zipName} verified against Electron's published SHA-256`);

  // ditto (not unzip) — it preserves the app bundle's symlinks correctly.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  run('ditto', ['-xk', zip, DIST]);
  if (!fs.existsSync(binary)) fail('Extraction did not produce Electron.app');
  console.log('✓ runtime extracted');
}

// ── 2. re-sign so XProtect stops matching the stock hash ──────────────
try {
  run('xattr', ['-dr', 'com.apple.quarantine', APP]);
} catch (_) { /* nothing to clear */ }

run('codesign', ['--force', '--deep', '--sign', '-', APP]);
console.log('✓ re-signed ad-hoc (new code hash)');

// ── 3. prove it actually launches ─────────────────────────────────────
try {
  // ELECTRON_RUN_AS_NODE must be cleared or this reports Node's version.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const out = execFileSync(binary, ['--version'], { env }).toString().trim();
  console.log(`✓ launches cleanly: ${out}`);
} catch (err) {
  fail(`Electron still will not start (${err.status === null ? 'killed' : `exit ${err.status}`}).\n`
    + '  If it was killed, macOS removed it again — check System Settings →\n'
    + '  Privacy & Security, and restore Electron.app from the Bin.');
}

console.log('\nReady:  npm start');
