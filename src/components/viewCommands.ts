/**
 * The View menu, as in ProPresenter: Show ⌃S, Presentation Editor ⌃E, Reflow Editor ⌃R, Bibles ⌃B;
 * Continuous Playlist; Slide View ▸ Grid, Easy or Table. The desktop menu bar, the More menu and
 * the keys run these.
 */
import { useEffect } from 'react';
import { isReadOnly } from '../slideshows';
import { useStore, type AppState, type Mode } from '../store';
import type { Settings } from '../types';
import { isTypingTarget } from '../util';
import type { ContextEntries } from './ContextMenu';

const st = () => useStore.getState();
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

const MODES: Record<string, Mode> = { 'view-show': 'show', 'view-edit': 'edit', 'view-reflow': 'reflow', 'view-bibles': 'bible' };
const SLIDE_VIEWS: Record<string, Settings['slideView']> = {
  'slide-view-grid': 'grid',
  'slide-view-easy': 'easy',
  'slide-view-table': 'list',
};

const hasPresentation = (s: AppState) => !!s.selectedPresentationId && !!s.presentations[s.selectedPresentationId];
/** A presentation that can be edited: not a PowerPoint or Keynote one. */
const editable = (s: AppState) => hasPresentation(s) && !isReadOnly(s.presentations[s.selectedPresentationId!]);

export function canRunView(id: string, s: AppState = st()): boolean {
  return id === 'view-edit' || id === 'view-reflow' ? editable(s) : id in MODES || id in SLIDE_VIEWS || id === 'continuous-playlist';
}

export function runViewCommand(id: string): boolean {
  const s = st();
  if (!canRunView(id, s)) return false;
  if (id in MODES) s.setUI({ mode: MODES[id] });
  else if (id in SLIDE_VIEWS) s.updateSettings({ slideView: SLIDE_VIEWS[id] });
  else if (id === 'continuous-playlist') s.updateSettings({ continuousPlaylist: !s.settings.continuousPlaylist });
  else return false;
  return true;
}

/** ⌃S, ⌃E, ⌃R, ⌃B: the Control key on a Mac, as in ProPresenter; Ctrl elsewhere. */
export function viewCommandFor(
  e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac = IS_MAC,
): string | null {
  if (!e.ctrlKey || e.altKey || e.shiftKey || (mac && e.metaKey)) return null;
  return ({ KeyS: 'view-show', KeyE: 'view-edit', KeyR: 'view-reflow', KeyB: 'view-bibles' } as Record<string, string>)[e.code] ?? null;
}

/**
 * Runs the View menu's commands. The desktop app's menu has the keys and is kept up to date (the
 * checkmarks, and the editors off without a presentation); in a browser the keys are caught here,
 * except ⌃E, ⌃R and ⌃B in a text field, where they're the field's own (⌃E is end of line on a Mac).
 */
export function useViewCommands() {
  useEffect(() => {
    const bridge = window.lumenDesktop;
    if (bridge) {
      let sent = '';
      const sync = () => {
        const s = st();
        const state = {
          presentation: editable(s),
          continuousPlaylist: !!s.settings.continuousPlaylist,
          slideView: s.settings.slideView,
        };
        const key = JSON.stringify(state);
        if (key === sent) return;
        sent = key;
        bridge.setViewState(state);
      };
      sync();
      const stops = [useStore.subscribe(sync), bridge.onMenu((id) => void runViewCommand(id))];
      return () => stops.forEach((stop) => stop());
    }
    const onKey = (e: KeyboardEvent) => {
      const id = viewCommandFor(e);
      // ⌃S still goes back to Show from a text field (the Bible's passage field has the focus).
      if (!id || (isTypingTarget(e.target) && id !== 'view-show') || st().dialog) return;
      e.preventDefault();
      runViewCommand(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ---- The More menu ----------------------------------------------------------------------------

const key = (letter: string) => (IS_MAC ? `⌃${letter}` : `Ctrl+${letter}`);

export function viewEntries(): ContextEntries {
  const s = st();
  const item = (label: string, id: string, shortcut?: string, checked?: boolean) => ({
    label,
    shortcut,
    checked,
    disabled: !canRunView(id, s),
    action: () => runViewCommand(id),
  });
  return [
    item('Show', 'view-show', key('S')),
    item('Presentation Editor', 'view-edit', key('E')),
    item('Reflow Editor', 'view-reflow', key('R')),
    item('Bibles', 'view-bibles', key('B')),
    '-',
    item('Continuous Playlist', 'continuous-playlist', undefined, !!s.settings.continuousPlaylist),
    '-',
    {
      label: 'Slide View',
      submenu: [
        item('Grid View', 'slide-view-grid', undefined, s.settings.slideView === 'grid'),
        item('Easy View', 'slide-view-easy', undefined, s.settings.slideView === 'easy'),
        item('Table View', 'slide-view-table', undefined, s.settings.slideView === 'list'),
      ],
    },
  ];
}
