import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { deleteBibleText, type BibleMeta } from './bible';
import { BIBLE_DRAFT_ID, BIBLE_LIVE_ID } from './bibleSlides';
import { colorForGroup, getSequence, parseLyrics } from './lyrics';
import { upgradeGroupPresets } from './labels';
import { deleteMediaBlob, putMediaBlob } from './media';
import { defaultScreenSetup, newOutput, newScreen, nextScreenName, normalizeScreens } from './screens';
import { defaultThemes, seedMessages, seedPlaylist, seedPresentations } from './seed';
import * as ops from './slideOps';
import type { SlideScope } from './slideOps';
import { applyStyles, resolveTheme } from './theme';
import { DEFAULT_TRANSITION, fromMs } from './transitions';
import { ALL_LAYERS, clearLive } from './layers';
import { DEFAULT_LOOK, lookScreen } from './looks';
import { DEFAULT_STAGE_LAYOUTS } from './stageLayouts';
import { deckFileOf, isSlideshow, SLIDESHOW_LIBRARY_ID, SLIDESHOW_LIBRARY_NAME } from './slideshows';
import { countdownFade, isCountdownName } from './countdowns';
import type {
  Category,
  Library,
  Look,
  LookScreen,
  StageLayout,
  StageObject,
  MediaPlaylist,
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
  /** The media bin's playlists. */
  mediaPlaylists: MediaPlaylist[];
  /** The Audio tab's playlists. */
  audioPlaylists: MediaPlaylist[];
  /** The libraries presentations are kept in, in sidebar order. */
  libraries: Library[];
  /** Saved looks (Screens ▸ Live), and the one on the screens now. */
  looks: Look[];
  liveLook: Look;
  /** Stage screen layouts (Screens ▸ Edit Layouts…). */
  stageLayouts: StageLayout[];
}

/** The libraries a new Lumen starts with. */
export const DEFAULT_LIBRARIES: Library[] = [
  { id: 'song', name: 'Songs' },
  { id: 'scripture', name: 'Scripture' },
  { id: 'announcement', name: 'Announcements' },
  { id: 'other', name: 'Other' },
  { id: SLIDESHOW_LIBRARY_ID, name: SLIDESHOW_LIBRARY_NAME },
];

/**
 * The libraries, with one added back for any presentation whose library is missing (from an
 * older version, or an imported backup), so no presentation is left out of the sidebar.
 */
export function librariesFor(libraries: Library[] | undefined, presentations: Record<string, Presentation>): Library[] {
  const list = libraries?.length ? [...libraries] : [...DEFAULT_LIBRARIES];
  for (const p of Object.values(presentations)) {
    if (p.hidden || list.some((l) => l.id === p.category)) continue;
    list.push(DEFAULT_LIBRARIES.find((l) => l.id === p.category) ?? { id: p.category, name: p.category || 'Library' });
  }
  return list;
}

export type Mode = 'show' | 'edit' | 'reflow' | 'bible' | 'layouts';
export type LiveTab = 'audio' | 'timers' | 'stage' | 'messages' | 'props';

interface UIState {
  selectedPresentationId: string | null;
  selectedPlaylistItemId: string | null;
  mode: Mode;
  /** Which collection the sidebar item list shows. */
  sidebar: 'library' | 'playlist';
  libraryCategory: Category;
  /**
   * Slides selected in the selected presentation (click, ⌘-click, ⇧-click, Select All), which
   * Edit ▸ Cut, Copy, Duplicate, Delete and the rest act on.
   */
  selectedSlideIds: string[];
  /** Slide selected in Edit mode. */
  editSlideId: string | null;
  /** Whether the slide's text element is selected on the Edit canvas. */
  editTextSelected: boolean;
  editingThemeId: string | null;
  showMediaBin: boolean;
  /** What the media bin shows: its images and videos, a media playlist, or the cameras for the Video Input layer. */
  mediaFilter: 'all' | 'image' | 'video' | 'countdown' | 'playlist' | 'inputs';
  /** The media playlist shown when mediaFilter is "playlist". */
  mediaPlaylistId: string | null;
  liveTab: LiveTab;
  /** Copy Text Style's formatting, for Paste Text Style. */
  styleClipboard: TextStyle | null;
  /** Copied slides, for Paste. */
  slideClipboard: Slide[] | null;
  /** The open window: Settings, Screen Configuration, Groups & Labels, Clear Groups, one of File's, Looks, or Capture Settings. */
  dialog:
    | 'settings'
    | 'screens'
    | 'labels'
    | 'clearGroups'
    | 'textImport'
    | 'slideImages'
    | 'exportThemes'
    | 'looks'
    | 'capture'
    | 'update'
    | 'audioLibrary'
    | null;
  /** The stage layout open in the layout editor, and its selected object. */
  stageLayoutId: string | null;
  stageObjectId: string | null;
}

interface Actions {
  select(presentationId: string | null, playlistItemId?: string | null): void;
  setUI(patch: Partial<UIState>): void;

  createPresentation(init: Partial<Presentation> & { title: string }, text?: string): string;
  updatePresentation(id: string, patch: Partial<Presentation>): void;
  setPresentationText(id: string, text: string): void;
  /** Adds presentations as they are (an imported file's), keeping their ids. */
  addPresentations(list: Presentation[]): void;
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
  /** Ungroup: the slide's group joins the group before it (or, first, becomes unnamed); see ungroup in src/slideOps.ts. */
  ungroup(presentationId: string, slideId: string): void;
  /** Apply to All Slides: the slide's Text Style (as it looks) becomes the presentation's, and no slide keeps its own. */
  applyStyleToAll(presentationId: string, slideId: string): void;
  /** Reset to Theme: the slide looks as `theme` (the presentation's theme) does, whatever the presentation's style. */
  resetSlideStyle(presentationId: string, slideId: string, theme: Theme): void;
  deleteGroup(presentationId: string, groupId: string): void;
  duplicateGroup(presentationId: string, groupId: string): void;
  setSlideLabel(presentationId: string, slideId: string, label: ColorLabel | undefined): void;
  /** One label (or none) on several slides, as one step. */
  setSlideLabels(presentationId: string, slideIds: string[], label: ColorLabel | undefined): void;
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
  /** Duplicates slides, each copy after its slide, and selects the copies; returns their ids. */
  duplicateSlides(presentationId: string, slideIds: string[]): string[];
  deleteSlides(presentationId: string, slideIds: string[]): void;
  /** Copies slides, then deletes them. */
  cutSlides(presentationId: string, slideIds: string[]): void;
  /**
   * Pastes copied slides after a slide (or at the end) and selects them; returns the first
   * pasted slide's id. `matchStyle` drops their own text formatting (Paste and Match Style).
   */
  pasteSlides(presentationId: string, afterSlideId: string | null, options?: { matchStyle?: boolean }): string | null;

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
  /** Adds a library to the sidebar, opens it and returns its id. */
  /** Changes what an audience screen shows in the live look. */
  updateLiveLook(screenId: string, patch: Partial<LookScreen>): void;
  /** Puts a saved look on the screens. */
  triggerLook(id: string): void;
  /** Saves a look as a preset: a new one, or over the one with its id. Returns its id. */
  saveLook(look: Look): string;
  deleteLook(id: string): void;

  addStageLayout(layout: StageLayout): string;
  updateStageLayout(id: string, patch: Partial<Omit<StageLayout, 'id' | 'objects'>>): void;
  deleteStageLayout(id: string): void;
  addStageObject(layoutId: string, object: StageObject): void;
  updateStageObject(layoutId: string, objectId: string, patch: Partial<StageObject>): void;
  deleteStageObject(layoutId: string, objectId: string): void;
  /** Moves an object in front of (1) or behind (-1) the next one, or to the front or back (±Infinity). */
  restackStageObject(layoutId: string, objectId: string, by: number): void;

  createLibrary(name: string): Category;
  renameLibrary(id: Category, name: string): void;
  /** Deletes a library and the presentations in it (they come out of playlists too). One library always stays. */
  deleteLibrary(id: Category): void;
  setActivePlaylist(id: string): void;

  createTheme(from?: Theme): string;
  /** Adds themes as they are (an imported file's), keeping their ids. */
  addThemes(themes: Theme[]): void;
  updateTheme(id: string, patch: Partial<Theme>): void;
  deleteTheme(id: string): void;

  /** Imports images, videos and audio (into a media playlist, if given) and returns what was added. */
  /** `countdown`: the videos are countdowns (imported into the Countdowns tab). */
  addMediaFiles(files: File[], playlistId?: string | null, options?: { countdown?: boolean }): Promise<MediaItem[]>;
  /** Adds media whose files are already stored (from an imported bundle). */
  addMedia(items: MediaItem[]): void;
  deleteMedia(id: string): void;
  updateMedia(id: string, patch: Partial<Pick<MediaItem, 'name' | 'loop' | 'playback' | 'countdown'>>): void;
  createMediaPlaylist(name: string): string;
  renameMediaPlaylist(id: string, name: string): void;
  deleteMediaPlaylist(id: string): void;
  addToMediaPlaylist(playlistId: string, mediaIds: string[]): void;
  removeFromMediaPlaylist(playlistId: string, mediaId: string): void;
  /** Reorders the media bin: `ids` go before `beforeId` (or to the end). */
  moveMedia(ids: string[], beforeId: string | null): void;
  /** Reorders a media playlist: `ids` (already in it) go before `beforeId` (or to the end). */
  moveInMediaPlaylist(playlistId: string, ids: string[], beforeId: string | null): void;
  createAudioPlaylist(name: string): string;
  renameAudioPlaylist(id: string, name: string): void;
  deleteAudioPlaylist(id: string): void;
  /** Adds tracks to an audio playlist, before `before` (or at the end); tracks already in it move there. */
  addToAudioPlaylist(playlistId: string, mediaIds: string[], before?: string | null): void;
  removeFromAudioPlaylist(playlistId: string, mediaId: string): void;
  updateAudioPlaylist(id: string, patch: Partial<Pick<MediaPlaylist, 'loop'>>): void;

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

  /** Adds a message; returns its id. */
  addMessage(text: string): string;
  updateMessage(id: string, text: string): void;
  deleteMessage(id: string): void;
  showMessage(id: string | null): void;

  updateSettings(patch: Partial<Settings>): void;

  /** Shows a slide, on the slide layer or (for an announcements presentation) the Announcements layer. */
  goLive(presentationId: string, index: number, playlistItemId?: string | null): void;
  /** Auto-advance: the next slide on a layer, back to the first after the last if the presentation loops. */
  advanceLayer(layer: 'slide' | 'announcement'): void;
  /** Plays a track on the Audio layer; from an audio playlist, its next track follows. */
  playAudio(mediaId: string, playlistId?: string | null): void;
  /** The track ended: the next one in its playlist plays, or the Audio layer clears. */
  audioEnded(): void;
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
  /** Media on the Media layer; `from` is the media playlist it was chosen in, for "play the next one". */
  setLiveMedia(id: string | null, from?: string | null): void;
  seekMedia(seconds: number): void;
  /** The live video ended: loop, stop, clear or play the next, as the video says. */
  mediaEnded(): void;
  toggleLogo(): void;
  /** Presentation ▸ Clear to Logo: everything off the screens but the logo. */
  clearToLogo(): void;
  /** Presentation ▸ Next / Previous Background: the next or previous image or video, in its media playlist or the media bin. */
  stepMedia(delta: 1 | -1): void;
  /** Presentation ▸ Show Slide on Stage Screens Only. */
  showOnStage(presentationId: string, index: number): void;
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
    mediaPlaylists: [],
    audioPlaylists: [],
    libraries: DEFAULT_LIBRARIES,
    looks: [DEFAULT_LOOK],
    liveLook: DEFAULT_LOOK,
    stageLayouts: DEFAULT_STAGE_LAYOUTS,
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
  mediaSeek: { to: 0, n: 0 },
  mediaFrom: null,
  audioId: null,
  audioPaused: false,
  audioRestart: 0,
  audioFrom: null,
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

let timerEnd: ReturnType<typeof setTimeout> | undefined;

/**
 * The Timers tab's countdown stops at 0:00 (no overtime) and goes back to its length, ready to
 * start again. Music it's fading out (Countdown Fade) goes with it.
 */
function whenTimerEnds(endsAt: number | null) {
  clearTimeout(timerEnd);
  timerEnd = undefined;
  if (endsAt == null) return;
  timerEnd = setTimeout(
    () => {
      const s = useStore.getState();
      if (!s.timer.running || s.timer.endsAt !== endsAt) return;
      if (Date.now() < endsAt) return whenTimerEnds(endsAt);
      // Back to its length, ready to start again; the stage shows 0:00 for a moment (shownTimer).
      useStore.setState({ timer: { ...s.timer, running: false, endsAt: null, remainingMs: s.timer.durationMs, endedAt: Date.now() } });
      if (countdownFade(s.settings).timer && s.live.audioId) s.clearLayers(['audio']);
    },
    Math.max(0, endsAt - Date.now()),
  );
}

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
const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
};

/** A file's type from its name, for files the system gave no type. */
export const mimeFromName = (name: string) => MIME_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';

/** The video or image after `id`: in its media playlist if it was started from one, else in the media bin. */
/** The track after `id` in an audio playlist (back to the first if it loops), or null after its last. */
/** The list with the items whose keys are `ids` moved, in their order, before `beforeId` (or to the end). */
export function moveBefore<T>(list: T[], key: (x: T) => string, ids: string[], beforeId: string | null): T[] {
  const moving = list.filter((x) => ids.includes(key(x)));
  if (!moving.length || (beforeId !== null && ids.includes(beforeId))) return list;
  const rest = list.filter((x) => !ids.includes(key(x)));
  const at = beforeId === null ? -1 : rest.findIndex((x) => key(x) === beforeId);
  return at < 0 ? [...rest, ...moving] : [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * A new slide (a text slide with nothing on it yet): the editor opens with its text box selected,
 * its eight handles showing, ready to type into or size.
 */
export function isNewSlide(s: Pick<AppState, 'presentations'>, slideId: string | null): boolean {
  if (!slideId) return false;
  for (const p of Object.values(s.presentations))
    for (const g of p.groups) {
      const slide = g.slides.find((sl) => sl.id === slideId);
      if (slide) return !slide.text && !slide.source && !slide.media;
    }
  return false;
}

export function nextAudio(s: Pick<LibraryData, 'media' | 'audioPlaylists'>, id: string, playlistId: string | null): string | null {
  const pl = s.audioPlaylists.find((x) => x.id === playlistId);
  if (!pl) return null;
  const audio = new Set(s.media.filter((m) => m.kind === 'audio').map((m) => m.id));
  const order = pl.items.filter((x) => audio.has(x));
  if (!order.length) return null;
  const at = order.indexOf(id);
  if (at + 1 < order.length) return order[at + 1];
  return pl.loop ? order[0] : null;
}

export function nextMedia(s: Pick<LibraryData, 'media' | 'mediaPlaylists'>, id: string, playlistId: string | null): string | null {
  const visual = new Set(s.media.filter((m) => m.kind !== 'audio').map((m) => m.id));
  const order = (s.mediaPlaylists.find((pl) => pl.id === playlistId)?.items ?? s.media.map((m) => m.id)).filter((x) => visual.has(x));
  const at = order.indexOf(id);
  return at >= 0 && at + 1 < order.length ? order[at + 1] : null;
}

function mergeParsed(p: Presentation, parsed: Pick<Presentation, 'groups' | 'arrangement'>) {
  const old = new Map(p.groups.map((g) => [g.name.toLowerCase(), g]));
  const ids = new Map<string, string>();
  const groups = parsed.groups.map((g) => {
    const prev = old.get(g.name.toLowerCase());
    if (!prev) return g;
    ids.set(g.id, prev.id);
    const slides = g.slides.map((slide, i) => {
      const was = prev.slides[i];
      // Everything about a slide but its words survives reflowing.
      return was
        ? {
            ...slide,
            id: was.id,
            style: was.style,
            background: was.background,
            label: was.label,
            transition: was.transition,
            media: was.media,
          }
        : slide;
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
      /** PowerPoint and Keynote presentations: their slides are pictures, which Reflow's text would replace. */
      const pictures = (pid: string | null) => !!pid && isSlideshow(get().presentations[pid]);

      return {
        ...initialLibrary(),
        selectedPresentationId: null,
        selectedPlaylistItemId: null,
        selectedSlideIds: [],
        stageLayoutId: null,
        stageObjectId: null,
        mode: 'show',
        sidebar: 'playlist',
        libraryCategory: 'song',
        editSlideId: null,
        editTextSelected: false,
        editingThemeId: null,
        showMediaBin: true,
        mediaFilter: 'all',
        mediaPlaylistId: null,
        liveTab: 'audio',
        styleClipboard: null,
        slideClipboard: null,
        dialog: null,
        live: emptyLive,
        timer: initialTimer,
        screenTools: { identify: false, testPattern: null },

        select: (presentationId, playlistItemId = null) =>
          set((s) => ({
            selectedPresentationId: presentationId,
            selectedPlaylistItemId: playlistItemId,
            selectedSlideIds: s.selectedPresentationId === presentationId ? s.selectedSlideIds : [],
          })),
        setUI: (patch) => set(patch),

        createPresentation: (init, text = '') => {
          const id = uid();
          const p: Presentation = {
            category: get().libraries[0]?.id ?? 'song',
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
        addPresentations: (list) =>
          set((s) => ({ presentations: { ...s.presentations, ...Object.fromEntries(list.map((p) => [p.id, p])) } })),
        setPresentationText: (id, text) => {
          const p = get().presentations[id];
          if (p && !pictures(id)) get().updatePresentation(id, mergeParsed(p, parseLyrics(text)));
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
              selectedPlaylistItemId: s.selectedPresentationId === id ? null : s.selectedPlaylistItemId,
              live: clearLive(s.live, [
                ...(s.live.slide?.presentationId === id ? (['slide'] as const) : []),
                ...(s.live.announcement?.presentationId === id ? (['announcements'] as const) : []),
              ]),
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
          // It takes the Text Style of the slide it follows (the last one, added at the end), so it
          // looks like the rest of the song.
          const before = p.groups[target].slides.find((sl) => sl.id === afterSlideId) ?? p.groups[target].slides.at(-1);
          if (before?.style) slide.style = structuredClone(before.style);
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
          if (get().selectedSlideIds.includes(slideId))
            set((s) => ({ selectedSlideIds: s.selectedSlideIds.filter((id) => id !== slideId) }));
        },
        openEditor: (slideId = null) =>
          set((s) => ({
            mode: 'edit',
            editSlideId: slideId,
            editTextSelected: isNewSlide(s, slideId),
            selectedSlideIds: slideId ? [slideId] : [],
          })),
        assignGroup: (pid, slideId, preset) => edit(pid, (p) => ops.assignGroup(p, slideId, preset)),
        ungroup: (pid, slideId) => edit(pid, (p) => ops.ungroup(p, slideId)),
        applyStyleToAll: (pid, slideId) =>
          edit(pid, (p) => {
            const slide = p.groups.flatMap((g) => g.slides).find((sl) => sl.id === slideId);
            const style = { ...p.style, ...slide?.style };
            return {
              style: Object.keys(style).length ? style : undefined,
              groups: p.groups.map((g) =>
                g.slides.some((sl) => sl.style) ? { ...g, slides: g.slides.map(({ style: _own, ...sl }) => sl) } : g,
              ),
            };
          }),
        resetSlideStyle: (pid, slideId, theme) => {
          const p = get().presentations[pid];
          if (!p) return;
          // Over the presentation's own style, the slide puts back the theme's values for what it sets.
          const back = Object.fromEntries(Object.keys(p.style ?? {}).map((k) => [k, structuredClone(theme[k as keyof TextStyle])]));
          get().updateSlide(pid, slideId, { style: Object.keys(back).length ? (back as TextStyle) : undefined });
        },
        deleteGroup: (pid, groupId) => {
          edit(pid, (p) => ops.deleteGroup(p, groupId));
          const p = get().presentations[pid];
          if (p && !p.groups.some((g) => g.slides.some((sl) => sl.id === get().editSlideId))) set({ editSlideId: null });
        },
        duplicateGroup: (pid, groupId) => edit(pid, (p) => ops.duplicateGroup(p, groupId)),
        setSlideLabel: (pid, slideId, label) => edit(pid, (p) => ops.setLabel(p, slideId, label)),
        setSlideLabels: (pid, slideIds, label) => edit(pid, (p) => ops.setLabels(p, slideIds, label)),
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
          const slides = p?.groups
            .flatMap((g) => g.slides)
            .filter((sl) => slideIds.includes(sl.id))
            // A PowerPoint slide takes its file along, so it can be edited wherever it's pasted.
            .map((sl) =>
              sl.source && !sl.source.file && deckFileOf(p, sl) ? { ...sl, source: { ...sl.source, file: deckFileOf(p, sl) } } : sl,
            );
          if (slides?.length) set({ slideClipboard: structuredClone(slides) });
        },
        cutSlides: (pid, slideIds) => {
          get().copySlides(pid, slideIds);
          get().deleteSlides(pid, slideIds);
        },
        pasteSlides: (pid, afterSlideId, options) => {
          const copied = get().slideClipboard;
          const p = get().presentations[pid];
          if (!copied?.length || !p) return null;
          const slides = options?.matchStyle ? ops.matchStyle(copied) : copied;
          const before = new Set(p.groups.flatMap((g) => g.slides.map((sl) => sl.id)));
          get().updatePresentation(pid, ops.insertSlides(p, afterSlideId, slides));
          const pasted = (get().presentations[pid]?.groups.flatMap((g) => g.slides) ?? []).filter((sl) => !before.has(sl.id));
          set({ selectedSlideIds: pasted.map((sl) => sl.id) });
          return pasted[0]?.id ?? null;
        },
        duplicateSlides: (pid, slideIds) => {
          const copies = slideIds.map((id) => get().duplicateSlide(pid, id)).filter((id): id is string => !!id);
          set({ selectedSlideIds: copies });
          return copies;
        },
        deleteSlides: (pid, slideIds) => {
          for (const id of slideIds) get().deleteSlide(pid, id);
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

        updateLiveLook: (screenId, patch) =>
          set((s) => ({
            liveLook: { ...s.liveLook, screens: { ...s.liveLook.screens, [screenId]: { ...lookScreen(s.liveLook, screenId), ...patch } } },
          })),
        triggerLook: (id) =>
          set((s) => {
            const look = s.looks.find((l) => l.id === id);
            return look ? { liveLook: structuredClone(look) } : {};
          }),
        saveLook: (look) => {
          const saved = { ...structuredClone(look), id: look.id && get().looks.some((l) => l.id === look.id) ? look.id : uid() };
          set((s) => ({
            looks: s.looks.some((l) => l.id === saved.id) ? s.looks.map((l) => (l.id === saved.id ? saved : l)) : [...s.looks, saved],
            // The live look keeps the name of the preset it now is.
            liveLook:
              s.liveLook.id === saved.id || s.liveLook.id === look.id ? { ...s.liveLook, id: saved.id, name: saved.name } : s.liveLook,
          }));
          return saved.id;
        },
        deleteLook: (id) => set((s) => (s.looks.length > 1 ? { looks: s.looks.filter((l) => l.id !== id) } : {})),

        addStageLayout: (layout) => {
          const added = { ...structuredClone(layout), id: uid() };
          set((s) => ({ stageLayouts: [...s.stageLayouts, added], stageLayoutId: added.id, stageObjectId: null }));
          return added.id;
        },
        updateStageLayout: (id, patch) => set((s) => ({ stageLayouts: s.stageLayouts.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
        deleteStageLayout: (id) =>
          set((s) => {
            if (s.stageLayouts.length <= 1) return {};
            const stageLayouts = s.stageLayouts.filter((l) => l.id !== id);
            return {
              stageLayouts,
              stageLayoutId: s.stageLayoutId === id ? stageLayouts[0].id : s.stageLayoutId,
              screens: {
                ...s.screens,
                screens: s.screens.screens.map((sc) => (sc.stageLayoutId === id ? { ...sc, stageLayoutId: undefined } : sc)),
              },
            };
          }),
        addStageObject: (layoutId, object) =>
          set((s) => ({
            stageLayouts: s.stageLayouts.map((l) => (l.id === layoutId ? { ...l, objects: [...l.objects, object] } : l)),
            stageObjectId: object.id,
          })),
        updateStageObject: (layoutId, objectId, patch) =>
          set((s) => ({
            stageLayouts: s.stageLayouts.map((l) =>
              l.id === layoutId ? { ...l, objects: l.objects.map((o) => (o.id === objectId ? { ...o, ...patch } : o)) } : l,
            ),
          })),
        deleteStageObject: (layoutId, objectId) =>
          set((s) => ({
            stageLayouts: s.stageLayouts.map((l) =>
              l.id === layoutId ? { ...l, objects: l.objects.filter((o) => o.id !== objectId) } : l,
            ),
            stageObjectId: s.stageObjectId === objectId ? null : s.stageObjectId,
          })),
        restackStageObject: (layoutId, objectId, by) =>
          set((s) => ({
            stageLayouts: s.stageLayouts.map((l) => {
              if (l.id !== layoutId) return l;
              const objects = [...l.objects];
              const at = objects.findIndex((o) => o.id === objectId);
              if (at < 0) return l;
              const [o] = objects.splice(at, 1);
              objects.splice(Math.max(0, Math.min(objects.length, at + by)), 0, o);
              return { ...l, objects };
            }),
          })),

        createLibrary: (name) => {
          const library: Library = { id: uid(), name };
          set((s) => ({ libraries: [...s.libraries, library], sidebar: 'library', libraryCategory: library.id }));
          return library.id;
        },
        renameLibrary: (id, name) => set((s) => ({ libraries: s.libraries.map((l) => (l.id === id ? { ...l, name } : l)) })),
        deleteLibrary: (id) => {
          const s = get();
          if (s.libraries.length <= 1 || !s.libraries.some((l) => l.id === id)) return;
          for (const p of Object.values(s.presentations)) if (p.category === id && !p.hidden) get().deletePresentation(p.id);
          set((st) => {
            const libraries = st.libraries.filter((l) => l.id !== id);
            const at = st.libraries.findIndex((l) => l.id === id);
            const next = libraries[Math.min(at, libraries.length - 1)].id;
            return {
              libraries,
              libraryCategory: st.libraryCategory === id ? next : st.libraryCategory,
              settings:
                st.settings.bible?.library === id ? { ...st.settings, bible: { ...st.settings.bible, library: next } } : st.settings,
            };
          });
        },

        createTheme: (from) => {
          const base = from ?? get().themes[0] ?? defaultThemes[0];
          const theme: Theme = { ...structuredClone(base), id: uid(), name: from ? `${from.name} (copy)` : 'New Theme' };
          set((s) => ({ themes: [...s.themes, theme], editingThemeId: theme.id }));
          return theme.id;
        },
        addThemes: (themes) => set((s) => ({ themes: [...s.themes, ...themes.filter((t) => !s.themes.some((x) => x.id === t.id))] })),
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

        addMediaFiles: async (files, playlistId, options) => {
          const added: MediaItem[] = [];
          for (const file of files) {
            // Some systems give no type for .mp4, .mov or .m4v files; go by the name then.
            const mime = file.type || mimeFromName(file.name);
            const kind = mime.startsWith('video/')
              ? 'video'
              : mime.startsWith('image/')
                ? 'image'
                : mime.startsWith('audio/')
                  ? 'audio'
                  : null;
            if (!kind) continue;
            const item: MediaItem = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), kind, mime: mime || file.type };
            // Countdowns (imported into their tab, or named like one) hold their last frame rather than loop.
            if (kind === 'video' && (options?.countdown || isCountdownName(item.name)))
              Object.assign(item, { countdown: true, playback: 'stop' });
            await putMediaBlob(item.id, file);
            added.push(item);
          }
          if (added.length) set((s) => ({ media: [...s.media, ...added] }));
          if (added.length && playlistId)
            get().addToMediaPlaylist(
              playlistId,
              added.filter((m) => m.kind !== 'audio').map((m) => m.id),
            );
          return added;
        },
        addMedia: (items) => set((s) => ({ media: [...s.media, ...items.filter((m) => !s.media.some((x) => x.id === m.id))] })),
        // The file stays until the next launch (deleteUnusedBlobs), so Undo can bring it back.
        deleteMedia: (id) =>
          set((s) => ({
            media: s.media.filter((m) => m.id !== id),
            mediaPlaylists: s.mediaPlaylists.map((pl) => (pl.items.includes(id) ? { ...pl, items: pl.items.filter((x) => x !== id) } : pl)),
            audioPlaylists: s.audioPlaylists.map((pl) => (pl.items.includes(id) ? { ...pl, items: pl.items.filter((x) => x !== id) } : pl)),
            presentations: Object.fromEntries(
              Object.entries(s.presentations).map(([pid, p]) => [
                pid,
                p.groups.some((g) => g.slides.some((sl) => sl.media === id || sl.background?.mediaId === id))
                  ? {
                      ...p,
                      groups: p.groups.map((g) => ({
                        ...g,
                        slides: g.slides.map((sl) => ({
                          ...sl,
                          media: sl.media === id ? undefined : sl.media,
                          // A slide whose background was this goes back to its theme's.
                          background: sl.background?.mediaId === id ? undefined : sl.background,
                        })),
                      })),
                    }
                  : p,
              ]),
            ),
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
        createMediaPlaylist: (name) => {
          const pl: MediaPlaylist = { id: uid(), name, items: [] };
          set((s) => ({ mediaPlaylists: [...s.mediaPlaylists, pl], mediaFilter: 'playlist', mediaPlaylistId: pl.id }));
          return pl.id;
        },
        renameMediaPlaylist: (id, name) =>
          set((s) => ({ mediaPlaylists: s.mediaPlaylists.map((pl) => (pl.id === id ? { ...pl, name } : pl)) })),
        deleteMediaPlaylist: (id) =>
          set((s) => ({
            mediaPlaylists: s.mediaPlaylists.filter((pl) => pl.id !== id),
            ...(s.mediaPlaylistId === id ? { mediaPlaylistId: null, mediaFilter: 'all' as const } : {}),
          })),
        addToMediaPlaylist: (playlistId, mediaIds) =>
          set((s) => ({
            mediaPlaylists: s.mediaPlaylists.map((pl) =>
              pl.id === playlistId ? { ...pl, items: [...pl.items, ...mediaIds.filter((id) => !pl.items.includes(id))] } : pl,
            ),
          })),
        moveMedia: (ids, beforeId) => set((s) => ({ media: moveBefore(s.media, (m) => m.id, ids, beforeId) })),
        moveInMediaPlaylist: (playlistId, ids, beforeId) =>
          set((s) => ({
            mediaPlaylists: s.mediaPlaylists.map((pl) =>
              pl.id === playlistId ? { ...pl, items: moveBefore(pl.items, (x) => x, ids, beforeId) } : pl,
            ),
          })),
        removeFromMediaPlaylist: (playlistId, mediaId) =>
          set((s) => ({
            mediaPlaylists: s.mediaPlaylists.map((pl) =>
              pl.id === playlistId ? { ...pl, items: pl.items.filter((x) => x !== mediaId) } : pl,
            ),
          })),

        createAudioPlaylist: (name) => {
          const pl: MediaPlaylist = { id: uid(), name, items: [] };
          set((s) => ({ audioPlaylists: [...s.audioPlaylists, pl] }));
          return pl.id;
        },
        renameAudioPlaylist: (id, name) =>
          set((s) => ({ audioPlaylists: s.audioPlaylists.map((pl) => (pl.id === id ? { ...pl, name } : pl)) })),
        deleteAudioPlaylist: (id) =>
          set((s) => ({
            audioPlaylists: s.audioPlaylists.filter((pl) => pl.id !== id),
            live: s.live.audioFrom === id ? { ...s.live, audioFrom: null } : s.live,
          })),
        addToAudioPlaylist: (playlistId, mediaIds, before) =>
          set((s) => {
            const audio = new Set(s.media.filter((m) => m.kind === 'audio').map((m) => m.id));
            const adding = [...new Set(mediaIds)].filter((id) => audio.has(id));
            return {
              audioPlaylists: s.audioPlaylists.map((pl) => {
                if (pl.id !== playlistId) return pl;
                const rest = pl.items.filter((x) => !adding.includes(x));
                const at = before ? rest.indexOf(before) : -1;
                return { ...pl, items: at < 0 ? [...rest, ...adding] : [...rest.slice(0, at), ...adding, ...rest.slice(at)] };
              }),
            };
          }),
        removeFromAudioPlaylist: (playlistId, mediaId) =>
          set((s) => ({
            audioPlaylists: s.audioPlaylists.map((pl) =>
              pl.id === playlistId ? { ...pl, items: pl.items.filter((x) => x !== mediaId) } : pl,
            ),
          })),
        updateAudioPlaylist: (id, patch) =>
          set((s) => ({ audioPlaylists: s.audioPlaylists.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)) })),

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

        addMessage: (text) => {
          const id = uid();
          set((s) => ({ messages: [...s.messages, { id, text }] }));
          return id;
        },
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
            const p = s.presentations[presentationId];
            const ref = { presentationId, index, playlistItemId: playlistItemId ?? undefined };
            let live =
              layerOf(p) === 'announcement' ? { ...s.live, announcement: ref } : { ...s.live, logo: false, slide: ref, stageSlide: null };
            // A slide with a media cue starts its media on the Media layer (unless it's already playing).
            const cue = p ? getSequence(p)[index]?.slide.media : undefined;
            if (cue && cue !== s.live.mediaId && s.media.some((m) => m.id === cue))
              live = { ...live, mediaId: cue, mediaPaused: false, mediaFrom: null, mediaSeek: { to: 0, n: s.live.mediaSeek.n } };
            return { live };
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
        playAudio: (mediaId, playlistId = null) =>
          set((s) => ({
            live: { ...s.live, audioId: mediaId, audioPaused: false, audioRestart: s.live.audioRestart + 1, audioFrom: playlistId },
          })),
        audioEnded: () => {
          const s = get();
          const next = s.live.audioId ? nextAudio(s, s.live.audioId, s.live.audioFrom) : null;
          if (next) s.playAudio(next, s.live.audioFrom);
          else s.clearLayers(['audio']);
        },
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
          // The library chosen may have been deleted since.
          const { libraries } = get();
          const library = libraries.some((l) => l.id === category)
            ? category
            : (libraries.find((l) => l.id === 'scripture') ?? libraries[0]).id;
          const id = get().createPresentation({ title, category: library, themeId: draft.themeId, ...cloneGroups(draft) });
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
        setLiveMedia: (id, from = null) =>
          set((s) => ({
            live: { ...s.live, mediaId: id, mediaPaused: false, mediaFrom: id ? from : null, mediaSeek: { to: 0, n: s.live.mediaSeek.n } },
          })),
        seekMedia: (seconds) => set((s) => ({ live: { ...s.live, mediaSeek: { to: Math.max(0, seconds), n: s.live.mediaSeek.n + 1 } } })),
        mediaEnded: () => {
          const s = get();
          const item = s.media.find((m) => m.id === s.live.mediaId);
          if (!item || item.kind !== 'video') return;
          if (item.playback === 'clear') s.clearLayers(['media']);
          if (item.playback === 'next') {
            const next = nextMedia(s, item.id, s.live.mediaFrom);
            if (next) s.setLiveMedia(next, s.live.mediaFrom);
            else s.clearLayers(['media']);
          }
        },
        toggleLogo: () => set((s) => ({ live: { ...s.live, logo: !s.live.logo } })),
        clearToLogo: () => set((s) => ({ live: { ...clearLive(s.live, ALL_LAYERS), logo: !!s.settings.logoMediaId } })),
        stepMedia: (delta) => {
          const s = get();
          const visual = new Set(s.media.filter((m) => m.kind !== 'audio').map((m) => m.id));
          const from = s.live.mediaId ? s.live.mediaFrom : s.mediaFilter === 'playlist' ? s.mediaPlaylistId : null;
          const order = (s.mediaPlaylists.find((pl) => pl.id === from)?.items ?? s.media.map((m) => m.id)).filter((id) => visual.has(id));
          if (!order.length) return;
          const at = s.live.mediaId ? order.indexOf(s.live.mediaId) : -1;
          const next = at < 0 ? (delta > 0 ? 0 : order.length - 1) : at + delta;
          if (next >= 0 && next < order.length) s.setLiveMedia(order[next], from);
        },
        showOnStage: (presentationId, index) => set((s) => ({ live: { ...s.live, stageSlide: { presentationId, index } } })),
        clearAll: () => get().clearLayers(ALL_LAYERS),
        clearSlide: () => get().clearLayers(['slide']),
        clearMedia: () => get().clearLayers(['media']),
        setMediaPaused: (paused) => set((s) => ({ live: { ...s.live, mediaPaused: paused } })),
        restartMedia: () => set((s) => ({ live: { ...s.live, mediaPaused: false, mediaRestart: s.live.mediaRestart + 1 } })),
        setStageMessage: (text) => set((s) => ({ live: { ...s.live, stageMessage: text } })),

        setTimer: (patch) =>
          set((s) => {
            const timer = { ...s.timer, ...patch, endedAt: null };
            if (!timer.running) timer.remainingMs = timer.durationMs;
            return { timer };
          }),
        startTimer: () => {
          set((s) => {
            if (s.timer.running) return {};
            const now = Date.now();
            const endsAt = s.timer.mode === 'toTime' ? nextOccurrence(s.timer.targetTime, now) : now + s.timer.remainingMs;
            return { timer: { ...s.timer, running: true, endsAt, endedAt: null } };
          });
          whenTimerEnds(get().timer.endsAt);
        },
        pauseTimer: () => {
          set((s) => {
            if (!s.timer.running || s.timer.endsAt == null) return {};
            return { timer: { ...s.timer, running: false, endsAt: null, remainingMs: Math.max(0, s.timer.endsAt - Date.now()) } };
          });
          whenTimerEnds(null);
        },
        resetTimer: () => {
          set((s) => ({ timer: { ...s.timer, running: false, endsAt: null, remainingMs: s.timer.durationMs, endedAt: null } }));
          whenTimerEnds(null);
        },

        importLibrary: (data) =>
          set({
            ...upgradeTransitions(data),
            bibles: data.bibles ?? [],
            mediaPlaylists: data.mediaPlaylists ?? [],
            audioPlaylists: data.audioPlaylists ?? [],
            libraries: librariesFor(data.libraries, data.presentations),
            looks: data.looks?.length ? data.looks : [DEFAULT_LOOK],
            liveLook: data.liveLook ?? DEFAULT_LOOK,
            stageLayouts: data.stageLayouts?.length ? data.stageLayouts : DEFAULT_STAGE_LAYOUTS,
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
      version: 8,
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
        // Version 5 made libraries a list that can grow (New Library).
        if (version < 5) saved.libraries = librariesFor(saved.libraries, saved.presentations ?? {});
        // Version 6 added the PowerPoint & Keynote library, where those presentations are imported.
        if (version < 6 && saved.libraries && !saved.libraries.some((l) => l.id === SLIDESHOW_LIBRARY_ID))
          saved.libraries = [...saved.libraries, { id: SLIDESHOW_LIBRARY_ID, name: SLIDESHOW_LIBRARY_NAME }];
        // Version 8 put countdown videos (by their names) in the media bin's Countdowns tab.
        if (version < 8 && saved.media)
          saved.media = saved.media.map((m) =>
            m.kind === 'video' && m.countdown === undefined && isCountdownName(m.name) ? { ...m, countdown: true } : m,
          );
        // Version 7 matched the group list (and colors) to ProPresenter's.
        if (version < 7 && saved.settings?.groupPresets)
          saved.settings = { ...saved.settings, groupPresets: upgradeGroupPresets(saved.settings.groupPresets) };
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
        mediaPlaylists: s.mediaPlaylists,
        audioPlaylists: s.audioPlaylists,
        libraries: s.libraries,
        looks: s.looks,
        liveLook: s.liveLook,
        stageLayouts: s.stageLayouts,
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
