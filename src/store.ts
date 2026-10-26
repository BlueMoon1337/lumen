import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deleteBibleText, type BibleMeta } from './bible';
import { BIBLE_DRAFT_ID, BIBLE_LIVE_ID } from './bibleSlides';
import { colorForGroup, getSequence, parseLyrics } from './lyrics';
import { deleteMediaBlob, putMediaBlob } from './media';
import { defaultScreenSetup, newOutput, newScreen, nextScreenName, normalizeScreens } from './screens';
import { defaultThemes, seedMessages, seedPlaylist, seedPresentations } from './seed';
import * as ops from './slideOps';
import type { SlideScope } from './slideOps';
import { applyStyles, resolveTheme } from './theme';
import { DEFAULT_TRANSITION, fromMs } from './transitions';
import { ALL_LAYERS, clearLive } from './layers';
import type {
  Category,
  ClearLayer,
  ColorLabel,
  FontMeta,
  Group,
  LiveState,
  MediaItem,
  Message,
  Playlist,
  PlaylistItem,
  Presentation,
  ScreenConfig,
  ScreenKind,
  ScreenOutput,
  ScreenSetup,
  ScreenTools,
  Settings,
  Slide,
  SlideTransition,
  TextStyle,
  Theme,
  TimerState,
} from './types';
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
  /** Imported Bibles; their text is stored in IndexedDB. */
  bibles: BibleMeta[];
  /** Added font files; the files are stored in IndexedDB. */
  fonts: FontMeta[];
  /** Audience and stage screens, their outputs and where each output goes. */
  screens: ScreenSetup;
}

export type Mode = 'show' | 'edit' | 'reflow' | 'bible';
export type LiveTab = 'audio' | 'stage' | 'timers' | 'messages' | 'props';

interface UIState {
  selectedPresentationId: string | null;
  selectedPlaylistItemId: string | null;
  mode: Mode;
  /** Which collection the sidebar item list shows. */
  sidebar: 'library' | 'playlist';
  libraryCategory: Category;
  /** Slide selected in Edit mode. */
  editSlideId: string | null;
  /** Whether the slide's text element is selected on the Edit canvas. */
  editTextSelected: boolean;
  editingThemeId: string | null;
  showMediaBin: boolean;
  /** What the media bin shows: its images and videos, or the cameras for the Video Input layer. */
  mediaFilter: 'all' | 'image' | 'video' | 'inputs';
  liveTab: LiveTab;
  /** Copy Text Style's formatting, for Paste Text Style. */
  styleClipboard: TextStyle | null;
  /** Copied slides, for Paste. */
  slideClipboard: Slide[] | null;
  /** The open window: Settings, Screen Configuration, Groups & Labels, or Clear Groups. */
  dialog: 'settings' | 'screens' | 'labels' | 'clearGroups' | null;
}

interface Actions {
  select(presentationId: string | null, playlistItemId?: string | null): void;
  setUI(patch: Partial<UIState>): void;

  createPresentation(init: Partial<Presentation> & { title: string }, text?: string): string;
  updatePresentation(id: string, patch: Partial<Presentation>): void;
  setPresentationText(id: string, text: string): void;
  duplicatePresentation(id: string): string | null;
  deletePresentation(id: string): void;

  updateSlide(presentationId: string, slideId: string, patch: Partial<Slide>): void;
  updateGroup(presentationId: string, groupId: string, patch: Partial<Group>): void;
  addSlide(presentationId: string, afterSlideId?: string | null): string | null;
  duplicateSlide(presentationId: string, slideId: string): string | null;
  deleteSlide(presentationId: string, slideId: string): void;
  openEditor(slideId?: string | null): void;
  /** Puts a slide (and the rest of its group after it) in a group; see assignGroup in src/slideOps.ts. */
  assignGroup(presentationId: string, slideId: string, preset: ColorLabel): void;
  deleteGroup(presentationId: string, groupId: string): void;
  duplicateGroup(presentationId: string, groupId: string): void;
  setSlideLabel(presentationId: string, slideId: string, label: ColorLabel | undefined): void;
  /** Copies a slide's text formatting, as it looks, for Paste Text Style. */
  copyTextStyle(presentationId: string, slideId: string): void;
  pasteTextStyle(presentationId: string, scope: SlideScope): void;
  clearTextStyle(presentationId: string, scope: SlideScope): void;
  /** Sets or (undefined) clears the transition of a slide, a group's slides, or the presentation. */
  setTransition(presentationId: string, scope: SlideScope, transition: SlideTransition | undefined): void;
  /** Slides stop having their own transitions and use the presentation's. */
  clearSlideTransitions(presentationId: string): void;
  /** Every presentation (and its slides) uses the global transition. */
  clearPresentationTransitions(): void;
  copySlides(presentationId: string, slideIds: string[]): void;
  /** Copies slides, then deletes them. */
  cutSlides(presentationId: string, slideIds: string[]): void;
  /** Pastes copied slides after a slide (or at the end); returns the first pasted slide's id. */
  pasteSlides(presentationId: string, afterSlideId: string | null): string | null;

  addToPlaylist(presentationId: string, index?: number, playlistId?: string): void;
  addPlaylistHeader(label: string): void;
  updatePlaylistItem(itemId: string, patch: Partial<{ label: string }>): void;
  movePlaylistItem(from: number, to: number): void;
  removePlaylistItem(itemId: string): void;
  createPlaylist(name: string): void;
  /** Adds a complete playlist (e.g. an imported one), makes it active and returns its id. */
  addPlaylist(name: string, items: PlaylistItem[]): string;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  setActivePlaylist(id: string): void;

  createTheme(from?: Theme): string;
  updateTheme(id: string, patch: Partial<Theme>): void;
  deleteTheme(id: string): void;

  addMediaFiles(files: File[]): Promise<void>;
  deleteMedia(id: string): void;
  updateMedia(id: string, patch: Partial<Pick<MediaItem, 'name' | 'loop'>>): void;

  addBible(meta: BibleMeta): void;
  deleteBible(id: string): void;

  addFonts(fonts: FontMeta[]): void;
  deleteFont(id: string): void;

  setScreensEnabled(kind: ScreenKind, enabled: boolean): void;
  addScreen(kind: ScreenKind): string;
  removeScreen(id: string): void;
  updateScreen(id: string, patch: Partial<ScreenConfig>): void;
  setOutputCount(screenId: string, count: number): void;
  updateOutput(screenId: string, outputId: string, patch: Partial<ScreenOutput>): void;
  setScreenTools(patch: Partial<ScreenTools>): void;

  addMessage(text: string): void;
  updateMessage(id: string, text: string): void;
  deleteMessage(id: string): void;
  showMessage(id: string | null): void;

  updateSettings(patch: Partial<Settings>): void;

  /** Shows a slide, on the slide layer or (for an announcements presentation) the Announcements layer. */
  goLive(presentationId: string, index: number, playlistItemId?: string | null): void;
  /** Auto-advance: the next slide on a layer, back to the first after the last if the presentation loops. */
  advanceLayer(layer: 'slide' | 'announcement'): void;
  playAudio(mediaId: string): void;
  setAudioPaused(paused: boolean): void;
  restartAudio(): void;
  setVideoInput(input: LiveState['videoInput']): void;
  clearLayers(layers: ClearLayer[]): void;
  /** Bible mode: replace the working passage's slides. */
  setBibleDraft(draft: Pick<Presentation, 'title' | 'themeId' | 'groups' | 'arrangement'>): void;
  /** Bible mode: put a slide of the working passage on screen (a copy, so editing the passage doesn't change the screen). */
  showBibleSlide(index: number): void;
  /** Bible mode's arrow keys: the next or previous verse slide. */
  bibleStep(delta: 1 | -1): void;
  /** Saves the working passage as a presentation (and adds it to a playlist). Returns its id. */
  saveBible(init: { title: string; category: Category; playlistId?: string }): string | null;
  /** Appends the working passage's slides to a presentation. */
  copyBibleTo(presentationId: string): void;
  next(): void;
  prev(): void;
  jumpToGroup(letter: string): void;
  setLiveMedia(id: string | null): void;
  toggleLogo(): void;
  clearAll(): void;
  clearSlide(): void;
  clearMedia(): void;
  setMediaPaused(paused: boolean): void;
  restartMedia(): void;
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
    /** Identify Screens and test patterns: operator tools, never saved. */
    screenTools: ScreenTools;
  } & Actions;

const defaultSettings: Settings = {
  transition: DEFAULT_TRANSITION,
  advanceAcrossItems: true,
  defaultThemeId: 'theme-classic',
  gridSize: 220,
  slideView: 'grid',
};

function initialLibrary(): LibraryData {
  const presentations = seedPresentations();
  const playlist = seedPlaylist(presentations);
  return {
    presentations: Object.fromEntries(presentations.map((p) => [p.id, p])),
    themes: defaultThemes,
    playlists: [playlist],
    media: [],
    messages: seedMessages,
    settings: defaultSettings,
    activePlaylistId: playlist.id,
    bibles: [],
    fonts: [],
    screens: defaultScreenSetup(),
  };
}

const emptyLive: LiveState = {
  slide: null,
  mediaId: null,
  logo: false,
  messageId: null,
  stageMessage: null,
  mediaPaused: false,
  mediaRestart: 0,
  audioId: null,
  audioPaused: false,
  audioRestart: 0,
  announcement: null,
  videoInput: null,
};

/** Which live layer a presentation's slides go to: the slide layer, or Announcements. */
export const layerOf = (p: Presentation | undefined) => (p?.destination === 'announcements' ? 'announcement' : 'slide');

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

/** The presentation item before/after `itemId` in whichever playlist holds it. */
export function adjacentPlaylistItem(
  s: LibraryData,
  itemId: string | null | undefined,
  dir: 1 | -1,
): Extract<PlaylistItem, { type: 'presentation' }> | null {
  const items = s.playlists.find((pl) => pl.items.some((it) => it.id === itemId))?.items ?? [];
  let i = items.findIndex((it) => it.id === itemId);
  if (i < 0) return null;
  for (i += dir; i >= 0 && i < items.length; i += dir) {
    const it = items[i];
    if (it.type === 'presentation' && s.presentations[it.presentationId]) return it;
  }
  return null;
}

/** Background cleanup of stored files; a failure only leaves an orphaned file behind. */
const quietly = (p: Promise<unknown>) => void p.catch(() => {});

/** A presentation's groups with new ids, for copying slides into another presentation. */
function cloneGroups(p: Presentation): Pick<Presentation, 'groups' | 'arrangement'> {
  const ids = new Map<string, string>();
  const groups = p.groups.map((g) => {
    const id = uid();
    ids.set(g.id, id);
    return { ...g, id, slides: g.slides.map((sl) => ({ ...structuredClone(sl), id: uid() })) };
  });
  const order = p.arrangement.length ? p.arrangement : p.groups.map((g) => g.id);
  return { groups, arrangement: order.map((id) => ids.get(id)).filter((id): id is string => !!id) };
}

/**
 * Library data from before slide transitions had kinds stored only a length ("transitionMs"):
 * 0 was a cut, anything else a dissolve.
 */
export function upgradeTransitions<T extends Partial<LibraryData>>(data: T): T {
  type Legacy = { transitionMs?: number };
  const settings = data.settings as (Settings & Legacy) | undefined;
  if (settings && !settings.transition) {
    const { transitionMs, ...rest } = settings;
    data.settings = { ...rest, transition: transitionMs == null ? DEFAULT_TRANSITION : fromMs(transitionMs) };
  }
  if (data.presentations)
    for (const [id, p] of Object.entries(data.presentations) as [string, Presentation & Legacy][]) {
      if (p.transitionMs === undefined) continue;
      const { transitionMs, ...rest } = p;
      data.presentations[id] = transitionMs == null || p.transition ? rest : { ...rest, transition: fromMs(transitionMs) };
    }
  return data;
}

/** Carries ids, colors and per-slide edits over to re-parsed groups that keep their names. */
function mergeParsed(p: Presentation, parsed: Pick<Presentation, 'groups' | 'arrangement'>) {
  const old = new Map(p.groups.map((g) => [g.name.toLowerCase(), g]));
  const ids = new Map<string, string>();
  const groups = parsed.groups.map((g) => {
    const prev = old.get(g.name.toLowerCase());
    if (!prev) return g;
    ids.set(g.id, prev.id);
    const slides = g.slides.map((slide, i) => {
      const was = prev.slides[i];
      return was ? { ...slide, id: was.id, style: was.style, background: was.background } : slide;
    });
    return { ...g, id: prev.id, color: prev.color, slides };
  });
  return { groups, arrangement: parsed.arrangement.map((id) => ids.get(id) ?? id) };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const updatePlaylist = (fn: (p: Playlist) => Playlist, playlistId?: string) =>
        set((s) => {
          const target = playlistId ?? activePlaylist(s)?.id;
          return { playlists: s.playlists.map((p) => (p.id === target ? fn(p) : p)) };
        });
      const setGroups = (pid: string, fn: (groups: Group[]) => Group[]) => {
        const p = get().presentations[pid];
        if (p) get().updatePresentation(pid, { groups: fn(p.groups) });
      };
      /** Applies one of the slide operations in src/slideOps.ts to a presentation. */
      const edit = (pid: string, fn: (p: Presentation) => Partial<Presentation>) => {
        const p = get().presentations[pid];
        if (p) get().updatePresentation(pid, fn(p));
      };

      return {
        ...initialLibrary(),
        selectedPresentationId: null,
        selectedPlaylistItemId: null,
        mode: 'show',
        sidebar: 'playlist',
        libraryCategory: 'song',
        editSlideId: null,
        editTextSelected: false,
        editingThemeId: null,
        showMediaBin: true,
        mediaFilter: 'all',
        liveTab: 'messages',
        styleClipboard: null,
        slideClipboard: null,
        dialog: null,
        live: emptyLive,
        timer: initialTimer,
        screenTools: { identify: false, testPattern: null },

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
        setPresentationText: (id, text) => {
          const p = get().presentations[id];
          if (p) get().updatePresentation(id, mergeParsed(p, parseLyrics(text)));
        },
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

        updateSlide: (pid, slideId, patch) =>
          setGroups(pid, (groups) =>
            groups.map((g) =>
              g.slides.some((sl) => sl.id === slideId)
                ? { ...g, slides: g.slides.map((sl) => (sl.id === slideId ? { ...sl, ...patch } : sl)) }
                : g,
            ),
          ),
        updateGroup: (pid, groupId, patch) => setGroups(pid, (groups) => groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g))),
        addSlide: (pid, afterSlideId) => {
          const p = get().presentations[pid];
          if (!p) return null;
          const slide: Slide = { id: uid(), text: '' };
          if (!p.groups.length) {
            const group: Group = { id: uid(), name: 'Verse 1', color: colorForGroup('Verse 1'), slides: [slide] };
            get().updatePresentation(pid, { groups: [group], arrangement: [group.id] });
            return slide.id;
          }
          const gi = p.groups.findIndex((g) => g.slides.some((sl) => sl.id === afterSlideId));
          const target = gi >= 0 ? gi : p.groups.length - 1;
          setGroups(pid, (groups) =>
            groups.map((g, i) => {
              if (i !== target) return g;
              const slides = [...g.slides];
              const at = slides.findIndex((sl) => sl.id === afterSlideId);
              slides.splice(at >= 0 ? at + 1 : slides.length, 0, slide);
              return { ...g, slides };
            }),
          );
          return slide.id;
        },
        duplicateSlide: (pid, slideId) => {
          const id = uid();
          setGroups(pid, (groups) =>
            groups.map((g) => {
              const at = g.slides.findIndex((sl) => sl.id === slideId);
              if (at < 0) return g;
              const slides = [...g.slides];
              slides.splice(at + 1, 0, { ...structuredClone(g.slides[at]), id });
              return { ...g, slides };
            }),
          );
          return id;
        },
        deleteSlide: (pid, slideId) => {
          const p = get().presentations[pid];
          if (!p) return;
          const groups = p.groups.map((g) => ({ ...g, slides: g.slides.filter((sl) => sl.id !== slideId) }));
          const emptied = new Set(groups.filter((g) => g.slides.length === 0).map((g) => g.id));
          get().updatePresentation(pid, {
            groups: groups.filter((g) => !emptied.has(g.id)),
            arrangement: p.arrangement.filter((id) => !emptied.has(id)),
          });
          if (get().editSlideId === slideId) set({ editSlideId: null });
        },
        openEditor: (slideId = null) => set({ mode: 'edit', editSlideId: slideId, editTextSelected: false }),
        assignGroup: (pid, slideId, preset) => edit(pid, (p) => ops.assignGroup(p, slideId, preset)),
        deleteGroup: (pid, groupId) => {
          edit(pid, (p) => ops.deleteGroup(p, groupId));
          const p = get().presentations[pid];
          if (p && !p.groups.some((g) => g.slides.some((sl) => sl.id === get().editSlideId))) set({ editSlideId: null });
        },
        duplicateGroup: (pid, groupId) => edit(pid, (p) => ops.duplicateGroup(p, groupId)),
        setSlideLabel: (pid, slideId, label) => edit(pid, (p) => ops.setLabel(p, slideId, label)),
        copyTextStyle: (pid, slideId) => {
          const s = get();
          const p = s.presentations[pid];
          const slide = p?.groups.flatMap((g) => g.slides).find((sl) => sl.id === slideId);
          if (p && slide) set({ styleClipboard: ops.textStyleOf(applyStyles(resolveTheme(s, p), p.style, slide.style)) });
        },
        pasteTextStyle: (pid, scope) => {
          const style = get().styleClipboard;
          if (style) edit(pid, (p) => ops.pasteTextStyle(p, scope, style));
        },
        clearTextStyle: (pid, scope) => edit(pid, (p) => ops.clearTextStyle(p, scope)),
        setTransition: (pid, scope, transition) => edit(pid, (p) => ops.setTransition(p, scope, transition)),
        clearSlideTransitions: (pid) => edit(pid, (p) => ops.clearSlideTransitions(p)),
        clearPresentationTransitions: () =>
          set((s) => ({
            presentations: Object.fromEntries(
              Object.entries(s.presentations).map(([id, p]) => {
                const own = p.transition || p.groups.some((g) => g.slides.some((sl) => sl.transition));
                return [id, own && !p.hidden ? { ...p, transition: undefined, ...ops.clearSlideTransitions(p), updatedAt: Date.now() } : p];
              }),
            ),
          })),
        copySlides: (pid, slideIds) => {
          const p = get().presentations[pid];
          const slides = p?.groups.flatMap((g) => g.slides).filter((sl) => slideIds.includes(sl.id));
          if (slides?.length) set({ slideClipboard: structuredClone(slides) });
        },
        cutSlides: (pid, slideIds) => {
          get().copySlides(pid, slideIds);
          for (const id of slideIds) get().deleteSlide(pid, id);
        },
        pasteSlides: (pid, afterSlideId) => {
          const slides = get().slideClipboard;
          const p = get().presentations[pid];
          if (!slides?.length || !p) return null;
          const before = new Set(p.groups.flatMap((g) => g.slides.map((sl) => sl.id)));
          get().updatePresentation(pid, ops.insertSlides(p, afterSlideId, slides));
          const after = get().presentations[pid]?.groups.flatMap((g) => g.slides) ?? [];
          return after.find((sl) => !before.has(sl.id))?.id ?? null;
        },

        addToPlaylist: (presentationId, index, playlistId) =>
          updatePlaylist((pl) => {
            const items = [...pl.items];
            items.splice(index ?? items.length, 0, { id: uid(), type: 'presentation', presentationId });
            return { ...pl, items };
          }, playlistId),
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
        addPlaylist: (name, items) => {
          const taken = new Set(get().playlists.map((p) => p.name.toLowerCase()));
          let unique = name;
          for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name} ${n}`;
          const pl: Playlist = { id: uid(), name: unique, items };
          set((s) => ({ playlists: [...s.playlists, pl], activePlaylistId: pl.id, sidebar: 'playlist' }));
          return pl.id;
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
            const kind = file.type.startsWith('video/')
              ? 'video'
              : file.type.startsWith('image/')
                ? 'image'
                : file.type.startsWith('audio/')
                  ? 'audio'
                  : null;
            if (!kind) continue;
            const item: MediaItem = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind, mime: file.type };
            await putMediaBlob(item.id, file);
            added.push(item);
          }
          if (added.length) set((s) => ({ media: [...s.media, ...added] }));
        },
        // The file stays until the next launch (deleteUnusedBlobs), so Undo can bring it back.
        deleteMedia: (id) =>
          set((s) => ({
            media: s.media.filter((m) => m.id !== id),
            live: clearLive(s.live, [
              ...(s.live.mediaId === id ? (['media'] as const) : []),
              ...(s.live.audioId === id ? (['audio'] as const) : []),
            ]),
            settings: s.settings.logoMediaId === id ? { ...s.settings, logoMediaId: undefined } : s.settings,
            themes: s.themes.map((t) =>
              t.background.mediaId === id ? { ...t, background: { ...t.background, type: 'color', mediaId: undefined } } : t,
            ),
          })),

        updateMedia: (id, patch) => set((s) => ({ media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),

        addBible: (meta) =>
          set((s) => {
            // Re-importing the same translation replaces it.
            const replaced = s.bibles.filter((b) => b.abbreviation === meta.abbreviation && b.name === meta.name);
            for (const b of replaced) quietly(deleteBibleText(b.id));
            return { bibles: [...s.bibles.filter((b) => !replaced.includes(b)), meta], settings: { ...s.settings, lastBible: meta.id } };
          }),
        deleteBible: (id) => {
          quietly(deleteBibleText(id));
          set((s) => ({
            bibles: s.bibles.filter((b) => b.id !== id),
            settings: s.settings.lastBible === id ? { ...s.settings, lastBible: undefined } : s.settings,
          }));
        },

        addFonts: (fonts) =>
          set((s) => {
            // Adding the same family/weight/style again replaces the earlier file.
            const same = (a: FontMeta, b: FontMeta) => a.family === b.family && a.weight === b.weight && a.italic === b.italic;
            const replaced = s.fonts.filter((f) => fonts.some((n) => same(f, n)));
            for (const f of replaced) quietly(deleteMediaBlob(f.id));
            return { fonts: [...s.fonts.filter((f) => !replaced.includes(f)), ...fonts] };
          }),
        deleteFont: (id) => {
          quietly(deleteMediaBlob(id));
          set((s) => ({ fonts: s.fonts.filter((f) => f.id !== id) }));
        },

        setScreensEnabled: (kind, enabled) =>
          set((s) => ({ screens: { ...s.screens, [kind === 'audience' ? 'audienceEnabled' : 'stageEnabled']: enabled } })),
        addScreen: (kind) => {
          const screen = newScreen(kind, nextScreenName(get().screens, kind));
          set((s) => ({ screens: { ...s.screens, screens: [...s.screens.screens, screen] } }));
          return screen.id;
        },
        removeScreen: (id) => set((s) => ({ screens: { ...s.screens, screens: s.screens.screens.filter((sc) => sc.id !== id) } })),
        updateScreen: (id, patch) =>
          set((s) => ({ screens: { ...s.screens, screens: s.screens.screens.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)) } })),
        setOutputCount: (screenId, count) => {
          const screen = get().screens.screens.find((sc) => sc.id === screenId);
          if (!screen) return;
          const n = Math.max(1, Math.min(8, Math.round(count)));
          const outputs = screen.outputs.slice(0, n);
          while (outputs.length < n) {
            const prev = outputs[outputs.length - 1];
            const output = newOutput();
            // A new output beside one in a 2 x 1 (etc.) region takes the next region of the same signal.
            if (prev?.target.type === 'grid') {
              output.display = prev.display;
              output.target = { ...prev.target, cell: (prev.target.cell + 1) % (prev.target.cols * prev.target.rows) };
            }
            outputs.push(output);
          }
          get().updateScreen(screenId, { outputs });
        },
        updateOutput: (screenId, outputId, patch) => {
          const screen = get().screens.screens.find((sc) => sc.id === screenId);
          if (screen) get().updateScreen(screenId, { outputs: screen.outputs.map((o) => (o.id === outputId ? { ...o, ...patch } : o)) });
        },
        setScreenTools: (patch) => set((s) => ({ screenTools: { ...s.screenTools, ...patch } })),

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
          set((s) => {
            const ref = { presentationId, index, playlistItemId: playlistItemId ?? undefined };
            return layerOf(s.presentations[presentationId]) === 'announcement'
              ? { live: { ...s.live, announcement: ref } }
              : { live: { ...s.live, logo: false, slide: ref } };
          }),
        advanceLayer: (layer) => {
          const s = get();
          const ref = s.live[layer];
          const p = ref && s.presentations[ref.presentationId];
          if (!ref || !p?.autoAdvance) return;
          const length = getSequence(p).length;
          if (ref.index + 1 < length) s.goLive(p.id, ref.index + 1, ref.playlistItemId);
          else if (p.autoAdvance.loop && length) s.goLive(p.id, 0, ref.playlistItemId);
        },
        playAudio: (mediaId) =>
          set((s) => ({ live: { ...s.live, audioId: mediaId, audioPaused: false, audioRestart: s.live.audioRestart + 1 } })),
        setAudioPaused: (paused) => set((s) => ({ live: { ...s.live, audioPaused: paused } })),
        restartAudio: () => set((s) => ({ live: { ...s.live, audioPaused: false, audioRestart: s.live.audioRestart + 1 } })),
        setVideoInput: (input) => set((s) => ({ live: { ...s.live, videoInput: input } })),
        clearLayers: (layers) => set((s) => ({ live: clearLive(s.live, layers) })),

        setBibleDraft: (draft) =>
          set((s) => ({
            presentations: {
              ...s.presentations,
              [BIBLE_DRAFT_ID]: { ...draft, id: BIBLE_DRAFT_ID, category: 'scripture', hidden: true, updatedAt: Date.now() },
            },
          })),
        showBibleSlide: (index) => {
          const draft = get().presentations[BIBLE_DRAFT_ID];
          if (!draft || index < 0 || index >= getSequence(draft).length) return;
          // Same updatedAt as the draft: that's how Bible mode knows the live copy is this passage.
          set((s) => ({ presentations: { ...s.presentations, [BIBLE_LIVE_ID]: { ...draft, id: BIBLE_LIVE_ID } } }));
          get().goLive(BIBLE_LIVE_ID, index);
        },
        bibleStep: (delta) => {
          const s = get();
          const ref = s.live.slide;
          const live = s.presentations[BIBLE_LIVE_ID];
          if (ref?.presentationId === BIBLE_LIVE_ID && live) {
            const index = ref.index + delta;
            if (index >= 0 && index < getSequence(live).length) s.goLive(BIBLE_LIVE_ID, index);
          } else if (delta > 0) s.showBibleSlide(0);
        },
        saveBible: ({ title, category, playlistId }) => {
          const draft = get().presentations[BIBLE_DRAFT_ID];
          if (!draft) return null;
          const id = get().createPresentation({ title, category, themeId: draft.themeId, ...cloneGroups(draft) });
          if (playlistId) get().addToPlaylist(id, undefined, playlistId);
          return id;
        },
        copyBibleTo: (presentationId) => {
          const s = get();
          const draft = s.presentations[BIBLE_DRAFT_ID];
          const target = s.presentations[presentationId];
          if (!draft || !target) return;
          const copy = cloneGroups(draft);
          s.updatePresentation(presentationId, {
            groups: [...target.groups, ...copy.groups],
            arrangement: [...(target.arrangement.length ? target.arrangement : target.groups.map((g) => g.id)), ...copy.arrangement],
          });
        },
        next: () => {
          const s = get();
          const selected = s.selectedPresentationId;
          // An announcements presentation steps the Announcements layer.
          const ref = s.live[layerOf(selected ? s.presentations[selected] : undefined)];
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
          const selected = s.selectedPresentationId;
          const ref = s.live[layerOf(selected ? s.presentations[selected] : undefined)];
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
          const live = s.live[layerOf(p)];
          const from = live?.presentationId === pid ? live.index : -1;
          const matches = (i: number) => seq[i].indexInGroup === 0 && seq[i].group.name.toLowerCase().startsWith(letter.toLowerCase());
          for (let step = 1; step <= seq.length; step++) {
            const i = (from + step) % seq.length;
            if (matches(i)) return s.goLive(p.id, i, s.selectedPlaylistItemId);
          }
        },
        setLiveMedia: (id) => set((s) => ({ live: { ...s.live, mediaId: id, mediaPaused: false } })),
        toggleLogo: () => set((s) => ({ live: { ...s.live, logo: !s.live.logo } })),
        clearAll: () => get().clearLayers(ALL_LAYERS),
        clearSlide: () => get().clearLayers(['slide']),
        clearMedia: () => get().clearLayers(['media']),
        setMediaPaused: (paused) => set((s) => ({ live: { ...s.live, mediaPaused: paused } })),
        restartMedia: () => set((s) => ({ live: { ...s.live, mediaPaused: false, mediaRestart: s.live.mediaRestart + 1 } })),
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
            ...upgradeTransitions(data),
            bibles: data.bibles ?? [],
            fonts: data.fonts ?? [],
            screens: normalizeScreens(data.screens),
            selectedPresentationId: null,
            selectedPlaylistItemId: null,
            editingThemeId: null,
            live: emptyLive,
          }),
      };
    },
    {
      name: 'lumen-library',
      version: 4,
      migrate: (persisted, version) => {
        const saved = persisted as Partial<LibraryData>;
        const addTheme = (id: string) => {
          const theme = defaultThemes.find((t) => t.id === id);
          if (theme && saved.themes && !saved.themes.some((t) => t.id === id)) saved.themes = [...saved.themes, theme];
        };
        // Version 2 added the Copperplate theme, version 3 the Bible template, version 4 transition kinds.
        if (version < 2) addTheme('theme-copperplate');
        if (version < 3) addTheme('theme-bible');
        if (version < 4) upgradeTransitions(saved);
        return saved as LibraryData;
      },
      // Saved settings from older versions may lack newer keys.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<LibraryData>;
        return {
          ...current,
          ...saved,
          settings: { ...current.settings, ...saved.settings },
          screens: saved.screens ? normalizeScreens(saved.screens) : current.screens,
        };
      },
      partialize: (s): LibraryData => ({
        presentations: s.presentations,
        themes: s.themes,
        playlists: s.playlists,
        media: s.media,
        messages: s.messages,
        settings: s.settings,
        activePlaylistId: s.activePlaylistId,
        bibles: s.bibles,
        fonts: s.fonts,
        screens: s.screens,
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
