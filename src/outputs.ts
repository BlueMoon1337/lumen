import { create } from 'zustand';
import { notify } from './notices';
import { activeOutputs, hostRoute, planHosts, type DetectedDisplay, type OutputHost } from './screens';
import { useStore } from './store';
import type { AppIconId, ScreenKind } from './types';

/** Lumen's media folders, in Documents ▸ Lumen. */
export type LumenFolder = 'Media/Assets' | 'Media/Audio' | `Libraries/${string}`;

/** An output window the desktop app should have open. */
export interface DesktopOutputRequest {
  key: string;
  /** App route after "#/", e.g. "screen?size=1920x1080&o=…". */
  route: string;
  title: string;
  /** Fullscreen on this display; unset opens a window on the operator's screen. */
  displayId?: number;
}

export interface ScreensMenuState {
  audienceEnabled: boolean;
  stageEnabled: boolean;
  looks: { id: string; name: string }[];
  liveLookId: string;
  liveLookName: string;
  capturing: boolean;
}

/** Lumen's desktop app (src-tauri), as connected in src/desktop.ts. */
export interface DesktopBridge {
  platform: string;
  getDisplays(): Promise<DetectedDisplay[]>;
  onDisplaysChanged(cb: (displays: DetectedDisplay[]) => void): () => void;
  setOutputs(outputs: DesktopOutputRequest[]): Promise<void>;
  onOutputsChanged(cb: (openHosts: string[]) => void): () => void;
  onMenu(cb: (command: string) => void): () => void;
  /** The Screens menu: its checkmarks, the looks under Live, and Start or Stop Capture. */
  setMenuState(state: ScreensMenuState): void;
  /** Opens a new capture file in a folder ("movies", "downloads"… or a path); its path. */
  captureOpen(folder: string, name: string): Promise<string>;
  /** Adds to the capture file. */
  captureWrite(data: Uint8Array): Promise<void>;
  captureClose(): Promise<void>;
  /** Asks for a folder for captures; its path, or null when cancelled. */
  chooseCaptureFolder(): Promise<string | null>;
  /** Names Edit ▸ Undo and Redo after the steps they'd take; null turns one off. */
  setUndoState(state: { undo: string | null; redo: string | null }): void;
  /** Dock (macOS), taskbar and window icons. */
  setAppIcon(id: AppIconId): void;
  /** Turns File ▸ Export's presentation items on or off. */
  setFileState(state: { presentation: boolean }): void;
  /** Shows the Save panel and writes the file; the path it went to, or null when cancelled. */
  saveFile(file: { name: string; data: Uint8Array; kind: string; extensions: string[] }): Promise<string | null>;
  /** Saves a copy of the Lumen app as a disk image (Mac) or zip; where it went, or null when cancelled. */
  exportApp?(format: 'dmg' | 'zip'): Promise<string | null>;
  /** Asks for a folder to export several files into; its path, or null when cancelled. */
  chooseExportFolder(): Promise<string | null>;
  /** Writes a file into the folder chosen last. */
  writeExportFile(name: string, data: Uint8Array): Promise<void>;
  /**
   * Media files in Documents ▸ Lumen ▸ Media ▸ Assets (or Audio): the name a file would get there
   * (its own, or numbered if a different file has it), and whether that file is there already.
   */
  finderFile(folder: LumenFolder, name: string, size: number): Promise<{ name: string; saved: boolean }>;
  writeFinderFile(folder: LumenFolder, name: string, data: Uint8Array): Promise<void>;
  revealFinderFile(folder: LumenFolder, name: string): Promise<void>;
  /** Makes Lumen's folders, and gives the path of Documents ▸ Lumen. */
  lumenFolder(): Promise<string>;
  lumenFileExists(folder: LumenFolder, name: string): Promise<boolean>;
  /** The media server's address on this computer: media files play from `<it>/<folder>/<name>`. */
  mediaServer(): Promise<string>;
  readLumenFile(folder: LumenFolder, name: string): Promise<ArrayBuffer>;
  removeLumenFile(folder: LumenFolder, name: string): Promise<void>;
  /** Opens a folder of Documents ▸ Lumen in Finder ("Libraries" for them all). */
  revealLumenFolder(folder: LumenFolder | 'Libraries'): Promise<void>;
  readClipboardText(): Promise<string | null>;
  writeClipboardText(text: string): Promise<void>;
  /** Turns Edit's items on and off (by command id) and sets Check Spelling While Typing. */
  setEditState(state: { enabled: string[]; spellCheck: boolean }): void;
  /** Lists the screens under Window ▸ New Windowed Output. */
  setWindowState(state: { screens: { id: string; name: string; kind: ScreenKind }[] }): void;
  /** Runs a Window menu command (Minimize, Fill, Move & Resize…) on the window in front. */
  runWindowCommand(id: string): Promise<void>;
  /** Lumen's version, as built. */
  appVersion(): Promise<string>;
  /** Updates: whether a GitHub token has been given, and keeping one (empty forgets it). */
  hasUpdateToken(): Promise<boolean>;
  setUpdateToken(token: string): Promise<void>;
  /** Looks for a newer release; null when Lumen is up to date. */
  checkUpdate(): Promise<{ version: string; current: string; notes: string | null; date: string | null } | null>;
  /** Downloads and installs the update found, then restarts Lumen. */
  installUpdate(): Promise<void>;
  onUpdateProgress(cb: (p: { received: number; total: number | null }) => void): () => void;
  /** Why updates can't install here: "translocated" when macOS runs Lumen from a read-only copy. */
  updateBlocker(): Promise<string | null>;
  /**
   * Has Keynote export a Keynote file's slides as pictures (Mac only; src-tauri/src/keynote.rs).
   * Read the `images` pictures (one per slide not skipped) with keynoteImage, then call keynoteDone.
   */
  keynoteExport?(
    name: string,
    data: Uint8Array,
  ): Promise<{
    id: string;
    width: number;
    height: number;
    images: number;
    /** Whether Keynote also exported it as PowerPoint, for editing (read it with keynotePptx). */
    pptx: boolean;
    slides: { text: string; notes: string; skipped: boolean }[];
  }>;
  keynoteImage(id: string, index: number): Promise<ArrayBuffer>;
  /** Settings ▸ Open at Login: whether Lumen starts when the operator logs in, and changing it. */
  openAtLogin(): Promise<boolean>;
  setOpenAtLogin(on: boolean): Promise<void>;
  keynotePptx(id: string): Promise<ArrayBuffer>;
  keynoteDone(id: string): Promise<void>;
  /** The View menu's checkmarks, and its editors on or off. */
  setViewState(state: { presentation: boolean; continuousPlaylist: boolean; slideView: string }): void;
  /** Turns the Presentation menu's items on and off, and lists the clear groups in Clear Groups. */
  setPresentationState(state: { enabled: string[]; clearGroups: { id: string; name: string }[] }): void;
  /** Shows the Open panel for files (or a folder, giving the files in it with those extensions). */
  openFiles(options: {
    extensions: string[];
    kind: string;
    multiple: boolean;
    folder: boolean;
  }): Promise<{ folder: string | null; files: File[] }>;
}

declare global {
  interface Window {
    lumenDesktop?: DesktopBridge;
  }
}

/** Window Management API (Chromium): lists screens, including ones on HDMI, so popups can be placed on them. */
interface ScreenDetailed {
  label: string;
  isPrimary: boolean;
  isInternal: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}
interface ScreenDetails extends EventTarget {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

export type ScreenAccess = 'desktop' | 'granted' | 'prompt' | 'denied' | 'unsupported';

interface DisplayState {
  displays: DetectedDisplay[];
  access: ScreenAccess;
  /** Keys of the output windows that are open (see hostKey). */
  openHosts: string[];
}

export const useDisplays = create<DisplayState>(() => ({ displays: [], access: 'unsupported', openHosts: [] }));

const desktop = () => window.lumenDesktop;

// ---- Display detection ------------------------------------------------------------

/** The only screen a browser without the Window Management API can tell us about: its own. */
function basicDisplays(): DetectedDisplay[] {
  return [
    {
      label: 'This screen',
      width: Math.round(screen.width * devicePixelRatio),
      height: Math.round(screen.height * devicePixelRatio),
      primary: true,
      current: true,
      left: 0,
      top: 0,
      scale: devicePixelRatio,
    },
  ];
}

function fromScreenDetails(details: ScreenDetails): DetectedDisplay[] {
  const counts = new Map<string, number>();
  return details.screens.map((s, i) => {
    // Screens without a name, or with the same name, still need telling apart.
    let label = s.label || (s.isInternal ? 'Built-in Display' : `Display ${i + 1}`);
    const n = (counts.get(label) ?? 0) + 1;
    counts.set(label, n);
    if (n > 1) label = `${label} (${n})`;
    return {
      label,
      width: Math.round(s.width * s.devicePixelRatio),
      height: Math.round(s.height * s.devicePixelRatio),
      internal: s.isInternal,
      primary: s.isPrimary,
      current: s === details.currentScreen,
      left: s.left,
      top: s.top,
      scale: s.devicePixelRatio,
    };
  });
}

let screenDetails: ScreenDetails | null = null;

function setDisplays(next: DetectedDisplay[]) {
  const before = useDisplays.getState().displays;
  useDisplays.setState({ displays: next });
  if (!before.length) return;
  // Say when a TV or projector is plugged in or unplugged.
  const names = (list: DetectedDisplay[]) => new Set(list.map((d) => d.label));
  const was = names(before);
  const now = names(next);
  for (const d of next) if (!was.has(d.label)) notify(`${d.label} connected.`, 'success');
  for (const d of before) if (!now.has(d.label)) notify(`${d.label} disconnected. Outputs on it come back when it is reconnected.`, 'info');
}

async function watchScreenDetails() {
  const w = window as WindowWithScreens;
  if (!w.getScreenDetails) return;
  screenDetails = await w.getScreenDetails();
  // The first real list replaces the "This screen" placeholder: nothing was plugged in or out.
  useDisplays.setState({ access: 'granted', displays: fromScreenDetails(screenDetails) });
  const refresh = () => screenDetails && setDisplays(fromScreenDetails(screenDetails));
  screenDetails.addEventListener('screenschange', refresh);
  screenDetails.addEventListener('currentscreenchange', refresh);
}

/** Asks the browser for permission to see connected screens (HDMI, DisplayPort, AirPlay…). */
export async function requestScreenAccess() {
  try {
    await watchScreenDetails();
  } catch {
    useDisplays.setState({ access: 'denied' });
    notify('The browser did not allow access to your screens. You can allow it from the site settings next to the address bar.', 'error');
  }
}

// ---- Output windows --------------------------------------------------------------------

/** One window per display (holding every output on it), or per output that has no display. */
function desired(): { host: OutputHost; route: string; title: string }[] {
  const hosts = planHosts(activeOutputs(useStore.getState().screens, useDisplays.getState().displays));
  // Output windows are silent: the live video's sound plays from the control window (MediaClock).
  return hosts.map((host) => ({
    host,
    route: hostRoute(host),
    title: `Lumen · ${[...new Set(host.outputs.map((p) => p.screen.name))].join(' + ')}`,
  }));
}

/**
 * Window ▸ New Windowed Output: extra windows that show a screen, whether or not that kind of
 * screen is on, until they're closed. A window you can move, resize or capture.
 */
export const useWindowedOutputs = create<{ windows: { key: string; screenId: string }[] }>(() => ({ windows: [] }));
let windowedSeq = 0;

/** The route a windowed output shows: the screen's (first) output, filling the window. */
export const windowedRoute = (screenId: string) => `screen?screen=${encodeURIComponent(screenId)}`;

export function openWindowedOutput(screenId: string) {
  const screen = useStore.getState().screens.screens.find((sc) => sc.id === screenId);
  if (!screen) return;
  const key = `windowed-${++windowedSeq}`;
  if (desktop()) useWindowedOutputs.setState((w) => ({ windows: [...w.windows, { key, screenId }] }));
  else {
    const win = window.open(
      `${location.pathname}${location.search}#/${windowedRoute(screenId)}`,
      `lumen-${key}`,
      'popup,width=960,height=540',
    );
    if (!win) notify('The browser blocked the window. Allow pop-ups for Lumen, then try again.', 'error');
  }
}

function desktopRequests(): DesktopOutputRequest[] {
  const screens = useStore.getState().screens.screens;
  const windowed = useWindowedOutputs.getState().windows.flatMap(({ key, screenId }) => {
    const screen = screens.find((sc) => sc.id === screenId);
    return screen ? [{ key, route: windowedRoute(screenId), title: `${screen.name} — Lumen` }] : [];
  });
  return [...desired().map(({ host, route, title }) => ({ key: host.key, route, title, displayId: host.display?.id })), ...windowed];
}

/** Open browser output windows, with the placement and address each was opened with, and the kinds of screen they show. */
const browserWindows = new Map<string, { win: Window; placement: string; route: string; kinds: ScreenKind[] }>();

/**
 * Opens and closes browser windows to match the setup. Opening must happen
 * during a click (or similar), because browsers block windows opened at any
 * other time; with `open` false it only closes and re-points windows, which
 * works any time, e.g. when a screen is unplugged.
 */
export function syncBrowserWindows(open = true): number {
  const wanted = desired();
  let blocked = 0;
  for (const [key, entry] of browserWindows) {
    if (!wanted.some((w) => w.host.key === key)) {
      entry.win.close();
      browserWindows.delete(key);
    }
  }
  const granted = useDisplays.getState().access === 'granted';
  for (const { host, route } of wanted) {
    const kinds = [...new Set(host.outputs.map((p) => p.kind))];
    const d = host.display;
    const scale = d?.scale ?? 1;
    // With screen access, Chromium can open the popup fullscreen on the chosen display (sizes in desktop units).
    const features = d
      ? `popup,left=${d.left ?? 0},top=${d.top ?? 0},width=${Math.round(d.width / scale)},height=${Math.round(d.height / scale)}${granted ? ',fullscreen' : ''}`
      : 'popup,width=960,height=540';
    const existing = browserWindows.get(host.key);
    if (existing && !existing.win.closed) {
      if (existing.placement === features) {
        // Same display, different outputs on it: re-point the window instead of reopening it.
        if (existing.route !== route) {
          existing.win.location.hash = `#/${route}`;
          existing.route = route;
        }
        existing.kinds = kinds;
        continue;
      }
      // Moved to another screen: reopen it there (on the next click, if this isn't one).
      existing.win.close();
      browserWindows.delete(host.key);
    }
    if (!open) continue;
    const win = window.open(`${location.pathname}${location.search}#/${route}`, `lumen-${host.key}`, features);
    if (win) browserWindows.set(host.key, { win, placement: features, route, kinds });
    else {
      browserWindows.delete(host.key);
      blocked++;
    }
  }
  publishOpenHosts();
  if (blocked)
    notify(`The browser blocked ${blocked} output window${blocked === 1 ? '' : 's'}. Allow pop-ups for Lumen, then try again.`, 'error');
  return blocked;
}

function publishOpenHosts() {
  const openHosts = [...browserWindows].filter(([, e]) => !e.win.closed).map(([key]) => key);
  const prev = useDisplays.getState().openHosts;
  if (prev.length !== openHosts.length || prev.some((k, i) => k !== openHosts[i])) useDisplays.setState({ openHosts });
}

/** Notices windows the operator closed. Closing every window of a kind by hand switches that kind off. */
function pollBrowserWindows() {
  const closedKinds = new Set<ScreenKind>();
  for (const [key, entry] of browserWindows) {
    if (!entry.win.closed) continue;
    browserWindows.delete(key);
    entry.kinds.forEach((k) => closedKinds.add(k));
  }
  publishOpenHosts();
  const st = useStore.getState();
  for (const kind of closedKinds) {
    const enabled = kind === 'audience' ? st.screens.audienceEnabled : st.screens.stageEnabled;
    if (enabled && ![...browserWindows.values()].some((e) => e.kinds.includes(kind))) st.setScreensEnabled(kind, false);
  }
}

/** Turns all audience or all stage screens on or off (the toolbar buttons and the switches in Screen Configuration). */
export function setScreensEnabled(kind: ScreenKind, enabled: boolean) {
  useStore.getState().setScreensEnabled(kind, enabled);
  if (!desktop()) syncBrowserWindows();
}

/** Starts display detection and output management for the operator window. Returns a cleanup. */
export function startScreenManager(): () => void {
  const cleanups: (() => void)[] = [];
  const bridge = desktop();

  if (bridge) {
    useDisplays.setState({ access: 'desktop' });
    void bridge.getDisplays().then((d) => useDisplays.setState({ displays: d }));
    cleanups.push(bridge.onDisplaysChanged(setDisplays));
    // A windowed output closed by hand is gone for good (one that hasn't opened yet isn't).
    const seen = new Set<string>();
    cleanups.push(
      bridge.onOutputsChanged((openHosts) => {
        useDisplays.setState({ openHosts });
        const { windows } = useWindowedOutputs.getState();
        openHosts.forEach((key) => seen.add(key));
        const closed = windows.filter((w) => seen.has(w.key) && !openHosts.includes(w.key));
        if (closed.length) useWindowedOutputs.setState({ windows: windows.filter((w) => !closed.includes(w)) });
      }),
    );
    // Outputs follow the setup and the connected displays, so screens come up as soon as an HDMI cable goes in.
    let lastPlan = '';
    const sync = () => {
      const requests = desktopRequests();
      const plan = JSON.stringify(requests);
      if (plan !== lastPlan) {
        lastPlan = plan;
        void bridge.setOutputs(requests);
      }
    };
    sync();
    cleanups.push(useStore.subscribe(sync));
    cleanups.push(useDisplays.subscribe(sync));
    cleanups.push(useWindowedOutputs.subscribe(sync));
  } else {
    // A browser can't reopen windows by itself, so screens start switched off after a reload.
    const s = useStore.getState();
    if (s.screens.audienceEnabled) s.setScreensEnabled('audience', false);
    if (s.screens.stageEnabled) s.setScreensEnabled('stage', false);
    useDisplays.setState({ displays: basicDisplays(), access: (window as WindowWithScreens).getScreenDetails ? 'prompt' : 'unsupported' });
    // If permission was granted before, list the screens right away without asking again.
    void navigator.permissions
      ?.query({ name: 'window-management' as PermissionName })
      .then((status) => {
        if (status.state === 'granted') void watchScreenDetails().catch(() => {});
        else if (status.state === 'denied') useDisplays.setState({ access: 'denied' });
      })
      .catch(() => {});
    const timer = setInterval(pollBrowserWindows, 700);
    // Windows close and re-point by themselves when screens or the setup change; opening needs a click.
    cleanups.push(useDisplays.subscribe((now, before) => now.displays !== before.displays && syncBrowserWindows(false)));
    cleanups.push(useStore.subscribe((now, before) => now.screens !== before.screens && syncBrowserWindows(false)));
    const closeAll = () => browserWindows.forEach((entry) => entry.win.close());
    window.addEventListener('beforeunload', closeAll);
    cleanups.push(() => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', closeAll);
    });
  }
  return () => cleanups.forEach((c) => c());
}
