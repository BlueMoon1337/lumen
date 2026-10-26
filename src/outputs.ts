import { create } from 'zustand';
import { notify } from './notices';
import { activeOutputs, outputRoute, type DetectedDisplay, type PlannedOutput } from './screens';
import { useStore } from './store';
import type { ScreenKind } from './types';

/** An output window the desktop app should have open. */
export interface DesktopOutputRequest {
  key: string;
  /** App route after "#/", e.g. "output?screen=…&output=…". */
  route: string;
  title: string;
  /** Fullscreen on this display; unset opens a window on the operator's screen. */
  displayId?: number;
}

/** Exposed by electron/preload.cjs when running as a desktop app. */
export interface DesktopBridge {
  platform: string;
  getDisplays(): Promise<DetectedDisplay[]>;
  onDisplaysChanged(cb: (displays: DetectedDisplay[]) => void): () => void;
  setOutputs(outputs: DesktopOutputRequest[]): Promise<void>;
  onOutputsChanged(cb: (openKeys: string[]) => void): () => void;
  onMenu(cb: (command: string) => void): () => void;
  setMenuState(state: { audienceEnabled: boolean; stageEnabled: boolean; identify: boolean }): void;
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
  /** Keys of output windows that are open. */
  openKeys: string[];
}

export const useDisplays = create<DisplayState>(() => ({ displays: [], access: 'unsupported', openKeys: [] }));

const desktop = () => window.lumenDesktop;

// ---- Display detection ------------------------------------------------------------

/** The only screen a browser without the Window Management API can tell us about: its own. */
function basicDisplays(): DetectedDisplay[] {
  return [
    { label: 'This screen', width: screen.width, height: screen.height, internal: false, primary: true, current: true, left: 0, top: 0 },
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

/** Open browser output windows, with the placement each was opened for. */
const browserWindows = new Map<string, { win: Window; placement: string }>();

const titleFor = (p: PlannedOutput) => `Lumen · ${p.screen.name}${p.screen.outputs.length > 1 ? ` (${p.index + 1})` : ''}`;

function desired(): PlannedOutput[] {
  return activeOutputs(useStore.getState().screens, useDisplays.getState().displays);
}

function syncDesktop() {
  const requests: DesktopOutputRequest[] = desired().map((p) => ({
    key: p.key,
    route: outputRoute(p),
    title: titleFor(p),
    displayId: p.status === 'display' ? p.display?.id : undefined,
  }));
  void desktop()?.setOutputs(requests);
}

/**
 * Opens and closes browser windows to match the setup. Must run during a click
 * (or similar), because browsers block windows opened at any other time.
 */
export function syncBrowserWindows(): number {
  const wanted = desired();
  let blocked = 0;
  for (const [key, entry] of browserWindows) {
    if (!wanted.some((p) => p.key === key)) {
      entry.win.close();
      browserWindows.delete(key);
    }
  }
  const granted = useDisplays.getState().access === 'granted';
  for (const p of wanted) {
    const d = p.status === 'display' ? p.display : undefined;
    // With screen access, Chromium can open the popup fullscreen on the chosen display.
    const features = d
      ? `popup,left=${d.left ?? 0},top=${d.top ?? 0},width=${Math.round(d.width)},height=${Math.round(d.height)}${granted ? ',fullscreen' : ''}`
      : 'popup,width=960,height=540';
    const existing = browserWindows.get(p.key);
    if (existing && !existing.win.closed) {
      if (existing.placement === features) continue;
      // Moved to another screen: reopen it there.
      existing.win.close();
    }
    const win = window.open(`${location.pathname}${location.search}#/${outputRoute(p)}`, `lumen-${p.key}`, features);
    if (win) browserWindows.set(p.key, { win, placement: features });
    else {
      browserWindows.delete(p.key);
      blocked++;
    }
  }
  pollBrowserWindows();
  if (blocked)
    notify(`The browser blocked ${blocked} output window${blocked === 1 ? '' : 's'}. Allow pop-ups for Lumen, then try again.`, 'error');
  return blocked;
}

function pollBrowserWindows() {
  for (const [key, entry] of browserWindows) if (entry.win.closed) browserWindows.delete(key);
  const openKeys = [...browserWindows.keys()];
  const prev = useDisplays.getState().openKeys;
  if (prev.length !== openKeys.length || prev.some((k, i) => k !== openKeys[i])) useDisplays.setState({ openKeys });
}

/** Turns all audience or all stage screens on or off (the toolbar buttons and the switches in Screen Configuration). */
export function setScreensEnabled(kind: ScreenKind, enabled: boolean) {
  useStore.getState().setScreensEnabled(kind, enabled);
  if (!desktop()) syncBrowserWindows();
}

/** Re-applies the setup after it changes (desktop: windows follow automatically). */
export function applyScreenSetup() {
  if (desktop()) syncDesktop();
  else syncBrowserWindows();
}

/** Starts display detection and output management for the operator window. Returns a cleanup. */
export function startScreenManager(): () => void {
  const cleanups: (() => void)[] = [];
  const bridge = desktop();

  if (bridge) {
    useDisplays.setState({ access: 'desktop' });
    void bridge.getDisplays().then((d) => useDisplays.setState({ displays: d }));
    cleanups.push(bridge.onDisplaysChanged(setDisplays));
    cleanups.push(bridge.onOutputsChanged((openKeys) => useDisplays.setState({ openKeys })));
    // Outputs follow the setup and the connected displays, so screens come up as soon as an HDMI cable goes in.
    let lastPlan = '';
    let lastMenu = '';
    const sync = () => {
      const plan = JSON.stringify(desired().map((p) => [p.key, p.status === 'display' ? p.display?.id : null, titleFor(p)]));
      if (plan !== lastPlan) {
        lastPlan = plan;
        syncDesktop();
      }
      const s = useStore.getState();
      const menu = { audienceEnabled: s.screens.audienceEnabled, stageEnabled: s.screens.stageEnabled, identify: s.screenTools.identify };
      if (JSON.stringify(menu) !== lastMenu) {
        lastMenu = JSON.stringify(menu);
        bridge.setMenuState(menu);
      }
    };
    sync();
    cleanups.push(useStore.subscribe(sync));
    cleanups.push(useDisplays.subscribe(sync));
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
    const timer = setInterval(() => {
      pollBrowserWindows();
      // Closing every window of a kind by hand switches that kind off.
      const st = useStore.getState();
      const open = useDisplays.getState().openKeys;
      for (const kind of ['audience', 'stage'] as const) {
        const enabled = kind === 'audience' ? st.screens.audienceEnabled : st.screens.stageEnabled;
        const keys = desired()
          .filter((p) => p.kind === kind)
          .map((p) => p.key);
        if (enabled && keys.length && !keys.some((k) => open.includes(k))) st.setScreensEnabled(kind, false);
      }
    }, 700);
    const closeAll = () => browserWindows.forEach((entry) => entry.win.close());
    window.addEventListener('beforeunload', closeAll);
    cleanups.push(() => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', closeAll);
    });
  }
  return () => cleanups.forEach((c) => c());
}
