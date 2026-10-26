import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DetectedDisplay } from './screens';
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
    setAppIcon: (id) => void invoke('set_app_icon', { id }),
  };
}
