import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdates, installUpdate, progressText, saveToken, useUpdates } from './updates';

const found = { version: '0.3.0', current: '0.2.0', notes: '- New things', date: '2026-11-01' };

function bridge(overrides: Record<string, unknown> = {}) {
  const b = {
    hasUpdateToken: vi.fn(async () => true),
    setUpdateToken: vi.fn(async () => {}),
    checkUpdate: vi.fn(async () => found),
    installUpdate: vi.fn(async () => {}),
    onUpdateProgress: vi.fn(() => () => {}),
    ...overrides,
  };
  vi.stubGlobal('window', { lumenDesktop: b });
  return b;
}

beforeEach(() => useUpdates.setState({ status: 'idle', hasToken: true, found: null, error: null, progress: null, checkedAt: null }));
afterEach(() => vi.unstubAllGlobals());

describe('Updates', () => {
  it('finds a newer version, and says when Lumen is up to date', async () => {
    const b = bridge();
    await checkForUpdates();
    expect(useUpdates.getState()).toMatchObject({ status: 'available', found });
    b.checkUpdate.mockResolvedValueOnce(null as never);
    await checkForUpdates();
    expect(useUpdates.getState().status).toBe('none');
  });

  it('needs a token first, and checks as soon as one is saved', async () => {
    const b = bridge({ hasUpdateToken: vi.fn(async () => true) });
    useUpdates.setState({ hasToken: false });
    await checkForUpdates();
    expect(b.checkUpdate).not.toHaveBeenCalled();
    await saveToken('github_pat_x');
    expect(b.setUpdateToken).toHaveBeenCalledWith('github_pat_x');
    expect(useUpdates.getState()).toMatchObject({ hasToken: true, status: 'available' });
  });

  it('keeps a failed automatic check quiet, and shows one asked for', async () => {
    bridge({ checkUpdate: vi.fn(async () => Promise.reject('Couldn’t reach GitHub')) });
    await checkForUpdates({ quiet: true });
    expect(useUpdates.getState()).toMatchObject({ status: 'idle', error: null });
    await checkForUpdates();
    expect(useUpdates.getState()).toMatchObject({ status: 'error', error: 'Couldn’t reach GitHub' });
  });

  it('installs only an update it found, and reports a failure', async () => {
    const b = bridge({ installUpdate: vi.fn(async () => Promise.reject('signature mismatch')) });
    await installUpdate();
    expect(b.installUpdate).not.toHaveBeenCalled();
    await checkForUpdates();
    await installUpdate();
    expect(b.installUpdate).toHaveBeenCalled();
    expect(useUpdates.getState()).toMatchObject({ status: 'error', error: 'signature mismatch' });
  });

  it('shows download progress in megabytes', () => {
    expect(progressText({ received: 12_345_678, total: 40_100_000 })).toBe('12.3 MB of 40.1 MB');
    expect(progressText({ received: 1_000_000, total: null })).toBe('1.0 MB');
  });
});
