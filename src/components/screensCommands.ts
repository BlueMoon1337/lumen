/**
 * The Screens menu, as in ProPresenter: Audience (Enable ⌘1, Live ▸ the looks, Edit Looks… ⇧⌘1),
 * Stage (Enable ⌘2, Edit Layouts… ⌘4), Configure Screens… ⌥⌘1, and Start Capture and Capture
 * Settings…. The desktop menu bar, the More menu and the keys run these.
 */
import { useEffect } from 'react';
import { toggleCapture, useCapture } from '../capture';
import { setScreensEnabled } from '../outputs';
import { useStore } from '../store';
import type { ScreenKind } from '../types';
import type { ContextEntries } from './ContextMenu';
import { shortcut } from './ui';

const st = () => useStore.getState();

const toggleScreens = (kind: ScreenKind) => {
  const { screens } = st();
  setScreensEnabled(kind, !(kind === 'audience' ? screens.audienceEnabled : screens.stageEnabled));
};

export function runScreensCommand(id: string): boolean {
  const s = st();
  if (id.startsWith('look:')) s.triggerLook(id.slice(5));
  else if (id === 'toggle-audience') toggleScreens('audience');
  else if (id === 'toggle-stage') toggleScreens('stage');
  else if (id === 'edit-looks') s.setUI({ dialog: 'looks' });
  else if (id === 'edit-layouts') s.setUI({ mode: 'layouts', dialog: null });
  else if (id === 'configure-screens') s.setUI({ dialog: 'screens' });
  else if (id === 'toggle-capture') void toggleCapture();
  else if (id === 'capture-settings') s.setUI({ dialog: 'capture' });
  else return false;
  return true;
}

/** The command for a key press: ⌘1, ⌘2, ⌥⌘1, ⇧⌘1, ⌘4. */
export function screensCommandFor(e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  // e.code, because ⌥1 types "¡" on a Mac and ⇧1 "!".
  if (e.altKey) return !e.shiftKey && e.code === 'Digit1' ? 'configure-screens' : null;
  if (e.shiftKey) return e.code === 'Digit1' ? 'edit-looks' : null;
  return ({ Digit1: 'toggle-audience', Digit2: 'toggle-stage', Digit4: 'edit-layouts' } as Record<string, string>)[e.code] ?? null;
}

/**
 * Runs the Screens menu's commands. The desktop app's menu has the keys and sends the commands,
 * and is kept up to date (its checkmarks, the looks under Live, Start or Stop Capture); in a
 * browser the keys are caught here, where Chrome may keep ⌘1 and ⌘2 for switching tabs.
 */
export function useScreensCommands() {
  useEffect(() => {
    const bridge = window.lumenDesktop;
    if (bridge) {
      let sent = '';
      const sync = () => {
        const s = st();
        const state = {
          audienceEnabled: s.screens.audienceEnabled,
          stageEnabled: s.screens.stageEnabled,
          looks: s.looks.map((l) => ({ id: l.id, name: l.name })),
          liveLookId: s.liveLook.id,
          liveLookName: s.liveLook.name,
          capturing: useCapture.getState().recording,
        };
        const key = JSON.stringify(state);
        if (key === sent) return;
        sent = key;
        bridge.setMenuState(state);
      };
      sync();
      // A menu shortcut of Shift and a digit doesn't always reach the menu (the key types "!"),
      // so the page opens the Looks window too. Opening it twice is opening it once.
      const onKey = (e: KeyboardEvent) => {
        if (screensCommandFor(e) !== 'edit-looks') return;
        e.preventDefault();
        runScreensCommand('edit-looks');
      };
      window.addEventListener('keydown', onKey);
      const stops = [useStore.subscribe(sync), useCapture.subscribe(sync), bridge.onMenu((id) => void runScreensCommand(id))];
      return () => {
        stops.forEach((stop) => stop());
        window.removeEventListener('keydown', onKey);
      };
    }
    const onKey = (e: KeyboardEvent) => {
      const id = screensCommandFor(e);
      if (!id) return;
      e.preventDefault();
      runScreensCommand(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ---- The More menu ----------------------------------------------------------------------------

export function screensEntries(): ContextEntries {
  const s = st();
  const item = (label: string, id: string, key?: string, checked?: boolean) => ({
    label,
    shortcut: key,
    checked,
    action: () => runScreensCommand(id),
  });
  return [
    { header: 'Audience' },
    item('Enable', 'toggle-audience', shortcut('1'), s.screens.audienceEnabled),
    {
      label: `Live: ${s.liveLook.name}`,
      submenu: () => st().looks.map((l) => item(l.name, `look:${l.id}`, undefined, l.id === st().liveLook.id)),
    },
    item('Edit Looks…', 'edit-looks', shortcut('1', false, true)),
    { header: 'Stage' },
    item('Enable', 'toggle-stage', shortcut('2'), s.screens.stageEnabled),
    item('Edit Layouts…', 'edit-layouts', shortcut('4')),
    '-',
    item('Configure Screens…', 'configure-screens', shortcut('1', true)),
    '-',
    item(useCapture.getState().recording ? 'Stop Capture' : 'Start Capture', 'toggle-capture'),
    item('Capture Settings…', 'capture-settings'),
  ];
}
