/**
 * Unified Multi-Display Application - Main Entry Point
 * Electron main process for cross-platform video + clock + controller
 */

const { app, globalShortcut } = require('electron');

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
// SINGLE INSTANCE
// ════════════════════════════════════════════════════════════════

// Ensure only one copy of the app runs. The 'second-instance' handler
// (below) focuses the existing controller when a second launch is attempted.
// Note: config/cache use Electron's standard per-user location
// (app.getPath('userData')), which works in both dev and packaged builds —
// see ConfigManager. We intentionally do NOT redirect userData into the app
// folder, because that folder is read-only inside a packaged app.asar.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

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
  ipcHandler = new IPCHandler(displayManager, configManager, {
    onReconfigure: reopenSelector,
  });

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
 * Close all content windows and reopen the screen picker.
 * Used by the controller's "Reconfigure Displays" button and the global
 * escape-hatch hotkey (so you can recover even if every screen is covered).
 */
function reopenSelector() {
  console.log('Reopening display selector...');
  displayManager.closeAllDisplayWindows();
  showDisplaySelector();
}

/**
 * Launch all display windows based on configuration
 */
function launchDisplayWindows() {
  console.log('Launching display windows...');

  try {
    // Open the controller on the screen the user is currently on.
    const controllerDisplay = displayManager.getCursorDisplay();

    // Create controller window first — but reuse the existing one if we're
    // re-launching after a reconfigure (otherwise we'd spawn a duplicate
    // controller, and closing it quits the app via the lifecycle manager).
    const existingController = displayManager.windows.controller;
    if (existingController && !existingController.isDestroyed()) {
      console.log('Reusing existing controller window');
    } else {
      const controllerWindow = displayManager.createControllerWindow(controllerDisplay);
      lifecycleManager.setParentWindow(controllerWindow);
    }

    // Create all configured content windows dynamically.
    // Supports any number of: video, clock, web, youtube (one per assigned screen).
    displayManager.createAllDisplayWindows(userConfig);

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

    // `--reset` (e.g. `npm start -- --reset`) wipes the saved setup so you
    // always get a fresh screen picker — handy if you mis-assigned every screen.
    if (process.argv.includes('--reset')) {
      console.log('Reset flag detected - clearing saved configuration');
      configManager.resetConfig();
    }

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

/**
 * YouTube refuses to configure its embed player when the request carries no
 * HTTP Referer ("Video unavailable — Error 153"), which is always the case for
 * pages loaded from file://. Identify our hosted controller site as the
 * embedder on embed-document requests only; everything else is untouched.
 * Videos whose owners disable embedding entirely (errors 101/150) still won't play.
 */
function setupYouTubeEmbedReferer() {
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*'] },
    (details, callback) => {
      const headers = details.requestHeaders;
      if (!headers.Referer && !headers.referer) headers.Referer = 'https://multi-displayer.web.app/';
      callback({ requestHeaders: headers });
    },
  );
}

app.on('ready', () => {
  console.log('Electron app ready');
  setupYouTubeEmbedReferer();
  startup();
  registerShortcuts();
});

/**
 * Global escape-hatch hotkeys (work even when every screen is covered):
 *  - Ctrl/Cmd+Shift+R → reopen the screen picker (re-assign roles).
 *  - Ctrl/Cmd+Shift+Q → quit the whole app.
 */
function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    console.log('Global shortcut: reopen selector');
    if (displayManager) reopenSelector();
  });
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    console.log('Global shortcut: quit');
    app.quit();
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());

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
