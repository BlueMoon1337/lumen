/**
 * Lumen's own files, written by File ▸ Export and read by File ▸ Import ▸ File…:
 *
 *   .lumen          a presentation, with the theme it uses
 *   .lumenbundle    the same, zipped with the images and videos its slides use
 *   .lumenplaylist  a playlist with its presentations, themes and media, zipped
 *   .lumenthemes    themes
 *
 * Each is (or, zipped, holds as lumen.json) a `LumenFile`; media files sit beside it as
 * media/<id>. Export ▸ Text… writes plain text in the lyrics format Reflow uses.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { presentationToText } from './lyrics';
import type { AppState } from './store';
import type { Category, MediaItem, Playlist, PlaylistItem, Presentation, Theme } from './types';
import { uid } from './util';

export interface LumenFile {
  format: 'lumen';
  version: 1;
  kind: 'presentation' | 'playlist' | 'themes';
  presentations: Presentation[];
  themes: Theme[];
  /** Media the slides and themes use. A zipped file has each one's file at media/<id>. */
  media: MediaItem[];
  playlist?: { name: string; items: PlaylistItem[] };
}

export const EXTENSIONS = {
  presentation: 'lumen',
  bundle: 'lumenbundle',
  playlist: 'lumenplaylist',
  themes: 'lumenthemes',
} as const;

const JSON_NAME = 'lumen.json';
const mediaPath = (id: string) => `media/${id}`;

type Library = Pick<AppState, 'presentations' | 'themes' | 'media' | 'playlists'>;

/** Media a presentation or theme shows: slide media cues and backgrounds, theme backgrounds. */
export function mediaUsedBy(presentations: Presentation[], themes: Theme[]): string[] {
  const ids = new Set<string>();
  for (const p of presentations)
    for (const g of p.groups)
      for (const sl of g.slides) {
        if (sl.media) ids.add(sl.media);
        if (sl.background?.mediaId) ids.add(sl.background.mediaId);
      }
  for (const t of themes) if (t.background.mediaId) ids.add(t.background.mediaId);
  return [...ids];
}

function fileFor(s: Library, kind: LumenFile['kind'], presentations: Presentation[], themes: Theme[]): LumenFile {
  const used = new Set(mediaUsedBy(presentations, themes));
  return {
    format: 'lumen',
    version: 1,
    kind,
    presentations: structuredClone(presentations),
    themes: structuredClone(themes),
    media: s.media.filter((m) => used.has(m.id)),
  };
}

/** The themes presentations chose (those using the default theme follow the default where they're opened). */
const themesOf = (s: Library, presentations: Presentation[]) => s.themes.filter((t) => presentations.some((p) => p.themeId === t.id));

export function presentationFile(s: Library, id: string): LumenFile {
  const p = s.presentations[id];
  if (!p) throw new Error('There’s no presentation to export.');
  return fileFor(s, 'presentation', [p], themesOf(s, [p]));
}

export function playlistFile(s: Library, playlist: Playlist): LumenFile {
  const ids = [...new Set(playlist.items.flatMap((it) => (it.type === 'presentation' ? [it.presentationId] : [])))];
  const presentations = ids.map((id) => s.presentations[id]).filter(Boolean);
  const items = playlist.items.filter((it) => it.type === 'header' || s.presentations[it.presentationId]);
  return { ...fileFor(s, 'playlist', presentations, themesOf(s, presentations)), playlist: { name: playlist.name, items } };
}

export function themesFile(s: Library, themes: Theme[]): LumenFile {
  return fileFor(s, 'themes', [], themes);
}

export const encodeJson = (file: LumenFile) => new TextEncoder().encode(JSON.stringify(file, null, 2));

/** A zipped file: lumen.json and the media files (stored as they are: photos and videos don't compress). */
export function zipFile(file: LumenFile, blobs: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = { [JSON_NAME]: encodeJson(file) };
  for (const m of file.media) {
    const data = blobs.get(m.id);
    if (data) entries[mediaPath(m.id)] = [data, { level: 0 }];
  }
  return zipSync(entries);
}

/** Export ▸ Text…: the slides' words, with [Group] headers, as Reflow shows them. */
export const presentationText = (p: Presentation) => `${p.title}\n\n${presentationToText(p)}\n`;

/** Reads a Lumen file, zipped or not. Throws a message for the operator if it isn't one. */
export function readLumenFile(bytes: Uint8Array): { file: LumenFile; blobs: Map<string, Uint8Array> } {
  let json: Uint8Array = bytes;
  const blobs = new Map<string, Uint8Array>();
  // A zip starts "PK".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipSync(bytes);
    if (!entries[JSON_NAME]) throw new Error('This isn’t a Lumen file.');
    json = entries[JSON_NAME];
    for (const [name, data] of Object.entries(entries)) if (name.startsWith('media/')) blobs.set(name.slice(6), data);
  }
  let file: LumenFile;
  try {
    file = JSON.parse(new TextDecoder().decode(json)) as LumenFile;
  } catch {
    throw new Error('This isn’t a Lumen file.');
  }
  if (file?.format !== 'lumen' || !Array.isArray(file.presentations) || !Array.isArray(file.themes) || !Array.isArray(file.media))
    throw new Error('This isn’t a Lumen file.');
  if (file.version > 1) throw new Error('This file is from a newer Lumen. Update Lumen to open it.');
  return { file, blobs };
}

export interface ImportPlan {
  /** Themes to add, and what each file theme's id becomes. */
  themes: Theme[];
  themeIds: Map<string, string>;
  /** Media to add (their files are in the bundle). */
  media: MediaItem[];
  /** The presentations to create, with the themes and media they point at sorted out. */
  presentations: Presentation[];
  /** File presentation id → its new id. */
  presentationIds: Map<string, string>;
  playlist?: { name: string; items: PlaylistItem[] };
}

/**
 * Works out what importing a Lumen file adds to a library. Presentations always come in as
 * new ones in `category`. A theme the library already has (same id and contents) is shared;
 * one that differs comes in as a copy. Media the library already has is shared too; media the
 * file has no file for, and the library doesn't have, is left off the slides.
 */
export function planImport(s: Library, file: LumenFile, blobs: Map<string, Uint8Array>, category: Category): ImportPlan {
  const themes: Theme[] = [];
  const themeIds = new Map<string, string>();
  for (const t of file.themes) {
    const mine = s.themes.find((x) => x.id === t.id);
    if (mine && JSON.stringify(mine) === JSON.stringify(t)) themeIds.set(t.id, t.id);
    else {
      const theme = mine ? { ...t, id: uid() } : t;
      themes.push(theme);
      themeIds.set(t.id, theme.id);
    }
  }
  const media = file.media.filter((m) => !s.media.some((x) => x.id === m.id) && blobs.has(m.id));
  const known = new Set([...s.media.map((m) => m.id), ...media.map((m) => m.id)]);
  const keep = (id: string | undefined) => (id && known.has(id) ? id : undefined);
  for (const t of themes) if (t.background.mediaId && !keep(t.background.mediaId)) t.background = { ...t.background, mediaId: undefined };

  const presentationIds = new Map<string, string>();
  const presentations = file.presentations.map((p): Presentation => {
    const id = uid();
    presentationIds.set(p.id, id);
    const { hidden: _hidden, ...rest } = p;
    return {
      ...rest,
      id,
      category,
      themeId: p.themeId && themeIds.get(p.themeId),
      groups: p.groups.map((g) => ({
        ...g,
        slides: g.slides.map((sl) => ({
          ...sl,
          media: keep(sl.media),
          background: sl.background?.mediaId && !keep(sl.background.mediaId) ? undefined : sl.background,
        })),
      })),
      updatedAt: Date.now(),
    };
  });
  const playlist = file.playlist && {
    name: file.playlist.name,
    items: file.playlist.items.flatMap((it): PlaylistItem[] => {
      if (it.type === 'header') return [{ ...it, id: uid() }];
      const id = presentationIds.get(it.presentationId);
      return id ? [{ id: uid(), type: 'presentation', presentationId: id }] : [];
    }),
  };
  return { themes, themeIds, media, presentations, presentationIds, playlist };
}

/** A file name from a title: no characters file systems refuse, not too long. */
export function safeFileName(title: string, fallback = 'Untitled'): string {
  const name = title
    .replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  return name || fallback;
}
