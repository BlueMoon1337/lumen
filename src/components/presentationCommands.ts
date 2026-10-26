/**
 * The Presentation menu, as in ProPresenter: New Slide; Next and Previous Slide and Background;
 * Clear Groups ▸; Clear Slide, Media, Logo (where ProPresenter has Props), Audio, Messages and
 * Announcements; Clear to Logo; Show Triggered Presentation and Announcement; Reveal in Library;
 * Show Slide on Stage Screens Only. The desktop menu bar, the More menu and the keys run these.
 */
import { useEffect } from 'react';
import { clearGroupsOf } from '../layers';
import { getSequence } from '../lyrics';
import { notify } from '../notices';
import { useStore, type AppState } from '../store';
import type { ClearLayer, LiveSlideRef } from '../types';
import { isTypingTarget } from '../util';
import type { ContextEntries } from './ContextMenu';
import { selectedSlides } from './editCommands';
import { shortcut } from './ui';

const st = () => useStore.getState();

/** The presentation Presentation ▸ New Slide and Show Slide on Stage Screens Only work on. */
function current(s: AppState) {
  const p = s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined;
  return p && !p.hidden && (s.mode === 'show' || s.mode === 'edit') ? p : undefined;
}

const CLEARS: Record<string, ClearLayer[]> = {
  'clear-slide': ['slide'],
  'clear-media': ['media'],
  'clear-logo': ['logo'],
  'clear-audio': ['audio'],
  'clear-messages': ['messages'],
  'clear-announcements': ['announcements'],
};

/** Opens the presentation on a layer, where it was started from (a playlist, or its library). */
function showTriggered(ref: LiveSlideRef | null) {
  const s = st();
  if (!ref || !s.presentations[ref.presentationId]) return;
  const playlist = ref.playlistItemId ? s.playlists.find((pl) => pl.items.some((it) => it.id === ref.playlistItemId)) : undefined;
  if (playlist) {
    s.setActivePlaylist(playlist.id);
    s.setUI({ sidebar: 'playlist', mode: 'show' });
    s.select(ref.presentationId, ref.playlistItemId);
  } else {
    s.setUI({ sidebar: 'library', libraryCategory: s.presentations[ref.presentationId].category, mode: 'show' });
    s.select(ref.presentationId);
  }
  revealSelectedRow();
}

/** Scrolls the sidebar to the selected presentation once it's drawn. */
const revealSelectedRow = () =>
  requestAnimationFrame(() => document.querySelector('.items .item-row.selected')?.scrollIntoView({ block: 'nearest' }));

/** Whether a command can run now. */
export function canRun(id: string, s: AppState = st()): boolean {
  if (id.startsWith('clear-group:')) return true;
  const p = current(s);
  switch (id) {
    case 'new-slide':
      return !!p;
    case 'next-background':
    case 'prev-background':
      return s.media.some((m) => m.kind !== 'audio');
    case 'clear-to-logo':
      return !!s.settings.logoMediaId;
    case 'show-triggered':
      return !!s.live.slide;
    case 'show-triggered-announcement':
      return !!s.live.announcement;
    case 'reveal-in-library': {
      const sel = s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined;
      return !!sel && !sel.hidden;
    }
    case 'stage-only':
      return !!p && selectedSlides(s, p).length > 0;
    default:
      return true;
  }
}

/** Runs a Presentation command (by its desktop menu id); false if `id` isn't one. */
export function runPresentationCommand(id: string): boolean {
  const s = st();
  if (id.startsWith('clear-group:')) {
    const group = clearGroupsOf(s.settings).find((g) => `clear-group:${g.id}` === id);
    if (group) s.clearLayers(group.layers);
    return true;
  }
  if (CLEARS[id]) {
    s.clearLayers(CLEARS[id]);
    return true;
  }
  if (!KNOWN.has(id)) return false;
  if (!canRun(id, s)) return true;
  const p = current(s);
  switch (id) {
    case 'new-slide': {
      if (!p) break;
      const after = selectedSlides(s, p).at(-1) ?? null;
      const slide = s.addSlide(p.id, after);
      if (slide) s.openEditor(slide);
      break;
    }
    case 'next-slide':
      s.next();
      break;
    case 'prev-slide':
      s.prev();
      break;
    case 'next-background':
      s.stepMedia(1);
      break;
    case 'prev-background':
      s.stepMedia(-1);
      break;
    case 'clear-all':
      s.clearAll();
      break;
    case 'configure-clear-groups':
      s.setUI({ dialog: 'clearGroups' });
      break;
    case 'clear-to-logo':
      s.clearToLogo();
      break;
    case 'show-triggered':
      showTriggered(s.live.slide);
      break;
    case 'show-triggered-announcement':
      showTriggered(s.live.announcement);
      break;
    case 'reveal-in-library': {
      const sel = s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined;
      if (!sel) break;
      s.setUI({ sidebar: 'library', libraryCategory: sel.category });
      s.select(sel.id);
      revealSelectedRow();
      break;
    }
    case 'stage-only': {
      if (!p) break;
      const id0 = selectedSlides(s, p)[0];
      const index = getSequence(p).findIndex((e) => e.slide.id === id0);
      if (index < 0) break;
      s.showOnStage(p.id, index);
      notify(`Slide ${index + 1} is on the stage screens only. The audience screens are unchanged.`, 'info', 3500);
      break;
    }
  }
  return true;
}

const KNOWN = new Set([
  'new-slide',
  'next-slide',
  'prev-slide',
  'next-background',
  'prev-background',
  'clear-all',
  'configure-clear-groups',
  'clear-to-logo',
  'show-triggered',
  'show-triggered-announcement',
  'reveal-in-library',
  'stage-only',
]);

// ---- Keys -------------------------------------------------------------------------------------

/** The function keys, as in ProPresenter (F4 clears the logo, where ProPresenter has Props). */
const F_KEYS: Record<string, string> = {
  F1: 'clear-all',
  F2: 'clear-slide',
  F3: 'clear-media',
  F4: 'clear-logo',
  F5: 'clear-audio',
  F6: 'clear-messages',
  F7: 'clear-announcements',
  F12: 'clear-to-logo',
};

function commandFor(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !e.altKey && !e.shiftKey && F_KEYS[e.key]) return F_KEYS[e.key];
  if (!mod) return null;
  if (e.altKey) return !e.shiftKey && e.code === 'KeyL' ? 'reveal-in-library' : null;
  if (e.shiftKey) return e.code === 'KeyN' ? 'new-slide' : e.code === 'KeyL' ? 'show-triggered-announcement' : null;
  const keys: Record<string, string> = {
    ArrowRight: 'next-background',
    ArrowLeft: 'prev-background',
    KeyL: 'show-triggered',
    Digit0: 'stage-only',
  };
  return keys[e.code] ?? null;
}

/** When each command was last run from a key, so the desktop menu's copy of the same press is skipped. */
const keyAt = new Map<string, number>();
const SAME_PRESS_MS = 400;

/**
 * The Presentation menu's keys. Clearing works anywhere, even in a text field; ⌘← and ⌘→ only
 * outside one (in one they move the caret).
 */
export function usePresentationKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = commandFor(e);
      if (!id || e.defaultPrevented) return;
      if ((id === 'next-background' || id === 'prev-background') && isTypingTarget(e.target)) return;
      if (!canRun(id)) return;
      e.preventDefault();
      keyAt.set(id, Date.now());
      runPresentationCommand(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ---- The desktop menu -------------------------------------------------------------------------

const MENU_IDS = [...KNOWN, ...Object.keys(CLEARS)];

/** Runs the desktop menu's commands, and keeps its items on or off and its clear groups listed. */
export function usePresentationMenu() {
  useEffect(() => {
    const bridge = window.lumenDesktop;
    if (!bridge) return;
    let sent = '';
    const sync = () => {
      const s = st();
      const state = {
        enabled: MENU_IDS.filter((id) => canRun(id, s)),
        clearGroups: clearGroupsOf(s.settings).map((g) => ({ id: g.id, name: g.name })),
      };
      const key = JSON.stringify(state);
      if (key === sent) return;
      sent = key;
      bridge.setPresentationState(state);
    };
    sync();
    const stop = useStore.subscribe(sync);
    const stopMenu = bridge.onMenu((id) => {
      if (Date.now() - (keyAt.get(id) ?? 0) < SAME_PRESS_MS) return;
      runPresentationCommand(id);
    });
    return () => {
      stop();
      stopMenu();
    };
  }, []);
}

// ---- The More menu ----------------------------------------------------------------------------

export function presentationEntries(): ContextEntries {
  const s = st();
  const item = (label: string, id: string, key?: string) => ({
    label,
    shortcut: key,
    disabled: !canRun(id, s),
    action: () => runPresentationCommand(id),
  });
  return [
    item('New Slide', 'new-slide', shortcut('N', false, true)),
    '-',
    item('Next Slide', 'next-slide', '→'),
    item('Previous Slide', 'prev-slide', '←'),
    item('Next Background', 'next-background', shortcut('→')),
    item('Previous Background', 'prev-background', shortcut('←')),
    '-',
    {
      label: 'Clear Groups',
      submenu: [
        item('Clear All', 'clear-all', 'F1'),
        ...clearGroupsOf(s.settings).map((g) => item(g.name, `clear-group:${g.id}`)),
        '-',
        item('Configure Clear Groups…', 'configure-clear-groups'),
      ],
    },
    '-',
    item('Clear Slide', 'clear-slide', 'F2'),
    item('Clear Media', 'clear-media', 'F3'),
    item('Clear Logo', 'clear-logo', 'F4'),
    item('Clear Audio', 'clear-audio', 'F5'),
    item('Clear Messages', 'clear-messages', 'F6'),
    item('Clear Announcements', 'clear-announcements', 'F7'),
    '-',
    item('Clear to Logo', 'clear-to-logo', 'F12'),
    '-',
    item('Show Triggered Presentation', 'show-triggered', shortcut('L')),
    item('Show Triggered Announcement', 'show-triggered-announcement', shortcut('L', false, true)),
    item('Reveal in Library', 'reveal-in-library', shortcut('L', true)),
    '-',
    item('Show Slide on Stage Screens Only', 'stage-only', shortcut('0')),
  ];
}
