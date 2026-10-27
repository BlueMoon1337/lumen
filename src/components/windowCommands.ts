/**
 * The Window menu, as in ProPresenter: Minimize, Zoom, Fill, Center, Move & Resize ▸, Bring All to
 * Front, New Windowed Output ▸ and the open windows. The desktop app's menu runs the window moves
 * itself (on a Mac, macOS adds Fill, Center, Move & Resize and Full Screen Tile); New Windowed
 * Output comes here. The More menu has the same, and in a browser just New Windowed Output.
 */
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { openWindowedOutput } from '../outputs';
import { useStore } from '../store';
import type { ContextEntries } from './ContextMenu';
import { shortcut } from './ui';

const st = () => useStore.getState();

export function runWindowCommand(id: string): boolean {
  if (id.startsWith('windowed-output:')) {
    openWindowedOutput(id.slice('windowed-output:'.length));
    return true;
  }
  return false;
}

/** Keeps New Windowed Output's list of screens in the desktop menu, and opens the one picked. */
export function useWindowCommands() {
  const screens = useStore(useShallow((s) => s.screens.screens.map((sc) => `${sc.id}\u0000${sc.kind}\u0000${sc.name}`)));
  useEffect(() => {
    const bridge = window.lumenDesktop;
    if (!bridge) return;
    bridge.setWindowState({ screens: st().screens.screens.map((sc) => ({ id: sc.id, name: sc.name, kind: sc.kind })) });
  }, [screens]);
  useEffect(() => window.lumenDesktop?.onMenu((id) => void runWindowCommand(id)), []);
}

/** New Windowed Output ▸: the screens, under Audience and Stage. */
function outputEntries(): ContextEntries {
  const screens = st().screens.screens;
  const section = (kind: 'audience' | 'stage', title: string): ContextEntries => {
    const of = screens.filter((sc) => sc.kind === kind);
    return of.length ? [{ header: title }, ...of.map((sc) => ({ label: sc.name, action: () => openWindowedOutput(sc.id) }))] : [];
  };
  const entries = [...section('audience', 'Audience'), ...section('stage', 'Stage')];
  return entries.length ? entries : [{ label: 'No Screens', disabled: true, action: () => {} }];
}

export function windowEntries(): ContextEntries {
  const bridge = window.lumenDesktop;
  const outputs = { label: 'New Windowed Output', submenu: outputEntries };
  // A browser can't move its own window.
  if (!bridge) return [outputs];
  const run = (label: string, id: string, key?: string) => ({ label, shortcut: key, action: () => void bridge.runWindowCommand(id) });
  return [
    run('Minimize', 'window-minimize', shortcut('M')),
    run('Zoom', 'window-zoom'),
    run('Fill', 'window-fill'),
    run('Center', 'window-center'),
    '-',
    {
      label: 'Move & Resize',
      submenu: [
        { header: 'Halves' },
        run('Left', 'window-left'),
        run('Right', 'window-right'),
        run('Top', 'window-top'),
        run('Bottom', 'window-bottom'),
        '-',
        { header: 'Quarters' },
        run('Top Left', 'window-top-left'),
        run('Top Right', 'window-top-right'),
        run('Bottom Left', 'window-bottom-left'),
        run('Bottom Right', 'window-bottom-right'),
        '-',
        { header: 'Arrange' },
        run('Left & Right', 'window-left-right'),
        run('Right & Left', 'window-right-left'),
        run('Top & Bottom', 'window-top-bottom'),
        run('Bottom & Top', 'window-bottom-top'),
        run('Quarters', 'window-quarters'),
        '-',
        run('Return to Previous Size', 'window-previous'),
      ],
    },
    '-',
    run('Bring All to Front', 'window-bring-all'),
    '-',
    outputs,
  ];
}
