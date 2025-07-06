// main.js
const path = require('path');
const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron');

// ── Redirect Electron’s data & cache into a local folder:
const myDataDir = path.join(__dirname, 'electron_data');
app.setPath('userData', myDataDir);
app.setPath('cache',   path.join(myDataDir, 'Cache'));

let publicWindow, privateWindow, controllerWindow;

function createWindows () {
  const displays = screen.getAllDisplays();
  if (displays.length < 3) {
    dialog.showErrorBox('Display Error', 'Three monitors are required (public / controller / private).');
    app.quit(); return;
  }
  const [publicDisplay, controllerDisplay, privateDisplay] = displays; // reorder if needed

  const videoOpts = {
    fullscreen:   true,
    frame:        false,
    alwaysOnTop:  true,
    minimizable:  false,
    webPreferences: { nodeIntegration:true, contextIsolation:false }
  };

  // ► PUBLIC VIDEO WINDOW (with audio)
  publicWindow = new BrowserWindow({ ...videoOpts, x: publicDisplay.bounds.x, y: publicDisplay.bounds.y });

  // ► PRIVATE VIDEO WINDOW (muted)
  privateWindow = new BrowserWindow({ ...videoOpts, x: privateDisplay.bounds.x, y: privateDisplay.bounds.y });
  privateWindow.webContents.setAudioMuted(true);

  // ► CONTROLLER WINDOW
  controllerWindow = new BrowserWindow({
    x: controllerDisplay.bounds.x, y: controllerDisplay.bounds.y,
    width: 800, height: 600, alwaysOnTop:true,
    webPreferences: { nodeIntegration:true, contextIsolation:false }
  });

  // ── Load views
  const viewHTML = path.join(__dirname, 'video-view.html');
  publicWindow.loadFile(viewHTML);
  privateWindow.loadFile(viewHTML);
  controllerWindow.loadFile(path.join(__dirname, 'controller.html'));

  // publicWindow.webContents.openDevTools({ mode: 'detach' });

  // ────────────────────── IPC ──────────────────────
  // 1) Controller ➜ both video windows
  ipcMain.on('controller-command', (_e, cmd, data) => {
    [publicWindow, privateWindow].forEach(w => w.webContents.send('playback-command', cmd, data));
  });

  // 2) Public video ➜ controller (time updates)
  const PUBLIC_ID = publicWindow.webContents.id;
  ipcMain.on('video-time', (e, now, dur) => {
    if (e.sender.id === PUBLIC_ID) controllerWindow.webContents.send('video-time', now, dur);
  });

  // 3) Controller ➜ open-file dialog (returns file paths)
  ipcMain.handle('open-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(controllerWindow, {
      title: 'Choose video(s)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name:'Videos', extensions:['mp4','mov','mkv','avi','webm','m4v','wmv'] }]
    });
    return canceled ? [] : filePaths;
  });

  // ── Force always-on-top
  const keepTop = w => { if (!w.isDestroyed()) { w.setAlwaysOnTop(true,'screen-saver'); w.moveTop(); } };
  setInterval(() => [publicWindow, privateWindow, controllerWindow].forEach(keepTop), 1000);

  [publicWindow, privateWindow, controllerWindow].forEach(w=>{
    ['minimize','hide'].forEach(evt=>{
      w.on(evt, e=>{ e.preventDefault(); w.restore(); keepTop(w); });
    });
    w.on('blur', () => keepTop(w));
  });
}

app.whenReady().then(createWindows);
app.on('window-all-closed',()=>{ if (process.platform!=='darwin') app.quit(); });
app.on('activate',()=>{ if (BrowserWindow.getAllWindows().length===0) createWindows(); });