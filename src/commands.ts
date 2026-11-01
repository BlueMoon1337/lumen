import { putBibleText, type BibleMeta } from './bible';
import { readLumenFile, planImport } from './fileFormats';
import { COPPERPLATE, faceName, readFontInfo, splitFontCollection } from './fonts';
import { parseProPlaylist } from './import/proplaylist';
import { parseProPresenter7, type ImportedPresentation } from './import/propresenter';
import { parseRvBible } from './import/rvbible';
import { colorForGroup, getSequence } from './lyrics';
import { undoBatch } from './history';
import { putMediaBlob } from './media';
import { dismiss, notify, renotify } from './notices';
import { createSlideshow, readKeynote, readPowerPoint, slideshowLibrary } from './slideshowImport';
import { useStore } from './store';
import type { EditableSlide } from './deck';
import { renderDeckSlide } from './deckRender';
import { slideWords } from './slideshows';
import type { Category, FontMeta, Group, PlaylistItem, Slide, SlideSource } from './types';
import { uid } from './util';

/** File types File ▸ Import ▸ File… and drag-and-drop accept. */
export const IMPORT_ACCEPT = '.pro,.proplaylist,.txt,.rvbible,.lumen,.lumenbundle,.lumenplaylist,.lumenthemes,.pptx,.key,text/plain';

export interface LumenImportResult {
  presentationIds: string[];
  playlistId: string | null;
  playlistName: string | null;
  themes: number;
  media: number;
}

/** Imports a Lumen file (File ▸ Export's): its presentations into `category`, and its playlist, themes and media. */
export async function importLumenFile(file: File, category: Category): Promise<LumenImportResult> {
  const { file: data, blobs } = readLumenFile(new Uint8Array(await file.arrayBuffer()));
  const s = useStore.getState();
  const plan = planImport(s, data, blobs, category);
  for (const m of [...plan.media, ...plan.files]) await putMediaBlob(m.id, new Blob([blobs.get(m.id)!.slice()], { type: m.mime }));
  if (plan.media.length) s.addMedia(plan.media);
  if (plan.themes.length) s.addThemes(plan.themes);
  if (plan.presentations.length) s.addPresentations(plan.presentations);
  const playlistId = plan.playlist ? s.addPlaylist(plan.playlist.name, plan.playlist.items) : null;
  return {
    presentationIds: plan.presentations.map((p) => p.id),
    playlistId,
    playlistName: playlistId ? (useStore.getState().playlists.find((pl) => pl.id === playlistId)?.name ?? null) : null,
    themes: plan.themes.length,
    media: plan.media.length,
  };
}

/**
 * File ▸ New Presentation, as in ProPresenter: one blank slide in a group called "Group", with no
 * background (transparent, so it shows over whatever media is playing), open in the editor.
 */
export function newPresentation(category: Category = 'song', title?: string): string {
  const s = useStore.getState();
  const group: Group = { id: uid(), name: 'Group', color: NEW_GROUP_COLOR, slides: [{ id: uid(), text: '' }] };
  const id = s.createPresentation({
    title: title || (category === 'song' ? 'Untitled Song' : 'Untitled'),
    category,
    groups: [group],
    arrangement: [group.id],
    background: { type: 'none', color: '#000000', color2: '#000000' },
  });
  s.select(id);
  s.setUI({ mode: 'edit', sidebar: 'library', libraryCategory: category, editSlideId: group.slides[0].id, editTextSelected: true });
  return id;
}

/** A new presentation's group: grey, as ProPresenter's. */
const NEW_GROUP_COLOR = '#5f6368';

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');
const extension = (file: File) => file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';

/** Songs set in Copperplate in ProPresenter get the matching Lumen theme: transparent, no shadow, wide text box. */
function themeFor(data: ImportedPresentation): string | undefined {
  if (data.style?.fontFamily !== COPPERPLATE) return undefined;
  return useStore.getState().themes.some((t) => t.id === 'theme-copperplate') ? 'theme-copperplate' : undefined;
}

/** An imported slide kept as boxes: its model and its picture (drawn with nothing behind it), stored. */
async function storeBoxSlide(deck: EditableSlide, number: number): Promise<SlideSource> {
  const model = uid();
  await putMediaBlob(model, new Blob([JSON.stringify(deck)], { type: 'application/json' }));
  const picture = uid();
  await putMediaBlob(picture, await renderDeckSlide(deck, deck.slide, new Map()));
  return { picture, text: deck.slide.text, number, model };
}

export async function createFromImport(data: ImportedPresentation, category: Category): Promise<string> {
  let number = 0;
  const groups: Group[] = [];
  for (const g of data.groups) {
    const slides: Slide[] = [];
    for (const sl of g.slides) {
      number++;
      const extra = { ...(sl.notes ? { notes: sl.notes } : {}), ...(sl.label ? { label: sl.label } : {}) };
      if (sl.deck) slides.push({ id: uid(), text: '', ...extra, source: await storeBoxSlide(sl.deck, number) });
      else slides.push({ id: uid(), text: sl.text, ...extra, ...(sl.style ? { style: sl.style } : {}) });
    }
    groups.push({ id: uid(), name: g.name, color: g.color ?? colorForGroup(g.name), slides });
  }
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
async function reuseOrCreate(data: ImportedPresentation, category: Category): Promise<{ id: string; reused: boolean }> {
  const existing = findIdentical(data);
  if (!existing) return { id: await createFromImport(data, category), reused: false };
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
        .map((e) => slideWords(e.slide))
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
        const r = await reuseOrCreate(data, category);
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
/** Imports songs, playlists, lyrics and Bibles; the whole import is one step to undo. */
export function importFiles(files: File[], category: Category = useStore.getState().libraryCategory) {
  return undoBatch(files.length === 1 ? `Import ${files[0].name}` : `Import ${files.length} Files`, () => importAll(files, category));
}

async function importAll(files: File[], category: Category) {
  if (!files.length) return;
  const working =
    files.length > 3 || files.some((f) => ['rvbible', 'proplaylist', 'lumenbundle', 'lumenplaylist', 'pptx', 'key'].includes(extension(f)))
      ? notify(`Importing ${files.length} file${files.length === 1 ? '' : 's'}…`, 'info', 0)
      : null;
  const s = useStore.getState();
  const failed: string[] = [];
  const bibles: string[] = [];
  const playlists: string[] = [];
  const missing: string[] = [];
  let presentations = 0;
  let themes = 0;
  let media = 0;
  let reused = 0;
  let lastId: string | null = null;
  let lastCategory = category;
  let openPlaylist: string | null = null;

  for (const file of files) {
    try {
      switch (extension(file)) {
        case 'pro': {
          const data = parseProPresenter7(new Uint8Array(await file.arrayBuffer()), baseName(file));
          const r = await reuseOrCreate(data, category);
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
        case 'lumen':
        case 'lumenbundle':
        case 'lumenplaylist':
        case 'lumenthemes': {
          const r = await importLumenFile(file, category);
          presentations += r.presentationIds.length;
          lastId = r.presentationIds.at(-1) ?? lastId;
          if (r.playlistId) {
            playlists.push(r.playlistName ?? 'Playlist');
            openPlaylist = r.playlistId;
          }
          themes += r.themes;
          media += r.media;
          break;
        }
        case 'pptx':
        case 'key': {
          // PowerPoint and Keynote presentations go in their own library, whichever is open.
          const progress = (done: number, total: number) =>
            working && renotify(working, `Importing ${file.name}: slide ${done} of ${total}…`);
          const data = extension(file) === 'pptx' ? await readPowerPoint(file, progress) : await readKeynote(file, progress);
          lastId = await createSlideshow(data);
          lastCategory = slideshowLibrary();
          presentations++;
          break;
        }
        case 'ppt':
          throw new Error('PowerPoint 97–2003 files (.ppt) can’t be read. Open it in PowerPoint and save it as .pptx');
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
    s.setUI({ sidebar: 'library', libraryCategory: lastCategory, mode: 'show' });
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const done = [
    playlists.length && `playlist${playlists.length === 1 ? '' : 's'} ${playlists.map((n) => `“${n}”`).join(', ')}`,
    presentations && plural(presentations, playlists.length ? 'new song' : 'presentation'),
    bibles.length && `Bible ${bibles.join(', ')} (use it from the Bible button)`,
    themes && plural(themes, 'theme'),
    media && `${plural(media, 'media file')} (in the media bin)`,
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
