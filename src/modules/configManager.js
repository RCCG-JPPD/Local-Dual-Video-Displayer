/**
 * Configuration Manager
 * Handles loading, saving, and migrating application configurations
 */

const fs = require('fs');
const path = require('path');
const configSchema = require('../utils/config');

class ConfigManager {
  constructor(app) {
    this.app = app;
    this.configDir = path.join(app.getPath('userData'), 'config');
    this.configFile = path.join(this.configDir, 'app-config.json');
    this.legacyConfigFile = path.join(this.configDir, 'legacy-config.json');

    // In-memory copy of the config. Serves every read, and writes are
    // debounced to disk — updateConfig fires on hot paths (web navigation,
    // slide index changes), and each used to be a synchronous file
    // read + write on the main process.
    this._cache = null;
    this._flushTimer = null;

    // Ensure config directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    // Persist any pending write before the app exits. (Unit tests pass a
    // stub app with no event emitter — guard for it.)
    if (typeof app.on === 'function') {
      app.on('will-quit', () => this.flush());
    }
  }

  /**
   * Load configuration: from memory once cached, else disk, else defaults.
   */
  loadConfig() {
    if (this._cache) return this._cache;
    try {
      // Check if new config exists
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        this._cache = JSON.parse(data);
        console.log('Loaded config from:', this.configFile);
        return this._cache;
      }

      // Check if we need to migrate from old setup
      const migratedConfig = this.migrateFromLegacy();
      if (migratedConfig) {
        console.log('Migrated from legacy setup');
        this.saveConfig(migratedConfig);
        return migratedConfig;
      }

      // Return default config for first run (not cached — nothing saved yet)
      console.log('First run - using default config');
      return JSON.parse(JSON.stringify(configSchema));
    } catch (error) {
      console.error('Error loading config:', error);
      return JSON.parse(JSON.stringify(configSchema));
    }
  }

  /**
   * Migrate configuration from old main.js setup (hard-coded 3-display config)
   * Detection logic: If the app has been run before with multiple displays
   */
  migrateFromLegacy() {
    try {
      // Check if legacy data exists in userData
      const legacyDataPath = path.join(this.app.getPath('userData'), '../..');

      // Try to detect if old main.js was used by checking electron_data
      const electronDataPath = path.join(this.app.getPath('userData'));

      // For now, we'll return null (no legacy config found)
      // In production, this would scan for old config files
      console.log('No legacy config found');
      return null;
    } catch (error) {
      console.error('Error during legacy migration:', error);
      return null;
    }
  }

  /**
   * Delete the saved configuration (full reset → next launch shows the selector).
   */
  resetConfig() {
    this._cache = null;
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    try {
      if (fs.existsSync(this.configFile)) {
        fs.unlinkSync(this.configFile);
        console.log('Config reset (deleted):', this.configFile);
      }
      return true;
    } catch (error) {
      console.error('Error resetting config:', error);
      return false;
    }
  }

  /**
   * Save configuration: updates the in-memory copy immediately and debounces
   * the disk write (bursts of updates → one file write).
   */
  saveConfig(config) {
    config.lastModified = new Date().toISOString();
    this._cache = config;
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => this.flush(), 500);
      if (this._flushTimer.unref) this._flushTimer.unref(); // never hold the app open
    }
    return true;
  }

  /**
   * Write the in-memory config to disk now (pending debounce or app quit).
   */
  flush() {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    if (!this._cache) return true;
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(this._cache, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  /**
   * Update specific config values
   */
  updateConfig(updates) {
    const config = this.loadConfig();
    const merged = this.deepMerge(config, updates);
    this.saveConfig(merged);
    return merged;
  }

  /**
   * Deep merge objects (for nested config updates)
   */
  deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Save display configuration (called after user selects displays)
   */
  saveDisplayConfig(displays) {
    return this.updateConfig({ displays });
  }

  /**
   * Save playlist
   */
  savePlaylist(playlist) {
    return this.updateConfig({ playback: { playlist } });
  }

  /**
   * Get specific display by role
   */
  getDisplayByRole(config, role) {
    return config.displays.find(d => d.role === role);
  }

  /**
   * Check if configuration is valid (has displays assigned)
   */
  isConfigValid(config) {
    if (!config.displays || config.displays.length === 0) return false;
    return config.displays.some(d => d.role && d.role !== 'unassigned' && d.role !== 'controller');
  }
}

module.exports = ConfigManager;
