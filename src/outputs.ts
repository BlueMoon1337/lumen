import { useEffect, useState } from 'react';

export type OutputKind = 'audience' | 'stage';

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
}

/** Exposed by electron/preload.cjs when running as a desktop app. */
export interface DesktopBridge {
  platform: string;
  getDisplays(): Promise<DisplayInfo[]>;
  openOutput(kind: OutputKind, displayId?: number): Promise<void>;
  closeOutput(kind: OutputKind): Promise<void>;
  onOutputsChanged(cb: (open: Record<OutputKind, boolean>) => void): () => void;
}

declare global {
  interface Window {
    lumenDesktop?: DesktopBridge;
  }
}

const routes: Record<OutputKind, string> = { audience: 'output', stage: 'stage' };
const browserWindows: Partial<Record<OutputKind, Window>> = {};

/** Window Management API (Chromium); lets a popup open on another screen. */
interface ScreenDetailed {
  isPrimary: boolean;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

async function otherScreen(): Promise<ScreenDetailed | null> {
  const w = window as Window & { getScreenDetails?: () => Promise<{ screens: ScreenDetailed[]; currentScreen: ScreenDetailed }> };
  if (!w.getScreenDetails) return null;
  try {
    const { screens, currentScreen } = await w.getScreenDetails();
    return screens.find((s) => s !== currentScreen) ?? null;
  } catch {
    return null;
  }
}

export async function openOutput(kind: OutputKind, displayId?: number) {
  if (window.lumenDesktop) return window.lumenDesktop.openOutput(kind, displayId);
  const existing = browserWindows[kind];
  if (existing && !existing.closed) return existing.focus();
  const url = `${location.pathname}${location.search}#/${routes[kind]}`;
  const screen = await otherScreen();
  const features = screen
    ? `popup,left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
    : 'popup,width=960,height=540';
  const win = window.open(url, `lumen-${kind}`, features);
  if (win) browserWindows[kind] = win;
}

export async function closeOutput(kind: OutputKind) {
  if (window.lumenDesktop) return window.lumenDesktop.closeOutput(kind);
  browserWindows[kind]?.close();
  delete browserWindows[kind];
}

export function useOpenOutputs(): Record<OutputKind, boolean> {
  const [open, setOpen] = useState<Record<OutputKind, boolean>>({ audience: false, stage: false });
  useEffect(() => {
    if (window.lumenDesktop) return window.lumenDesktop.onOutputsChanged(setOpen);
    const poll = () => {
      const next = {
        audience: !!browserWindows.audience && !browserWindows.audience.closed,
        stage: !!browserWindows.stage && !browserWindows.stage.closed,
      };
      setOpen((prev) => (prev.audience === next.audience && prev.stage === next.stage ? prev : next));
    };
    const closeAll = () => {
      browserWindows.audience?.close();
      browserWindows.stage?.close();
    };
    poll();
    const t = setInterval(poll, 500);
    window.addEventListener('beforeunload', closeAll);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', closeAll);
    };
  }, []);
  return open;
}
