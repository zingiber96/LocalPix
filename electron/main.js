const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Mark ourselves to the embedded server so /api/config can tell the frontend
// it's running inside the desktop app (controls whether the "Change…" button
// appears next to the output folder).
process.env.LOCALCONVERT_ELECTRON = '1';

// Persisted settings live in the OS-standard userData folder:
//   macOS:   ~/Library/Application Support/LocalConvert/config.json
//   Windows: %APPDATA%/LocalConvert/config.json
const configPath = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    // Corrupt config — ignore and use defaults; we'll overwrite on next save.
  }
  return {};
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, configPath); // atomic on the same filesystem
}

// Default output folder if the user has never picked one. Goes into the
// system Downloads folder under a subfolder named after the app, so users
// can find their conversions without hunting for them.
const defaultOutputDir = path.join(app.getPath('downloads'), 'LocalConvert');

// Pick the initial output folder: persisted choice if it still exists and is
// writable; otherwise fall back to the default. We don't error on a missing
// persisted folder (drive ejected, user deleted it, etc.) — we silently fall
// back so the app still launches.
function resolveInitialOutputDir() {
  const cfg = readConfig();
  if (cfg.outputDir) {
    try {
      fs.mkdirSync(cfg.outputDir, { recursive: true });
      fs.accessSync(cfg.outputDir, fs.constants.W_OK);
      return cfg.outputDir;
    } catch (e) {
      // Persisted folder is unusable — fall through to default.
    }
  }
  return defaultOutputDir;
}

// The server reads this env var at startup, so we must set it BEFORE
// requiring server.js. setOutputDir() (exposed below via IPC) handles
// runtime changes after this.
process.env.LOCALCONVERT_OUTPUT_DIR = resolveInitialOutputDir();

const { startServer, getOutputDir, setOutputDir } = require('../server');

let mainWindow = null;
let serverInfo = null;

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Output',
      submenu: [
        {
          label: 'Open Output Folder',
          accelerator: 'CmdOrCtrl+O',
          // Read getOutputDir() at click-time so this always opens the
          // currently-active folder, not whatever was set at app launch.
          click: () => shell.openPath(getOutputDir()),
        },
        {
          label: 'Change Output Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => pickOutputFolder(),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Show the native folder picker, persist the choice, update the server.
// Returns the chosen path on success or null if the user cancelled / picked
// an unwritable location.
async function pickOutputFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: getOutputDir(),
  });
  if (result.canceled || !result.filePaths.length) return null;

  const chosen = result.filePaths[0];
  try {
    setOutputDir(chosen); // server validates writability and creates if needed
  } catch (e) {
    dialog.showErrorBox(
      'Cannot use that folder',
      `LocalConvert could not write to:\n${chosen}\n\n${e.message}`
    );
    return null;
  }

  writeConfig({ ...readConfig(), outputDir: chosen });

  // Tell the renderer so it can update the displayed path live.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('output-folder-changed', chosen);
  }

  return chosen;
}

// IPC handlers exposed via the preload script's contextBridge.
ipcMain.handle('get-output-folder', () => getOutputDir());
ipcMain.handle('select-output-folder', () => pickOutputFolder());

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 800,
    minWidth: 600,
    minHeight: 500,
    title: 'LocalConvert',
    backgroundColor: '#f5f5f7',
    webPreferences: {
      // The UI is fully local and trusted, but we still keep Node out of the
      // renderer and bridge only the IPC functions we want via preload.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverInfo.port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    serverInfo = await startServer(0); // 0 = OS-assigned free port
  } catch (err) {
    dialog.showErrorBox(
      'LocalConvert failed to start',
      `Could not start the local conversion server.\n\n${err.message}`
    );
    app.quit();
    return;
  }

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
