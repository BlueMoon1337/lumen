import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DetectedDisplay } from './screens';
import { mimeFromName } from './store';
import type { DesktopOutputRequest } from './outputs';

/** Subscribes to an event from the desktop app; the returned function unsubscribes, even before listening has started. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | undefined;
  let stopped = false;
  void listen<T>(event, (e) => cb(e.payload)).then((unlisten) => {
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

/**
 * In Lumen's desktop app (src-tauri), connects the shared code to it through
 * `window.lumenDesktop`. In a browser this does nothing.
 */
export function installDesktopBridge() {
  if (!isTauri() || window.lumenDesktop) return;
  repaintOnWindowChanges();
  const ua = navigator.userAgent;
  window.lumenDesktop = {
    platform: /Mac/.test(ua) ? 'darwin' : /Windows/.test(ua) ? 'win32' : 'linux',
    getDisplays: () => invoke<DetectedDisplay[]>('get_displays'),
    onDisplaysChanged: (cb) => subscribe('displays-changed', cb),
    setOutputs: (outputs: DesktopOutputRequest[]) => invoke('set_outputs', { outputs }),
    onOutputsChanged: (cb) => {
      const stop = subscribe('outputs-changed', cb);
      void invoke<string[]>('open_outputs').then(cb);
      return stop;
    },
    onMenu: (cb) => subscribe('menu', cb),
    setMenuState: (state) => void invoke('set_menu_state', { state }),
    setUndoState: (state) => void invoke('set_undo_state', { state }),
    captureOpen: (folder, name) => invoke<string>('capture_open', { folder, name }),
    captureWrite: (data) => invoke('capture_write', data),
    captureClose: () => invoke('capture_close'),
    chooseCaptureFolder: () => invoke<string | null>('choose_capture_folder'),
    setAppIcon: (id) => void invoke('set_app_icon', { id }),
    setFileState: (state) => void invoke('set_file_state', { state }),
    // File contents go as the raw request body; names in headers, encoded so any name survives.
    saveFile: ({ name, data, kind, extensions }) =>
      invoke<string | null>('save_file', data, {
        headers: {
          'x-file-name': encodeURIComponent(name),
          'x-file-kind': encodeURIComponent(kind),
          'x-file-extensions': encodeURIComponent(extensions.join(',')),
        },
      }),
    chooseExportFolder: () => invoke<string | null>('choose_export_folder'),
    writeExportFile: (name, data) => invoke('write_export_file', data, { headers: { 'x-file-name': encodeURIComponent(name) } }),
    finderFile: (folder, name, size) => invoke('finder_file', { folder, name, size }),
    writeFinderFile: (folder, name, data) =>
      invoke('write_finder_file', data, { headers: { 'x-file-name': encodeURIComponent(name), 'x-folder': encodeURIComponent(folder) } }),
    revealFinderFile: (folder, name) => invoke('reveal_finder_file', { folder, name }),
    lumenFolder: () => invoke<string>('lumen_folder'),
    lumenFileExists: (folder, name) => invoke<boolean>('lumen_file_exists', { folder, name }),
    readLumenFile: (folder, name) => invoke<ArrayBuffer>('read_lumen_file', { folder, name }),
    removeLumenFile: (folder, name) => invoke('remove_lumen_file', { folder, name }),
    revealLumenFolder: (folder) => invoke('reveal_lumen_folder', { folder }),
    readClipboardText: () => invoke<string | null>('read_clipboard_text'),
    writeClipboardText: (text) => invoke('write_clipboard_text', { text }),
    setEditState: (state) => void invoke('set_edit_state', { state }),
    setPresentationState: (state) => void invoke('set_presentation_state', { state }),
    setViewState: (state) => void invoke('set_view_state', { state }),
    setWindowState: (state) => void invoke('set_window_state', { state }),
    runWindowCommand: (id) => invoke('run_window_command', { id }),
    appVersion: () => invoke<string>('app_version'),
    hasUpdateToken: () => invoke<boolean>('has_update_token'),
    setUpdateToken: (token) => invoke('set_update_token', { token }),
    checkUpdate: () => invoke('check_update'),
    installUpdate: () => invoke('install_update'),
    onUpdateProgress: (cb) => subscribe('update-progress', cb),
    updateBlocker: () => invoke<string | null>('update_blocker'),
    ...(/Mac/.test(ua)
      ? {
          keynoteExport: (name: string, data: Uint8Array) =>
            invoke('keynote_export', data, { headers: { 'x-file-name': encodeURIComponent(name) } }),
        }
      : {}),
    keynoteImage: (id, index) => invoke<ArrayBuffer>('keynote_image', { id, index }),
    keynotePptx: (id) => invoke<ArrayBuffer>('keynote_pptx', { id }),
    keynoteDone: (id) => invoke('keynote_done', { id }),
    openAtLogin: () => invoke<boolean>('open_at_login'),
    setOpenAtLogin: (on) => invoke('set_open_at_login', { on }),
    openFiles: async (options) => {
      const opened = await invoke<{ folder: string | null; files: { name: string; path: string }[] }>('open_files', { options });
      const files = await Promise.all(
        opened.files.map(
          async (f) => new File([await invoke<ArrayBuffer>('read_opened_file', { path: f.path })], f.name, { type: mimeFromName(f.name) }),
        ),
      );
      return { folder: opened.folder, files };
    },
  };
}

/**
 * Redraws the whole window after it's moved, resized, put in or out of full screen, moved to
 * another screen, or brought back to the front. The Mac web view (with the title bar laid over
 * the window) sometimes leaves the old picture behind after those, so parts of the window show
 * twice, one copy a little below the other. Promoting the page to its own layer for a frame makes
 * it draw everything again.
 */
function repaintOnWindowChanges() {
  let timer = 0;
  const repaint = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const root = document.documentElement;
      root.classList.add('repaint');
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('repaint')));
    }, 120);
  };
  const win = getCurrentWindow();
  void win.onResized(repaint);
  void win.onMoved(repaint);
  void win.onScaleChanged(repaint);
  void win.onFocusChanged(({ payload: focused }) => focused && repaint());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && repaint());
}
