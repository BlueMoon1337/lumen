/**
 * Updates (the desktop app): Lumen looks for a newer release on GitHub when it starts and every
 * few hours, lights the Update button when there is one, and installs it when asked. The work is
 * in src-tauri/src/updates.rs; this keeps what the button and its window show.
 */
import { create } from 'zustand';
import { notify } from './notices';

export interface FoundUpdate {
  version: string;
  current: string;
  notes: string | null;
  date: string | null;
}

export type UpdateStatus = 'idle' | 'checking' | 'none' | 'available' | 'installing' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  hasToken: boolean | null;
  found: FoundUpdate | null;
  error: string | null;
  /** While installing: bytes received, and the total if known. */
  progress: { received: number; total: number | null } | null;
  checkedAt: number | null;
  /** Why updates can't install here ("translocated"), if they can't. */
  blocker: string | null;
}

export const useUpdates = create<UpdateState>(() => ({
  status: 'idle',
  version: null,
  hasToken: null,
  found: null,
  error: null,
  progress: null,
  checkedAt: null,
  blocker: null,
}));

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Looks for an update. A quiet check (the automatic ones) keeps a failure to itself. */
export async function checkForUpdates({ quiet = false } = {}): Promise<void> {
  const bridge = window.lumenDesktop;
  const state = useUpdates.getState();
  if (!bridge || state.status === 'checking' || state.status === 'installing') return;
  if (!state.hasToken) return;
  useUpdates.setState({ status: 'checking', error: null });
  try {
    const found = await bridge.checkUpdate();
    useUpdates.setState({ status: found ? 'available' : 'none', found, checkedAt: Date.now() });
  } catch (e) {
    // A quiet check that fails leaves things as they were (no network at the venue, say).
    if (quiet) useUpdates.setState({ status: state.found ? 'available' : 'idle' });
    else useUpdates.setState({ status: 'error', error: String(e) });
  }
}

export async function saveToken(token: string): Promise<void> {
  const bridge = window.lumenDesktop;
  if (!bridge) return;
  await bridge.setUpdateToken(token);
  const hasToken = await bridge.hasUpdateToken();
  useUpdates.setState({ hasToken, found: null, status: 'idle', error: null });
  if (hasToken) await checkForUpdates();
}

export async function installUpdate(): Promise<void> {
  const bridge = window.lumenDesktop;
  if (!bridge || useUpdates.getState().status !== 'available') return;
  useUpdates.setState({ status: 'installing', progress: { received: 0, total: null }, error: null });
  const stop = bridge.onUpdateProgress((progress) => useUpdates.setState({ progress }));
  try {
    // Lumen restarts when it's done, so this only returns on failure.
    await bridge.installUpdate();
  } catch (e) {
    useUpdates.setState({ status: 'error', error: String(e), progress: null, found: null });
  } finally {
    stop();
  }
}

/** Reads the version and whether there's a token, then checks now (after start-up) and every few hours. */
export function startUpdateChecks(): () => void {
  const bridge = window.lumenDesktop;
  if (!bridge) return () => {};
  let alive = true;
  void Promise.all([bridge.appVersion(), bridge.hasUpdateToken(), bridge.updateBlocker()]).then(([version, hasToken, blocker]) => {
    if (!alive) return;
    useUpdates.setState({ version, hasToken, blocker });
    // A copy macOS runs from a temporary place gets a Dock icon of its own (beside the one kept in
    // the Dock) and can't update itself: say how to fix it.
    if (blocker === 'translocated')
      notify(
        'macOS is running Lumen from a temporary copy, so it has a second Dock icon and can’t update. Quit Lumen, make sure it’s in Applications, run “xattr -dr com.apple.quarantine /Applications/Lumen.app” in Terminal, and open it from Applications.',
        'info',
        20_000,
      );
  });
  const first = window.setTimeout(() => void checkForUpdates({ quiet: true }), 15_000);
  const every = window.setInterval(() => void checkForUpdates({ quiet: true }), CHECK_EVERY_MS);
  return () => {
    alive = false;
    window.clearTimeout(first);
    window.clearInterval(every);
  };
}

/** "12.3 MB of 40.1 MB" */
export function progressText(p: { received: number; total: number | null }): string {
  const mb = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;
  return p.total ? `${mb(p.received)} of ${mb(p.total)}` : mb(p.received);
}
