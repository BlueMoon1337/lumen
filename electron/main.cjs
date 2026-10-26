// Desktop shell: hosts the operator window and keeps one window per screen
// output, fullscreen on its display. Displays are watched so outputs come up
// as soon as a TV or projector is connected (HDMI, DisplayPort, USB-C…) and
// return when it's reconnected. All windows load the same app from one origin
// so BroadcastChannel and IndexedDB are shared between them.

const { app, BrowserWindow, ipcMain, Menu, net, protocol, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';
const DEV_URL = 'http://localhost:5173/';
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/** Output windows by key ("screenId:outputId"). */
const outputs = new Map();
let control = null;
let menuState = { audienceEnabled: false, stageEnabled: false, identify: false };

function appUrl(route = '') {
  return `${isDev ? DEV_URL : 'app://lumen/index.html'}${route ? `#/${route}` : ''}`;
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
};

// ---- Displays ---------------------------------------------------------------

function displayList() {
  const primary = screen.getPrimaryDisplay();
  const current = control && !control.isDestroyed() ? screen.getDisplayMatching(control.getBounds()) : primary;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    // The name the display reports over HDMI/DisplayPort (EDID), e.g. "E65-E0".
    label: d.label || (d.internal ? 'Built-in Display' : `Display ${i + 1}`),
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    internal: !!d.internal,
    primary: d.id === primary.id,
    current: d.id === current.id,
    refresh: d.displayFrequency || undefined,
    left: d.bounds.x,
    top: d.bounds.y,
  }));
}

function sendDisplays() {
  control?.webContents.send('displays-changed', displayList());
}

function sendOutputs() {
  control?.webContents.send('outputs-changed', [...outputs.keys()]);
}

// ---- Output windows ---------------------------------------------------------

function placeOnDisplay(win, display) {
  win.setBounds(display.bounds);
  if (isMac) win.setSimpleFullScreen(true);
  else win.setFullScreen(true);
}

function createOutput(request, display) {
  const external = display && display.id !== (control ? screen.getDisplayMatching(control.getBounds()).id : undefined);
  const base = display ? display.bounds : screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    x: external ? base.x : base.x + 80,
    y: external ? base.y : base.y + 80,
    width: external ? base.width : 960,
    height: external ? base.height : 540,
    frame: !external,
    backgroundColor: '#000000',
    title: request.title,
    webPreferences,
  });
  win.lumenDisplayId = display ? display.id : null;
  win.setMenuBarVisibility(false);
  win.loadURL(appUrl(request.route));
  // Outputs on another display fill it; one on the operator's screen stays a window, so it can't cover the controls.
  if (external) placeOnDisplay(win, display);
  win.on('closed', () => {
    if (outputs.get(request.key) === win) outputs.delete(request.key);
    sendOutputs();
  });
  outputs.set(request.key, win);
}

/** Opens, moves and closes output windows to match what the operator window asks for. */
function setOutputs(requests) {
  const wanted = new Set(requests.map((r) => r.key));
  for (const [key, win] of outputs) {
    if (!wanted.has(key)) {
      outputs.delete(key);
      win.close();
    }
  }
  const displays = screen.getAllDisplays();
  for (const request of requests) {
    const display = request.displayId != null ? displays.find((d) => d.id === request.displayId) : undefined;
    const existing = outputs.get(request.key);
    if (existing && !existing.isDestroyed()) {
      if (existing.lumenDisplayId === (display ? display.id : null)) {
        existing.setTitle(request.title);
        continue;
      }
      outputs.delete(request.key);
      existing.close();
    }
    createOutput(request, display);
  }
  sendOutputs();
}

// ---- Operator window and menu -----------------------------------------------

function sendMenu(command) {
  control?.webContents.send('menu', command);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Screens',
      submenu: [
        { label: 'Audience', enabled: false },
        {
          label: 'Enabled',
          type: 'checkbox',
          checked: menuState.audienceEnabled,
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenu('toggle-audience'),
        },
        { type: 'separator' },
        { label: 'Stage', enabled: false },
        {
          label: 'Enabled',
          type: 'checkbox',
          checked: menuState.stageEnabled,
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenu('toggle-stage'),
        },
        { type: 'separator' },
        { label: 'Configure Screens…', accelerator: 'Alt+CmdOrCtrl+1', click: () => sendMenu('configure-screens') },
        { label: 'Identify Screens', type: 'checkbox', checked: menuState.identify, click: () => sendMenu('identify-screens') },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createControlWindow() {
  control = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1d1d1d',
    title: 'Lumen',
    // macOS: traffic lights sit inside the toolbar, as in ProPresenter.
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences,
  });
  control.loadURL(appUrl());
  // Which display counts as "the operator's" follows the window.
  control.on('moved', sendDisplays);
  control.on('closed', () => {
    control = null;
    for (const win of outputs.values()) win.close();
    outputs.clear();
  });
}

ipcMain.handle('get-displays', () => displayList());
ipcMain.handle('set-outputs', (_e, requests) => setOutputs(requests));
ipcMain.on('outputs-query', sendOutputs);
ipcMain.on('menu-state', (_e, state) => {
  menuState = state;
  buildMenu();
});

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  buildMenu();
  createControlWindow();
  // Plugging in or unplugging a display (or changing its resolution) updates the operator window, which re-plans outputs.
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, sendDisplays);
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createControlWindow());
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
