import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWindowCommand, windowEntries } from './components/windowCommands';
import { openWindowedOutput, useWindowedOutputs, windowedRoute } from './outputs';
import { useStore } from './store';

const s = () => useStore.getState();
const opened: string[] = [];

beforeEach(() => {
  opened.length = 0;
  useWindowedOutputs.setState({ windows: [] });
  vi.stubGlobal('window', { open: (url: string) => (opened.push(url), {}) });
  vi.stubGlobal('location', { pathname: '/', search: '' });
});
afterEach(() => vi.unstubAllGlobals());

const labels = (entries: unknown[]) =>
  entries.map((e) =>
    e && typeof e === 'object' ? ('header' in e ? `[${(e as { header: string }).header}]` : (e as { label: string }).label) : e,
  );

describe('Window ▸ New Windowed Output', () => {
  it('lists the screens under Audience and Stage', () => {
    const entries = windowEntries() as { label: string; submenu: () => unknown[] }[];
    // A browser can't move its own window: only New Windowed Output.
    expect(labels(entries)).toEqual(['New Windowed Output']);
    expect(labels(entries[0].submenu())).toEqual(['[Audience]', 'Screen 1', '[Stage]', 'Stage Screen 1']);
  });

  it('opens a window showing the screen', () => {
    const screen = s().screens.screens[0];
    expect(runWindowCommand(`windowed-output:${screen.id}`)).toBe(true);
    expect(opened).toEqual([`/#/${windowedRoute(screen.id)}`]);
    expect(windowedRoute('a b')).toBe('screen?screen=a%20b');
    openWindowedOutput('no such screen');
    expect(opened).toHaveLength(1);
  });

  it('in the desktop app, asks for a window of its own, which stays until it’s closed', () => {
    const setOutputs = vi.fn();
    vi.stubGlobal('window', { lumenDesktop: { setOutputs }, open: () => null });
    const screen = s().screens.screens[0];
    openWindowedOutput(screen.id);
    openWindowedOutput(screen.id);
    expect(useWindowedOutputs.getState().windows.map((w) => w.screenId)).toEqual([screen.id, screen.id]);
    expect(new Set(useWindowedOutputs.getState().windows.map((w) => w.key)).size).toBe(2);
    const entries = windowEntries();
    expect(labels(entries)).toEqual([
      'Minimize',
      'Zoom',
      'Fill',
      'Center',
      '-',
      'Move & Resize',
      '-',
      'Bring All to Front',
      '-',
      'New Windowed Output',
    ]);
  });
});
