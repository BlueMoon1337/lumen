const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (cb) => {
  const listener = (_e, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Implements DesktopBridge from src/outputs.ts.
contextBridge.exposeInMainWorld('lumenDesktop', {
  platform: process.platform,
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  onDisplaysChanged: subscribe('displays-changed'),
  setOutputs: (outputs) => ipcRenderer.invoke('set-outputs', outputs),
  onOutputsChanged: (cb) => {
    const off = subscribe('outputs-changed')(cb);
    ipcRenderer.send('outputs-query');
    return off;
  },
  onMenu: subscribe('menu'),
  setMenuState: (state) => ipcRenderer.send('menu-state', state),
  setAppIcon: (id) => ipcRenderer.send('set-app-icon', id),
});
