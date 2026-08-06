const { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Mark ourselves to the embedded server so /api/config can tell the frontend
// it's running inside the desktop app (controls whether the "Change…" button
// appears next to the output folder).
process.env.LOCALPIX_ELECTRON = '1';

// Persisted settings live in the OS-standard userData folder:
//   macOS:   ~/Library/Application Support/LocalPix/config.json
//   Windows: %APPDATA%/LocalPix/config.json
// (Electron derives the folder name from package.json's productName.)
const configPath = path.join(app.getPath('userData'), 'config.json');

// One-time migration from the previous app name. The 'appData' base is the
// parent of userData, so we can construct the old LocalConvert path directly.
// We *copy* (not move) so users who downgrade still have their old config,
// and we only copy when the new path is empty — preserving any new edits.
(function migrateLegacyConfig() {
  if (fs.existsSync(configPath)) return;
  const legacyPath = path.join(app.getPath('appData'), 'LocalConvert', 'config.json');
  if (!fs.existsSync(legacyPath)) return;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.copyFileSync(legacyPath, configPath);
  } catch (e) {
    // Non-fatal — user will just see the default folder on first launch.
  }
})();

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
// system Documents folder under a subfolder named after the app — Documents
// is the more natural home for image outputs the user expects to keep, vs.
// Downloads which most people treat as a transient inbox.
const defaultOutputDir = path.join(app.getPath('documents'), 'LocalPix');

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
process.env.LOCALPIX_OUTPUT_DIR = resolveInitialOutputDir();

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
      `LocalPix could not write to:\n${chosen}\n\n${e.message}`
    );
    return null;
  }

  writeConfig({ ...readConfig(), outputDir: chosen });

  // Tell the renderer so it can update the displayed path live.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('localpix:output-folder-changed', chosen);
  }

  return chosen;
}

// IPC handlers exposed via the preload script's contextBridge. Channel names
// are prefixed with 'localpix:' so they don't collide with channels from
// other Electron apps if anything ever inspects them globally.
ipcMain.handle('localpix:get-output-folder',    () => getOutputDir());
ipcMain.handle('localpix:select-output-folder', () => pickOutputFolder());
ipcMain.handle('localpix:open-output-folder',   () => shell.openPath(getOutputDir()));

// Settings presets — stored in config.json next to outputDir. The renderer
// owns the shape ({ name: { target, opts, transforms } }); main just
// persists it. Guard the size so a runaway renderer can't bloat the file.
ipcMain.handle('localpix:get-presets', () => readConfig().presets || {});
ipcMain.handle('localpix:set-presets', (_event, presets) => {
  if (!presets || typeof presets !== 'object' || Array.isArray(presets)) {
    throw new Error('Presets must be an object.');
  }
  if (JSON.stringify(presets).length > 512 * 1024) {
    throw new Error('Presets payload too large.');
  }
  writeConfig({ ...readConfig(), presets });
  return true;
});

// macOS Dock icon — swap between light and dark variants when the system
// appearance changes. This only affects the live Dock icon; the Finder /
// Applications-folder icon is static (driven by Contents/Resources/icon.icns
// and not reachable from runtime code without an Asset Catalog build).
//
// We lazy-load the NativeImages on first use; loading is cheap and doing it
// upfront before app.whenReady would error.
const DOCK_ICON_LIGHT_PATH = path.join(__dirname, '..', 'build', 'icon.icns');
const DOCK_ICON_DARK_PATH = path.join(__dirname, '..', 'build', 'icon-dark.icns');
let _dockIconLight = null;
let _dockIconDark = null;

function applyDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (!_dockIconLight) _dockIconLight = nativeImage.createFromPath(DOCK_ICON_LIGHT_PATH);
  if (!_dockIconDark)  _dockIconDark  = nativeImage.createFromPath(DOCK_ICON_DARK_PATH);
  const icon = nativeTheme.shouldUseDarkColors ? _dockIconDark : _dockIconLight;
  if (icon && !icon.isEmpty()) app.dock.setIcon(icon);
}

nativeTheme.on('updated', applyDockIcon);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 800,
    minWidth: 600,
    minHeight: 500,
    title: 'LocalPix',
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

  // External links — e.g. the release page from the footer's "Check for
  // updates" — open in the system browser, never inside the app shell. Any
  // navigation away from the embedded server is likewise blocked/redirected.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverInfo.port}`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    serverInfo = await startServer(0); // 0 = OS-assigned free port
  } catch (err) {
    dialog.showErrorBox(
      'LocalPix failed to start',
      `Could not start the local conversion server.\n\n${err.message}`
    );
    app.quit();
    return;
  }

  buildMenu();
  createWindow();
  applyDockIcon();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
