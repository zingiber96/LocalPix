const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

// Converted files go to a writable, discoverable location — the packaged
// .app bundle is read-only, so we cannot use the project ./output folder.
const outputDir = path.join(app.getPath('downloads'), 'WebP Converter');
process.env.WEBP_OUTPUT_DIR = outputDir;

// Require the server AFTER setting the env var so it picks up the path.
const { startServer } = require('../server');

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
          click: () => shell.openPath(outputDir),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 800,
    minWidth: 600,
    minHeight: 500,
    title: 'WebP Converter',
    backgroundColor: '#f5f5f7',
    webPreferences: {
      // The UI is fully local and trusted; no Node access in the renderer.
      nodeIntegration: false,
      contextIsolation: true,
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
      'WebP Converter failed to start',
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
