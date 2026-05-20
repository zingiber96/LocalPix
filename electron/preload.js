// Bridges a small, deliberately narrow IPC surface into the renderer via
// contextBridge. The renderer detects we're inside the desktop app by
// checking `window.localconvert` — if it exists, native folder picking is
// available; otherwise (web/Docker mode) the "Change…" button stays hidden.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localconvert', {
  getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  // Subscribe to changes pushed by the main process (e.g. after the user
  // changes the folder via the menu rather than the in-window button).
  onOutputFolderChanged: (handler) => {
    const listener = (_event, value) => handler(value);
    ipcRenderer.on('output-folder-changed', listener);
    return () => ipcRenderer.removeListener('output-folder-changed', listener);
  },
});
