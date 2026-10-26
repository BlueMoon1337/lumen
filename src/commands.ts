import { putBibleText, type BibleMeta } from './bible';
import { COPPERPLATE, faceName, readFontInfo, splitFontCollection } from './fonts';
import { parseProPlaylist } from './import/proplaylist';
import { parseProPresenter7, type ImportedPresentation } from './import/propresenter';
import { parseRvBible } from './import/rvbible';
import { colorForGroup, getSequence } from './lyrics';
import { putMediaBlob } from './media';
import { dismiss, notify } from './notices';
import { useStore } from './store';
import type { Category, FontMeta, Group, PlaylistItem } from './types';
import { uid } from './util';

/** File types the Import command and drag-and-drop accept. */
export const IMPORT_ACCEPT = '.pro,.proplaylist,.txt,.rvbible,text/plain';

/** Creates an empty presentation in a library and opens it in Reflow for typing lyrics. */
export function newPresentation(category: Category = 'song'): string {
  const s = useStore.getState();
  const id = s.createPresentation({ title: category === 'song' ? 'Untitled Song' : 'Untitled', category });
  s.select(id);
  s.setUI({ mode: 'reflow', sidebar: 'library', libraryCategory: category });
  return id;
}

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');
const extension = (file: File) => file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';

/** Songs set in Copperplate in ProPresenter get the matching Lumen theme: transparent, no shadow, wide text box. */
function themeFor(data: ImportedPresentation): string | undefined {
  if (data.style?.fontFamily !== COPPERPLATE) return undefined;
  return useStore.getState().themes.some((t) => t.id === 'theme-copperplate') ? 'theme-copperplate' : undefined;
}

export function createFromImport(data: ImportedPresentation, category: Category): string {
  const groups: Group[] = data.groups.map((g) => ({
    id: uid(),
    name: g.name,
    color: g.color ?? colorForGroup(g.name),
    slides: g.slides.map((s) => ({ id: uid(), text: s.text, notes: s.notes })),
  }));
  return useStore.getState().createPresentation({
    title: data.title,
    category,
    groups,
    arrangement: data.arrangement.map((i) => groups[i].id),
    author: data.author,
    artist: data.artist,
    album: data.album,
    publisher: data.publisher,
    year: data.year,
    ccli: data.ccli,
    showCopyright: data.showCopyright,
    transition: data.transition,
    style: data.style,
    themeId: themeFor(data),
  });
}

/** Reuses an identical song already in the library (giving it the imported font if it has none), or creates it. */
function reuseOrCreate(data: ImportedPresentation, category: Category): { id: string; reused: boolean } {
  const existing = findIdentical(data);
  if (!existing) return { id: createFromImport(data, category), reused: false };
  const s = useStore.getState();
  const p = s.presentations[existing];
  if (data.style && !p.style) s.updatePresentation(existing, { style: data.style, themeId: p.themeId ?? themeFor(data) });
  return { id: existing, reused: true };
}

/** A library presentation with the same title and slides, so re-importing doesn't duplicate songs. */
function findIdentical(data: ImportedPresentation): string | undefined {
  const texts = data.arrangement.flatMap((i) => data.groups[i].slides.map((s) => s.text)).join('\u0000');
  const title = data.title.toLowerCase();
  return Object.values(useStore.getState().presentations).find(
    (p) =>
      !p.hidden &&
      p.title.toLowerCase() === title &&
      getSequence(p)
        .map((e) => e.slide.text)
        .join('\u0000') === texts,
  )?.id;
}

export interface PlaylistImportResult {
  playlistIds: string[];
  names: string[];
  added: number;
  reused: number;
  missing: string[];
}

/** Imports a ProPresenter `.proplaylist`: its songs (once each) and then the playlist(s) in order. */
export async function importPlaylistFile(file: File, category: Category = 'song'): Promise<PlaylistImportResult> {
  const bundle = parseProPlaylist(new Uint8Array(await file.arrayBuffer()));
  if (!bundle.playlists.length) throw new Error('This playlist file has no playlists in it.');
  const s = useStore.getState();
  const result: PlaylistImportResult = { playlistIds: [], names: [], added: 0, reused: 0, missing: [] };
  const done = new Map<string, string>();

  for (const playlist of bundle.playlists) {
    const items: PlaylistItem[] = [];
    for (const item of playlist.items) {
      if (item.type === 'header') {
        items.push({ id: uid(), type: 'header', label: item.label });
        continue;
      }
      if (!item.file) {
        result.missing.push(item.name);
        continue;
      }
      const key = `${item.file}#${item.arrangementId ?? ''}`;
      let id = done.get(key);
      if (!id) {
        const data = parseProPresenter7(bundle.files.get(item.file)!, item.name, item.arrangementId);
        const r = reuseOrCreate(data, category);
        id = r.id;
        if (r.reused) result.reused++;
        else result.added++;
        done.set(key, id);
      }
      items.push({ id: uid(), type: 'presentation', presentationId: id });
    }
    result.playlistIds.push(s.addPlaylist(playlist.name, items));
    result.names.push(playlist.name);
  }
  return result;
}

/** Adds font files (.ttf, .otf, .woff, .woff2, .ttc) for use on slides; collections add each face. */
export async function addFontFiles(files: File[]): Promise<FontMeta[]> {
  const added: FontMeta[] = [];
  const failed: string[] = [];
  for (const file of files) {
    if (!/\.(ttf|otf|woff2?|ttc)$/i.test(file.name)) {
      failed.push(`${file.name}: not a font file`);
      continue;
    }
    try {
      for (const face of splitFontCollection(new Uint8Array(await file.arrayBuffer()))) {
        const data = face.slice();
        // Make sure this browser can actually use the font before keeping it.
        if (typeof FontFace !== 'undefined') await new FontFace('lumen-font-check', data.buffer).load();
        const meta: FontMeta = { id: uid(), ...readFontInfo(data, file.name), fileName: file.name };
        await putMediaBlob(meta.id, new Blob([data]));
        added.push(meta);
      }
    } catch {
      failed.push(`${file.name}: this font file could not be read`);
    }
  }
  if (added.length) {
    useStore.getState().addFonts(added);
    const families = [...new Set(added.map((f) => f.family))].map(
      (family) =>
        `${family} (${added
          .filter((f) => f.family === family)
          .map(faceName)
          .join(', ')})`,
    );
    notify(`Added ${families.join(', ')}. Choose ${families.length === 1 ? 'it' : 'them'} from any font menu.`, 'success');
  }
  if (failed.length) notify(`Could not add ${failed.join('\n')}`, 'error');
  return added;
}

export async function importBibleFile(file: File): Promise<BibleMeta> {
  const bible = parseRvBible(new Uint8Array(await file.arrayBuffer()), baseName(file));
  const meta: BibleMeta = {
    id: uid(),
    name: bible.name,
    abbreviation: bible.abbreviation,
    language: bible.language,
    license: bible.license,
    books: bible.books.map((b) => ({ code: b.code, name: b.name, short: b.short, abbr: b.abbr, verses: b.chapters.map((c) => c.length) })),
  };
  await putBibleText(meta.id, { books: Object.fromEntries(bible.books.map((b) => [b.code, b.chapters])) });
  useStore.getState().addBible(meta);
  return meta;
}

/**
 * Imports ProPresenter 7 presentations (.pro) and playlists (.proplaylist),
 * plain-text lyrics (.txt) and ProPresenter Bibles (.rvbible), then reports
 * what happened.
 */
export async function importFiles(files: File[], category: Category = useStore.getState().libraryCategory) {
  if (!files.length) return;
  const working =
    files.length > 3 || files.some((f) => ['rvbible', 'proplaylist'].includes(extension(f)))
      ? notify(`Importing ${files.length} file${files.length === 1 ? '' : 's'}…`, 'info', 0)
      : null;
  const s = useStore.getState();
  const failed: string[] = [];
  const bibles: string[] = [];
  const playlists: string[] = [];
  const missing: string[] = [];
  let presentations = 0;
  let reused = 0;
  let lastId: string | null = null;
  let openPlaylist: string | null = null;

  for (const file of files) {
    try {
      switch (extension(file)) {
        case 'pro': {
          const data = parseProPresenter7(new Uint8Array(await file.arrayBuffer()), baseName(file));
          const r = reuseOrCreate(data, category);
          if (r.reused) reused++;
          else presentations++;
          lastId = r.id;
          break;
        }
        case 'txt':
          lastId = s.createPresentation({ title: baseName(file), category }, await file.text());
          presentations++;
          break;
        case 'proplaylist': {
          const r = await importPlaylistFile(file, category);
          playlists.push(...r.names);
          missing.push(...r.missing);
          presentations += r.added;
          reused += r.reused;
          openPlaylist = r.playlistIds[0] ?? openPlaylist;
          break;
        }
        case 'rvbible':
          bibles.push((await importBibleFile(file)).abbreviation);
          break;
        case 'pro6':
          throw new Error('ProPresenter 6 files are not supported yet');
        default:
          throw new Error('not a supported file type');
      }
    } catch (e) {
      failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (working) dismiss(working);
  if (openPlaylist) {
    // Show the imported playlist with its first song selected, ready to run.
    const st = useStore.getState();
    const first = st.playlists.find((p) => p.id === openPlaylist)?.items.find((it) => it.type === 'presentation');
    st.setActivePlaylist(openPlaylist);
    st.setUI({ sidebar: 'playlist', mode: 'show' });
    if (first?.type === 'presentation') st.select(first.presentationId, first.id);
  } else if (lastId) {
    s.select(lastId);
    s.setUI({ sidebar: 'library', libraryCategory: category, mode: 'show' });
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const done = [
    playlists.length && `playlist${playlists.length === 1 ? '' : 's'} ${playlists.map((n) => `“${n}”`).join(', ')}`,
    presentations && plural(presentations, playlists.length ? 'new song' : 'presentation'),
    bibles.length && `Bible ${bibles.join(', ')} (use it from the Bible button)`,
  ].filter(Boolean);
  if (!done.length && reused) notify(`${plural(reused, 'song')} already in your library, so nothing was duplicated.`, 'success');
  if (done.length) {
    const kept = reused
      ? ` ${plural(reused, 'song')} already in your library ${reused === 1 ? 'was' : 'were'} kept instead of duplicated.`
      : '';
    notify(`Imported ${done.join(' and ')}.${kept}`, 'success');
  }
  if (missing.length) notify(`Not included in the playlist file, so skipped: ${missing.join(', ')}`, 'error');
  if (failed.length)
    notify(`Could not import ${failed.length === 1 ? failed[0] : `${failed.length} files:\n${failed.join('\n')}`}`, 'error');
}
