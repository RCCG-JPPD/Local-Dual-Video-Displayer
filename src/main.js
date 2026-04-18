/**
 * Unified Multi-Display Application - Main Entry Point
 * Electron main process for cross-platform video + clock + controller
 */

const path = require('path');
const { app } = require('electron');

// Modules
const ConfigManager = require('./modules/configManager');
const DisplayManager = require('./modules/displayManager');
const WindowLifecycleManager = require('./modules/windowLifecycle');
const IPCHandler = require('./modules/ipcHandler');

// ════════════════════════════════════════════════════════════════
// APPLICATION STATE
// ════════════════════════════════════════════════════════════════

let configManager;
let displayManager;
let lifecycleManager;
let ipcHandler;
let userConfig;

// ════════════════════════════════════════════════════════════════
// DATA PATH SETUP
// ════════════════════════════════════════════════════════════════

// Redirect Electron's data & cache into a local folder
const myDataDir = path.join(__dirname, '../../electron_data');
app.setPath('userData', myDataDir);
app.setPath('cache', path.join(myDataDir, 'Cache'));

// ════════════════════════════════════════════════════════════════
// APPLICATION LIFECYCLE
// ════════════════════════════════════════════════════════════════

/**
 * Initialize modules and managers
 */
function initializeManagers() {
  console.log('Initializing managers...');

  configManager = new ConfigManager(app);
  displayManager = new DisplayManager(app);
  lifecycleManager = new WindowLifecycleManager(app);
  ipcHandler = new IPCHandler(displayManager, configManager);

  // Set up IPC listeners
  ipcHandler.setupListeners();

  console.log('Managers initialized');
}

/**
 * Show display selector if first run or config invalid
 */
function showDisplaySelector() {
  console.log('Launching display selector...');

  const selectorWindow = displayManager.createSelectorWindow();

  // When selector confirms, launch display windows
  selectorWindow.webContents.on('did-finish-load', () => {
    console.log('Display selector loaded');
  });

  // Listen for selector close event
  selectorWindow.on('closed', () => {
    console.log('Display selector closed');

    // Check if config was saved
    userConfig = configManager.loadConfig();
    if (configManager.isConfigValid(userConfig)) {
      console.log('Config validated after selector');
      launchDisplayWindows();
    } else {
      console.warn('No valid config after selector');
      app.quit();
    }
  });
}

/**
 * Launch all display windows based on configuration
 */
function launchDisplayWindows() {
  console.log('Launching display windows...');

  try {
    const displays = displayManager.detectDisplays();
    const primaryDisplay = displays[0];

    // Create controller window first
    const controllerWindow = displayManager.createControllerWindow(primaryDisplay);
    lifecycleManager.setParentWindow(controllerWindow);

    // Create all configured display windows dynamically
    // Supports: public_video, private_video, clock, web, youtube, unassigned
    displayManager.createAllDisplayWindows(userConfig);

    // Register all child windows with lifecycle manager
    const allWindowIds = new Set(displayManager.childWindowIds);
    allWindowIds.forEach(windowId => {
      // Note: We can't directly access windows by ID, so we rely on the windows stored in displayManager
      // Child windows are automatically tracked when created
    });

    if (displayManager.windows.controller) {
      displayManager.windows.controller.webContents.send('config-loaded', userConfig);
    }

    console.log('Display windows launched successfully');
  } catch (error) {
    console.error('Error launching display windows:', error);
  }
}

/**
 * Main startup routine
 */
function startup() {
  console.log('Application starting up...');

  try {
    initializeManagers();

    // Load existing config
    userConfig = configManager.loadConfig();
    console.log('Config loaded:', userConfig.version);

    // Check if config is valid (has displays configured)
    if (configManager.isConfigValid(userConfig)) {
      console.log('Using saved configuration');
      launchDisplayWindows();
    } else {
      console.log('No valid configuration found - showing selector');
      showDisplaySelector();
    }
  } catch (error) {
    console.error('Startup error:', error);
    app.quit();
  }
}

// ════════════════════════════════════════════════════════════════
// ELECTRON APP EVENTS
// ════════════════════════════════════════════════════════════════

app.on('ready', () => {
  console.log('Electron app ready');
  startup();
});

app.on('window-all-closed', () => {
  console.log('All windows closed');

  // On macOS, keep app alive until user explicitly quits
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-show window when dock icon is clicked
  const windows = require('electron').BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    console.log('App activated - recreating windows');
    startup();
  }
});

app.on('second-instance', () => {
  // Prevent multiple instances
  console.log('Second instance attempted - showing existing window');
  if (displayManager && displayManager.windows.controller) {
    const controller = displayManager.windows.controller;
    if (controller.isMinimized()) controller.restore();
    controller.focus();
  }
});

// ════════════════════════════════════════════════════════════════
// LOGGING
// ════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════');
console.log('📺 Multi-Display Video + Clock Application');
console.log('Platform:', process.platform);
console.log('Electron version:', require('electron').app.getVersion());
console.log('═══════════════════════════════════════════════════════════');
