// Desktop shell: hosts the operator window and opens the audience and stage
// outputs fullscreen on the chosen displays. All windows load the same app
// from one origin so BroadcastChannel and IndexedDB are shared between them.

const { app, BrowserWindow, ipcMain, net, protocol, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173/';
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const routes = { audience: 'output', stage: 'stage' };
const outputs = {};
let control = null;

function appUrl(hash = '') {
  return `${isDev ? DEV_URL : 'app://lumen/index.html'}${hash ? `#/${hash}` : ''}`;
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
};

function notifyOutputs() {
  const open = { audience: !!outputs.audience, stage: !!outputs.stage };
  control?.webContents.send('outputs-changed', open);
}

function pickDisplay(kind, displayId) {
  const displays = screen.getAllDisplays();
  const chosen = displays.find((d) => d.id === displayId);
  if (chosen) return chosen;
  // Default: audience on the first non-primary display, stage on the next one.
  const primary = screen.getPrimaryDisplay();
  const others = displays.filter((d) => d.id !== primary.id);
  return (kind === 'stage' ? (others[1] ?? others[0]) : others[0]) ?? primary;
}

function openOutput(kind, displayId) {
  if (outputs[kind]) {
    outputs[kind].focus();
    return;
  }
  const display = pickDisplay(kind, displayId);
  const isPrimary = display.id === screen.getPrimaryDisplay().id;
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x: isPrimary ? x + 80 : x,
    y: isPrimary ? y + 80 : y,
    width: isPrimary ? Math.round(width / 2) : width,
    height: isPrimary ? Math.round(height / 2) : height,
    // Only take over the whole screen when it is not the operator's screen.
    fullscreen: !isPrimary,
    frame: isPrimary,
    backgroundColor: '#000000',
    title: kind === 'audience' ? 'Lumen · Audience' : 'Lumen · Stage',
    webPreferences,
  });
  win.setMenuBarVisibility(false);
  win.loadURL(appUrl(routes[kind]));
  win.on('closed', () => {
    delete outputs[kind];
    notifyOutputs();
  });
  outputs[kind] = win;
  notifyOutputs();
}

function createControlWindow() {
  control = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0e0f12',
    title: 'Lumen',
    webPreferences,
  });
  control.loadURL(appUrl());
  control.on('closed', () => {
    control = null;
    for (const win of Object.values(outputs)) win.close();
  });
}

ipcMain.handle('get-displays', () => {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1} (${d.size.width}×${d.size.height})`,
    primary: d.id === primary.id,
  }));
});
ipcMain.handle('open-output', (_e, kind, displayId) => openOutput(kind, displayId));
ipcMain.handle('close-output', (_e, kind) => outputs[kind]?.close());
ipcMain.on('outputs-query', notifyOutputs);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createControlWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createControlWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
