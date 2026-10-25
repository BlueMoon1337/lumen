const { contextBridge, ipcRenderer } = require('electron');

// Implements DesktopBridge from src/outputs.ts.
contextBridge.exposeInMainWorld('lumenDesktop', {
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  openOutput: (kind, displayId) => ipcRenderer.invoke('open-output', kind, displayId),
  closeOutput: (kind) => ipcRenderer.invoke('close-output', kind),
  onOutputsChanged: (cb) => {
    const listener = (_e, open) => cb(open);
    ipcRenderer.on('outputs-changed', listener);
    ipcRenderer.send('outputs-query');
    return () => ipcRenderer.removeListener('outputs-changed', listener);
  },
});
