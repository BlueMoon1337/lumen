/**
 * Undo and redo for the library: presentations, slides, groups, playlists, themes, messages,
 * media and the settings that shape them. Showing slides, screens, selection and pane sizes
 * aren't edits, so undo leaves them alone.
 *
 * Every store action is one step ("Delete Slide", "Paste Text Style"), however many changes it
 * makes. Typing in a field or dragging a slider makes one step too: repeated edits of the same
 * thing less than a second apart join the step before. `undoBatch` groups several actions.
 */
import { create } from 'zustand';
import { findMessage } from './countdowns';
import { notify } from './notices';
import { useStore, type AppState } from './store';
import type { Presentation, Settings } from './types';
import { isTypingTarget } from './util';

/** The settings undo covers; the rest are preferences (pane sizes, grid size, app icon…). */
const SETTING_KEYS = [
  'transition',
  'mediaTransition',
  'clearGroups',
  'groupPresets',
  'labelPresets',
  'defaultThemeId',
  'logoMediaId',
  'ccliLicense',
] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

type Doc = Pick<
  AppState,
  | 'presentations'
  | 'themes'
  | 'playlists'
  | 'messages'
  | 'media'
  | 'mediaPlaylists'
  | 'audioPlaylists'
  | 'libraries'
  | 'looks'
  | 'stageLayouts'
> & {
  settings: Pick<Settings, SettingKey>;
};

interface Entry {
  label: string;
  /** The library before this step. */
  doc: Doc;
  /** Same key, less than COALESCE_MS later: the edit joins this step. */
  key: string | null;
  time: number;
  /** The action call that made it, so its later changes join it. */
  call: number;
}

const LIMIT = 200;
const COALESCE_MS = 1000;

/** What the toolbar and menus show: the step undo and redo would take. */
export const useHistory = create<{ undo: string | null; redo: string | null }>(() => ({ undo: null, redo: null }));

let undoStack: Entry[] = [];
let redoStack: { label: string; doc: Doc }[] = [];
let depth = 0;
let callSeq = 0;
let current: { label: string; key: string | null; call: number } | null = null;
let applying = false;
let installed = false;
/** An async action's name, for the change it makes when it finishes (importing media). */
let finishing: string | null = null;

const publish = () => useHistory.setState({ undo: undoStack.at(-1)?.label ?? null, redo: redoStack.at(-1)?.label ?? null });

function docOf(s: AppState): Doc {
  return {
    presentations: s.presentations,
    themes: s.themes,
    playlists: s.playlists,
    messages: s.messages,
    media: s.media,
    mediaPlaylists: s.mediaPlaylists,
    audioPlaylists: s.audioPlaylists,
    libraries: s.libraries,
    looks: s.looks,
    stageLayouts: s.stageLayouts,
    settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, s.settings[k]])) as Doc['settings'],
  };
}

const visible = (all: Record<string, Presentation>) => Object.entries(all).filter(([, p]) => !p.hidden);

/** Whether the library changed. Bible mode's working passage (a hidden presentation) doesn't count. */
function docChanged(a: AppState, b: AppState): boolean {
  if (a.themes !== b.themes || a.playlists !== b.playlists || a.messages !== b.messages || a.media !== b.media) return true;
  if (a.mediaPlaylists !== b.mediaPlaylists || a.audioPlaylists !== b.audioPlaylists || a.libraries !== b.libraries) return true;
  if (a.looks !== b.looks || a.stageLayouts !== b.stageLayouts) return true;
  if (SETTING_KEYS.some((k) => a.settings[k] !== b.settings[k])) return true;
  if (a.presentations === b.presentations) return false;
  const before = visible(a.presentations);
  const after = visible(b.presentations);
  return before.length !== after.length || after.some(([id, p]) => a.presentations[id] !== p);
}

/** Presentations whose content differs between two libraries, as `result` has them where it has them. */
function changedPresentations(result: Doc, other: Doc): Presentation[] {
  const ids = new Set([...Object.keys(result.presentations), ...Object.keys(other.presentations)]);
  return [...ids]
    .filter((id) => result.presentations[id] !== other.presentations[id])
    .map((id) => result.presentations[id] ?? other.presentations[id])
    .filter((p) => !p.hidden);
}

/** Puts a library back, keeping the live screen, selection and Bible mode's passage as consistent as it can. */
function restore(doc: Doc) {
  const s = useStore.getState();
  const hidden = Object.entries(s.presentations).filter(([, p]) => p.hidden);
  const presentations = Object.fromEntries([...visible(doc.presentations), ...hidden]);
  const inPlaylist = (id: string | null) => !!id && doc.playlists.some((pl) => pl.items.some((it) => it.id === id));
  const slides = new Set(
    (s.selectedPresentationId ? presentations[s.selectedPresentationId]?.groups : undefined)?.flatMap((g) => g.slides.map((sl) => sl.id)),
  );
  applying = true;
  try {
    useStore.setState({
      presentations,
      themes: doc.themes,
      playlists: doc.playlists,
      messages: doc.messages,
      media: doc.media,
      mediaPlaylists: doc.mediaPlaylists,
      audioPlaylists: doc.audioPlaylists,
      libraries: doc.libraries,
      looks: doc.looks,
      stageLayouts: doc.stageLayouts,
      stageLayoutId: doc.stageLayouts.some((l) => l.id === s.stageLayoutId) ? s.stageLayoutId : (doc.stageLayouts[0]?.id ?? null),
      libraryCategory: doc.libraries.some((l) => l.id === s.libraryCategory) ? s.libraryCategory : doc.libraries[0].id,
      settings: { ...s.settings, ...doc.settings },
      selectedPresentationId: s.selectedPresentationId && presentations[s.selectedPresentationId] ? s.selectedPresentationId : null,
      selectedPlaylistItemId: inPlaylist(s.selectedPlaylistItemId) ? s.selectedPlaylistItemId : null,
      selectedSlideIds: s.selectedSlideIds.filter((id) => slides.has(id)),
      editingThemeId: doc.themes.some((t) => t.id === s.editingThemeId) ? s.editingThemeId : null,
      live: {
        ...s.live,
        slide: s.live.slide && presentations[s.live.slide.presentationId] ? s.live.slide : null,
        mediaId: s.live.mediaId && doc.media.some((m) => m.id === s.live.mediaId) ? s.live.mediaId : null,
        messageId: findMessage(doc.messages, s.live.messageId) ? s.live.messageId : null,
        audioId: s.live.audioId && doc.media.some((m) => m.id === s.live.audioId) ? s.live.audioId : null,
        announcement: s.live.announcement && presentations[s.live.announcement.presentationId] ? s.live.announcement : null,
      },
    });
  } finally {
    applying = false;
  }
}

/** "Delete Slide" → "Delete Slide (Amazing Grace)" when one presentation changed, named as it is now. */
function describe(label: string, result: Doc, other: Doc) {
  const changed = changedPresentations(result, other);
  return changed.length === 1 ? `${label} (${changed[0].title})` : label;
}

export function undo(): string | null {
  const entry = undoStack.pop();
  if (!entry) return null;
  const now = docOf(useStore.getState());
  redoStack.push({ label: entry.label, doc: now });
  restore(entry.doc);
  publish();
  return describe(entry.label, entry.doc, now);
}

export function redo(): string | null {
  const entry = redoStack.pop();
  if (!entry) return null;
  const now = docOf(useStore.getState());
  undoStack.push({ label: entry.label, doc: now, key: null, time: 0, call: -1 });
  restore(entry.doc);
  publish();
  return describe(entry.label, entry.doc, now);
}

/** Undo or redo from a key or menu, saying what changed. Typing in a text field undoes the typing instead. */
export function runHistoryCommand(command: 'undo' | 'redo') {
  if (isTypingTarget(document.activeElement)) {
    document.execCommand(command);
    return;
  }
  const label = command === 'undo' ? undo() : redo();
  if (label) notify(`${command === 'undo' ? 'Undo' : 'Redo'}: ${label}`, 'info', 2500);
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  publish();
}

function onChange(state: AppState, prev: AppState) {
  if (applying || !docChanged(prev, state)) return;
  const now = Date.now();
  const top = undoStack.at(-1);
  if (current && top?.call === current.call) {
    top.time = now;
    return;
  }
  if (current?.key && top?.key === current.key && now - top.time < COALESCE_MS && !redoStack.length) {
    top.time = now;
    top.call = current.call;
    return;
  }
  const label = current?.label ?? finishing ?? 'Change';
  finishing = null;
  undoStack.push({ label, doc: docOf(prev), key: current?.key ?? null, time: now, call: current?.call ?? -1 });
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
  publish();
}

/** Runs `fn` as one step, however many actions it calls. Waits for it when it returns a promise. */
export function undoBatch<T>(label: string, fn: () => T): T {
  const outer = depth === 0;
  if (outer) current = { label, key: null, call: ++callSeq };
  depth++;
  let result: T;
  try {
    result = fn();
  } catch (e) {
    end(outer);
    throw e;
  }
  if (result instanceof Promise) return result.finally(() => end(outer)) as T;
  end(outer);
  return result;
}

function end(outer: boolean) {
  depth--;
  if (outer) current = null;
}

// ---- What each action is called in Edit ▸ Undo ----------------------------------------------

const keysOf = (x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : []);
const has = (patch: unknown, ...keys: string[]) => keys.some((k) => keysOf(patch).includes(k));
/** The label for the first of these fields the patch changes. */
const firstOf = (patch: unknown, labels: [string, string][], otherwise: string) =>
  labels.find(([key]) => has(patch, key))?.[1] ?? otherwise;

const LABELS: Record<string, string | ((args: unknown[]) => string)> = {
  createPresentation: 'New Presentation',
  updatePresentation: ([, patch]) =>
    firstOf(
      patch,
      [
        ['title', 'Rename'],
        ['themeId', 'Theme'],
        ['category', 'Move to Library'],
        ['style', 'Text Style'],
        ['transition', 'Transition'],
        ['destination', 'Destination'],
        ['autoAdvance', 'Auto-Advance'],
        ['groups', 'Edit Slides'],
        ['arrangement', 'Edit Slides'],
      ],
      'Edit Presentation',
    ),
  setPresentationText: 'Reflow',
  addPresentations: 'Import',
  duplicatePresentation: 'Duplicate Presentation',
  deletePresentation: 'Delete Presentation',
  updateSlide: ([, , patch]) =>
    keysOf((patch as { style?: object }).style).every((k) => k === 'inset') && has(patch, 'style')
      ? 'Move Text Box'
      : firstOf(
          patch,
          [
            ['text', 'Edit Text'],
            ['style', 'Text Style'],
            ['background', 'Slide Background'],
            ['caption', 'Caption'],
            ['notes', 'Stage Notes'],
            ['media', 'Slide Media'],
          ],
          'Edit Slide',
        ),
  updateGroup: ([, , patch]) =>
    firstOf(
      patch,
      [
        ['name', 'Rename Group'],
        ['color', 'Group Color'],
      ],
      'Edit Group',
    ),
  addSlide: 'New Slide',
  duplicateSlide: 'Duplicate Slide',
  deleteSlide: 'Delete Slide',
  deleteSlides: ([, ids]) => ((ids as string[]).length === 1 ? 'Delete Slide' : 'Delete Slides'),
  duplicateSlides: ([, ids]) => ((ids as string[]).length === 1 ? 'Duplicate Slide' : 'Duplicate Slides'),
  cutSlides: 'Cut',
  pasteSlides: ([, , options]) => ((options as { matchStyle?: boolean } | undefined)?.matchStyle ? 'Paste and Match Style' : 'Paste'),
  assignGroup: 'Group',
  ungroup: 'Ungroup',
  deleteGroup: 'Delete Group',
  duplicateGroup: 'Duplicate Group',
  setSlideLabel: 'Label',
  setSlideLabels: 'Label',
  pasteTextStyle: 'Paste Text Style',
  clearTextStyle: 'Clear Text Style',
  setTransition: 'Transition',
  clearSlideTransitions: 'Clear Slide Transitions',
  clearPresentationTransitions: 'Clear Presentation Transitions',
  addToPlaylist: 'Add to Playlist',
  addPlaylistHeader: 'Add Header',
  updatePlaylistItem: 'Rename Header',
  movePlaylistItem: 'Move',
  removePlaylistItem: 'Remove from Playlist',
  createPlaylist: 'New Playlist',
  addPlaylist: 'Import Playlist',
  renamePlaylist: 'Rename Playlist',
  deletePlaylist: 'Delete Playlist',
  createLibrary: 'New Library',
  saveLook: 'Save Look',
  deleteLook: 'Delete Look',
  addStageLayout: 'New Layout',
  updateStageLayout: ([, patch]) => firstOf(patch, [['name', 'Rename Layout']], 'Edit Layout'),
  deleteStageLayout: 'Delete Layout',
  addStageObject: 'Add Object',
  updateStageObject: ([, , patch]) =>
    keysOf(patch).every((k) => ['x', 'y', 'width', 'height'].includes(k)) ? 'Move Object' : 'Edit Object',
  deleteStageObject: 'Delete Object',
  restackStageObject: 'Arrange Object',
  renameLibrary: 'Rename Library',
  deleteLibrary: 'Delete Library',
  createTheme: 'New Theme',
  addThemes: 'Import Themes',
  addMedia: 'Import Media',
  updateTheme: 'Edit Theme',
  deleteTheme: 'Delete Theme',
  addMediaFiles: 'Import Media',
  deleteMedia: 'Delete Media',
  updateMedia: ([, patch]) =>
    firstOf(
      patch,
      [
        ['loop', 'Loop'],
        ['playback', 'When Video Ends'],
      ],
      'Rename Media',
    ),
  createMediaPlaylist: 'New Media Playlist',
  renameMediaPlaylist: 'Rename Media Playlist',
  deleteMediaPlaylist: 'Delete Media Playlist',
  addToMediaPlaylist: 'Add to Media Playlist',
  removeFromMediaPlaylist: 'Remove from Media Playlist',
  createAudioPlaylist: 'New Audio Playlist',
  renameAudioPlaylist: 'Rename Audio Playlist',
  deleteAudioPlaylist: 'Delete Audio Playlist',
  addToAudioPlaylist: 'Add to Audio Playlist',
  removeFromAudioPlaylist: 'Remove from Audio Playlist',
  updateAudioPlaylist: 'Audio Playlist Settings',
  addMessage: 'New Message',
  updateMessage: 'Edit Message',
  deleteMessage: 'Delete Message',
  updateSettings: ([patch]) =>
    firstOf(
      patch,
      [
        ['transition', 'Global Transition'],
        ['mediaTransition', 'Media Transition'],
        ['groupPresets', 'Edit Groups'],
        ['labelPresets', 'Edit Labels'],
        ['logoMediaId', 'Logo'],
        ['clearGroups', 'Edit Clear Groups'],
      ],
      'Settings',
    ),
  saveBible: 'Save Passage',
  copyBibleTo: 'Copy Passage',
  importLibrary: 'Import Library',
};

const ASYNC = new Set(['addMediaFiles']);

/** Edits that come one keystroke or slider step at a time, and so join into one step. */
const CONTINUOUS = new Set([
  'updatePresentation',
  'setPresentationText',
  'updateSlide',
  'updateGroup',
  'setSlideLabel',
  'setSlideLabels',
  'setTransition',
  'updatePlaylistItem',
  'renamePlaylist',
  'renameLibrary',
  'updateStageLayout',
  'updateStageObject',
  'updateTheme',
  'updateMedia',
  'updateMessage',
  'updateSettings',
]);

/** Identifies "the same edit": the action, the ids it's given, and which fields it changes. */
function keyOf(name: string, args: unknown[]): string {
  const part = (a: unknown) =>
    typeof a === 'string'
      ? a
      : keysOf(a)
          .map((k) => {
            const v = (a as Record<string, unknown>)[k];
            return typeof v === 'string' && /Id$/.test(k) ? `${k}=${v}` : k;
          })
          .sort()
          .join(',');
  return [name, ...args.map(part)].join('|');
}

/**
 * Starts recording. Each store action is wrapped so that whatever it changes becomes one
 * step; actions it calls along the way are part of that step.
 */
export function installHistory() {
  if (installed) return;
  installed = true;
  const state = useStore.getState() as unknown as Record<string, unknown>;
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(state)) {
    if (typeof value !== 'function') continue;
    const fn = value as (...args: unknown[]) => unknown;
    wrapped[name] = (...args: unknown[]) => {
      if (depth > 0) return fn(...args);
      const label = LABELS[name];
      const text = typeof label === 'function' ? label(args) : (label ?? name);
      // Async actions (importing media) change the library when they finish; other edits made
      // meanwhile stay separate steps.
      if (ASYNC.has(name)) {
        finishing = text;
        return fn(...args);
      }
      return undoBatch(text, () => {
        if (current && CONTINUOUS.has(name)) current.key = keyOf(name, args);
        return fn(...args);
      });
    };
  }
  useStore.setState(wrapped as Partial<AppState>);
  useStore.subscribe(onChange);
}
