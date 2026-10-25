import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getSequence, parseLyrics } from './lyrics';
import { deleteMediaBlob, putMediaBlob } from './media';
import { defaultThemes, seedMessages, seedPlaylist, seedPresentations } from './seed';
import type { LiveState, MediaItem, Message, Playlist, PlaylistItem, Presentation, Settings, Theme, TimerState } from './types';
import { nextOccurrence, uid } from './util';

/** The part of the state that is saved and exported. */
export interface LibraryData {
  presentations: Record<string, Presentation>;
  themes: Theme[];
  playlists: Playlist[];
  media: MediaItem[];
  messages: Message[];
  settings: Settings;
  activePlaylistId: string;
}

interface UIState {
  selectedPresentationId: string | null;
  selectedPlaylistItemId: string | null;
  centerMode: 'show' | 'edit';
  bottomTab: 'media' | 'themes';
  editingThemeId: string | null;
}

interface Actions {
  select(presentationId: string | null, playlistItemId?: string | null): void;
  setUI(patch: Partial<UIState>): void;

  createPresentation(init: Partial<Presentation> & { title: string }, text?: string): string;
  updatePresentation(id: string, patch: Partial<Presentation>): void;
  setPresentationText(id: string, text: string): void;
  duplicatePresentation(id: string): string | null;
  deletePresentation(id: string): void;

  addToPlaylist(presentationId: string, index?: number): void;
  addPlaylistHeader(label: string): void;
  updatePlaylistItem(itemId: string, patch: Partial<{ label: string }>): void;
  movePlaylistItem(from: number, to: number): void;
  removePlaylistItem(itemId: string): void;
  createPlaylist(name: string): void;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  setActivePlaylist(id: string): void;

  createTheme(from?: Theme): string;
  updateTheme(id: string, patch: Partial<Theme>): void;
  deleteTheme(id: string): void;

  addMediaFiles(files: File[]): Promise<void>;
  deleteMedia(id: string): void;

  addMessage(text: string): void;
  updateMessage(id: string, text: string): void;
  deleteMessage(id: string): void;
  showMessage(id: string | null): void;

  updateSettings(patch: Partial<Settings>): void;

  goLive(presentationId: string, index: number, playlistItemId?: string | null): void;
  next(): void;
  prev(): void;
  jumpToGroup(letter: string): void;
  setLiveMedia(id: string | null): void;
  toggleLogo(): void;
  clearAll(): void;
  clearSlide(): void;
  clearMedia(): void;
  setStageMessage(text: string | null): void;

  setTimer(patch: Partial<Pick<TimerState, 'mode' | 'durationMs' | 'targetTime'>>): void;
  startTimer(): void;
  pauseTimer(): void;
  resetTimer(): void;

  importLibrary(data: LibraryData): void;
}

export type AppState = LibraryData &
  UIState & {
    live: LiveState;
    timer: TimerState;
  } & Actions;

function initialLibrary(): LibraryData {
  const presentations = seedPresentations();
  const playlist = seedPlaylist(presentations);
  return {
    presentations: Object.fromEntries(presentations.map((p) => [p.id, p])),
    themes: defaultThemes,
    playlists: [playlist],
    media: [],
    messages: seedMessages,
    settings: { transitionMs: 400, advanceAcrossItems: true, defaultThemeId: 'theme-classic', gridSize: 220 },
    activePlaylistId: playlist.id,
  };
}

const emptyLive: LiveState = { slide: null, mediaId: null, logo: false, messageId: null, stageMessage: null };

const initialTimer: TimerState = {
  mode: 'duration',
  durationMs: 5 * 60_000,
  targetTime: '10:00',
  running: false,
  endsAt: null,
  remainingMs: 5 * 60_000,
};

export function activePlaylist(s: LibraryData): Playlist | undefined {
  return s.playlists.find((p) => p.id === s.activePlaylistId) ?? s.playlists[0];
}

/** The presentation item before/after `itemId` in the active playlist. */
export function adjacentPlaylistItem(
  s: LibraryData,
  itemId: string | null | undefined,
  dir: 1 | -1,
): Extract<PlaylistItem, { type: 'presentation' }> | null {
  const items = activePlaylist(s)?.items ?? [];
  let i = items.findIndex((it) => it.id === itemId);
  if (i < 0) return null;
  for (i += dir; i >= 0 && i < items.length; i += dir) {
    const it = items[i];
    if (it.type === 'presentation' && s.presentations[it.presentationId]) return it;
  }
  return null;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const updatePlaylist = (fn: (p: Playlist) => Playlist) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === activePlaylist(s)?.id ? fn(p) : p)) }));

      return {
        ...initialLibrary(),
        selectedPresentationId: null,
        selectedPlaylistItemId: null,
        centerMode: 'show',
        bottomTab: 'media',
        editingThemeId: null,
        live: emptyLive,
        timer: initialTimer,

        select: (presentationId, playlistItemId = null) =>
          set({ selectedPresentationId: presentationId, selectedPlaylistItemId: playlistItemId }),
        setUI: (patch) => set(patch),

        createPresentation: (init, text = '') => {
          const id = uid();
          const p: Presentation = {
            category: 'song',
            groups: [],
            arrangement: [],
            ...init,
            ...(text ? parseLyrics(text) : {}),
            id,
            updatedAt: Date.now(),
          };
          set((s) => ({ presentations: { ...s.presentations, [id]: p } }));
          return id;
        },
        updatePresentation: (id, patch) =>
          set((s) => {
            const p = s.presentations[id];
            if (!p) return {};
            return { presentations: { ...s.presentations, [id]: { ...p, ...patch, updatedAt: Date.now() } } };
          }),
        setPresentationText: (id, text) => get().updatePresentation(id, parseLyrics(text)),
        duplicatePresentation: (id) => {
          const p = get().presentations[id];
          if (!p) return null;
          return get().createPresentation({ ...structuredClone(p), title: `${p.title} (copy)` });
        },
        deletePresentation: (id) =>
          set((s) => {
            const { [id]: _removed, ...presentations } = s.presentations;
            return {
              presentations,
              playlists: s.playlists.map((pl) => ({
                ...pl,
                items: pl.items.filter((it) => it.type !== 'presentation' || it.presentationId !== id),
              })),
              selectedPresentationId: s.selectedPresentationId === id ? null : s.selectedPresentationId,
              live: s.live.slide?.presentationId === id ? { ...s.live, slide: null } : s.live,
            };
          }),

        addToPlaylist: (presentationId, index) =>
          updatePlaylist((pl) => {
            const items = [...pl.items];
            items.splice(index ?? items.length, 0, { id: uid(), type: 'presentation', presentationId });
            return { ...pl, items };
          }),
        addPlaylistHeader: (label) => updatePlaylist((pl) => ({ ...pl, items: [...pl.items, { id: uid(), type: 'header', label }] })),
        updatePlaylistItem: (itemId, patch) =>
          updatePlaylist((pl) => ({
            ...pl,
            items: pl.items.map((it) => (it.id === itemId && it.type === 'header' ? { ...it, ...patch } : it)),
          })),
        movePlaylistItem: (from, to) =>
          updatePlaylist((pl) => {
            const items = [...pl.items];
            const [moved] = items.splice(from, 1);
            if (!moved) return pl;
            items.splice(to > from ? to - 1 : to, 0, moved);
            return { ...pl, items };
          }),
        removePlaylistItem: (itemId) => {
          updatePlaylist((pl) => ({ ...pl, items: pl.items.filter((it) => it.id !== itemId) }));
          if (get().selectedPlaylistItemId === itemId) set({ selectedPlaylistItemId: null });
        },
        createPlaylist: (name) => {
          const pl: Playlist = { id: uid(), name, items: [] };
          set((s) => ({ playlists: [...s.playlists, pl], activePlaylistId: pl.id }));
        },
        renamePlaylist: (id, name) => set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) })),
        deletePlaylist: (id) =>
          set((s) => {
            if (s.playlists.length <= 1) return {};
            const playlists = s.playlists.filter((p) => p.id !== id);
            return { playlists, activePlaylistId: playlists[0].id, selectedPlaylistItemId: null };
          }),
        setActivePlaylist: (id) => set({ activePlaylistId: id, selectedPlaylistItemId: null }),

        createTheme: (from) => {
          const base = from ?? get().themes[0] ?? defaultThemes[0];
          const theme: Theme = { ...structuredClone(base), id: uid(), name: from ? `${from.name} (copy)` : 'New Theme' };
          set((s) => ({ themes: [...s.themes, theme], editingThemeId: theme.id }));
          return theme.id;
        },
        updateTheme: (id, patch) => set((s) => ({ themes: s.themes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
        deleteTheme: (id) =>
          set((s) => {
            if (s.themes.length <= 1) return {};
            const themes = s.themes.filter((t) => t.id !== id);
            const presentations = Object.fromEntries(
              Object.entries(s.presentations).map(([pid, p]) => [pid, p.themeId === id ? { ...p, themeId: undefined } : p]),
            );
            const defaultThemeId = s.settings.defaultThemeId === id ? themes[0].id : s.settings.defaultThemeId;
            return {
              themes,
              presentations,
              settings: { ...s.settings, defaultThemeId },
              editingThemeId: s.editingThemeId === id ? null : s.editingThemeId,
            };
          }),

        addMediaFiles: async (files) => {
          const added: MediaItem[] = [];
          for (const file of files) {
            const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
            if (!kind) continue;
            const item: MediaItem = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind, mime: file.type };
            await putMediaBlob(item.id, file);
            added.push(item);
          }
          if (added.length) set((s) => ({ media: [...s.media, ...added] }));
        },
        deleteMedia: (id) => {
          void deleteMediaBlob(id);
          set((s) => ({
            media: s.media.filter((m) => m.id !== id),
            live: s.live.mediaId === id ? { ...s.live, mediaId: null } : s.live,
            settings: s.settings.logoMediaId === id ? { ...s.settings, logoMediaId: undefined } : s.settings,
            themes: s.themes.map((t) =>
              t.background.mediaId === id ? { ...t, background: { ...t.background, type: 'color', mediaId: undefined } } : t,
            ),
          }));
        },

        addMessage: (text) => set((s) => ({ messages: [...s.messages, { id: uid(), text }] })),
        updateMessage: (id, text) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, text } : m)) })),
        deleteMessage: (id) =>
          set((s) => ({
            messages: s.messages.filter((m) => m.id !== id),
            live: s.live.messageId === id ? { ...s.live, messageId: null } : s.live,
          })),
        showMessage: (id) => set((s) => ({ live: { ...s.live, messageId: id } })),

        updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

        goLive: (presentationId, index, playlistItemId = null) =>
          set((s) => ({ live: { ...s.live, logo: false, slide: { presentationId, index, playlistItemId: playlistItemId ?? undefined } } })),

        next: () => {
          const s = get();
          const ref = s.live.slide;
          const selected = s.selectedPresentationId;
          // Arrow keys drive the presentation on screen in the operator view,
          // starting it from the top if it is not the one that is live.
          if (selected && ref?.presentationId !== selected) {
            if (s.presentations[selected]) s.goLive(selected, 0, s.selectedPlaylistItemId);
            return;
          }
          if (!ref) return;
          const p = s.presentations[ref.presentationId];
          if (p && ref.index + 1 < getSequence(p).length) {
            s.goLive(ref.presentationId, ref.index + 1, ref.playlistItemId);
            return;
          }
          if (!s.settings.advanceAcrossItems) return;
          const nextItem = adjacentPlaylistItem(s, ref.playlistItemId, 1);
          if (nextItem) {
            s.select(nextItem.presentationId, nextItem.id);
            s.goLive(nextItem.presentationId, 0, nextItem.id);
          }
        },
        prev: () => {
          const s = get();
          const ref = s.live.slide;
          if (!ref || (s.selectedPresentationId && ref.presentationId !== s.selectedPresentationId)) return;
          if (ref.index > 0) {
            s.goLive(ref.presentationId, ref.index - 1, ref.playlistItemId);
            return;
          }
          if (!s.settings.advanceAcrossItems) return;
          const prevItem = adjacentPlaylistItem(s, ref.playlistItemId, -1);
          if (prevItem) {
            const length = getSequence(s.presentations[prevItem.presentationId]).length;
            s.select(prevItem.presentationId, prevItem.id);
            if (length) s.goLive(prevItem.presentationId, length - 1, prevItem.id);
          }
        },
        jumpToGroup: (letter) => {
          // Pressing C goes to the next Chorus, V to the next Verse, and so on.
          const s = get();
          const pid = s.selectedPresentationId;
          const p = pid ? s.presentations[pid] : undefined;
          if (!p) return;
          const seq = getSequence(p);
          const from = s.live.slide?.presentationId === pid ? s.live.slide.index : -1;
          const matches = (i: number) => seq[i].indexInGroup === 0 && seq[i].group.name.toLowerCase().startsWith(letter.toLowerCase());
          for (let step = 1; step <= seq.length; step++) {
            const i = (from + step) % seq.length;
            if (matches(i)) return s.goLive(p.id, i, s.selectedPlaylistItemId);
          }
        },
        setLiveMedia: (id) => set((s) => ({ live: { ...s.live, mediaId: id } })),
        toggleLogo: () => set((s) => ({ live: { ...s.live, logo: !s.live.logo } })),
        clearAll: () => set((s) => ({ live: { ...emptyLive, stageMessage: s.live.stageMessage } })),
        clearSlide: () => set((s) => ({ live: { ...s.live, slide: null } })),
        clearMedia: () => set((s) => ({ live: { ...s.live, mediaId: null } })),
        setStageMessage: (text) => set((s) => ({ live: { ...s.live, stageMessage: text } })),

        setTimer: (patch) =>
          set((s) => {
            const timer = { ...s.timer, ...patch };
            if (!timer.running) timer.remainingMs = timer.durationMs;
            return { timer };
          }),
        startTimer: () =>
          set((s) => {
            if (s.timer.running) return {};
            const now = Date.now();
            const endsAt = s.timer.mode === 'toTime' ? nextOccurrence(s.timer.targetTime, now) : now + s.timer.remainingMs;
            return { timer: { ...s.timer, running: true, endsAt } };
          }),
        pauseTimer: () =>
          set((s) => {
            if (!s.timer.running || s.timer.endsAt == null) return {};
            return { timer: { ...s.timer, running: false, endsAt: null, remainingMs: s.timer.endsAt - Date.now() } };
          }),
        resetTimer: () => set((s) => ({ timer: { ...s.timer, running: false, endsAt: null, remainingMs: s.timer.durationMs } })),

        importLibrary: (data) =>
          set({
            ...data,
            selectedPresentationId: null,
            selectedPlaylistItemId: null,
            editingThemeId: null,
            live: emptyLive,
          }),
      };
    },
    {
      name: 'lumen-library',
      version: 1,
      partialize: (s): LibraryData => ({
        presentations: s.presentations,
        themes: s.themes,
        playlists: s.playlists,
        media: s.media,
        messages: s.messages,
        settings: s.settings,
        activePlaylistId: s.activePlaylistId,
      }),
    },
  ),
);

export function exportLibrary(): LibraryData {
  const s = useStore.getState();
  return useStore.persist.getOptions().partialize!(s) as LibraryData;
}

export function isLibraryData(x: unknown): x is LibraryData {
  const d = x as LibraryData;
  return (
    !!d &&
    typeof d.presentations === 'object' &&
    Array.isArray(d.themes) &&
    d.themes.length > 0 &&
    Array.isArray(d.playlists) &&
    d.playlists.length > 0 &&
    Array.isArray(d.media) &&
    Array.isArray(d.messages) &&
    typeof d.settings === 'object'
  );
}
