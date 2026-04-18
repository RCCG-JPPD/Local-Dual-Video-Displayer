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

    // Ensure config directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * Load configuration from disk or return defaults if not found
   */
  loadConfig() {
    try {
      // Check if new config exists
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        const config = JSON.parse(data);
        console.log('Loaded config from:', this.configFile);
        return config;
      }

      // Check if we need to migrate from old setup
      const migratedConfig = this.migrateFromLegacy();
      if (migratedConfig) {
        console.log('Migrated from legacy setup');
        this.saveConfig(migratedConfig);
        return migratedConfig;
      }

      // Return default config for first run
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
   * Save configuration to disk
   */
  saveConfig(config) {
    try {
      config.lastModified = new Date().toISOString();
      const data = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.configFile, data, 'utf8');
      console.log('Config saved to:', this.configFile);
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
