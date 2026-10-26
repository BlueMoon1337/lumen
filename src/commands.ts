import { putBibleText, type BibleMeta } from './bible';
import { parseProPresenter7, type ImportedPresentation } from './import/propresenter';
import { parseRvBible } from './import/rvbible';
import { colorForGroup } from './lyrics';
import { dismiss, notify } from './notices';
import { useStore } from './store';
import type { Category, Group } from './types';
import { uid } from './util';

/** File types the Import command and drag-and-drop accept. */
export const IMPORT_ACCEPT = '.pro,.txt,.rvbible,text/plain';

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
    transitionMs: data.transitionMs,
  });
}

export async function importBibleFile(file: File): Promise<BibleMeta> {
  const bible = parseRvBible(new Uint8Array(await file.arrayBuffer()), baseName(file));
  const meta: BibleMeta = {
    id: uid(),
    name: bible.name,
    abbreviation: bible.abbreviation,
    language: bible.language,
    books: bible.books.map((b) => ({ code: b.code, name: b.name, short: b.short, abbr: b.abbr, verses: b.chapters.map((c) => c.length) })),
  };
  await putBibleText(meta.id, { books: Object.fromEntries(bible.books.map((b) => [b.code, b.chapters])) });
  useStore.getState().addBible(meta);
  return meta;
}

/**
 * Imports ProPresenter 7 presentations (.pro), plain-text lyrics (.txt) and
 * ProPresenter Bibles (.rvbible), then reports what happened.
 */
export async function importFiles(files: File[], category: Category = useStore.getState().libraryCategory) {
  if (!files.length) return;
  const working =
    files.length > 3 || files.some((f) => extension(f) === 'rvbible')
      ? notify(`Importing ${files.length} file${files.length === 1 ? '' : 's'}…`, 'info', 0)
      : null;
  const s = useStore.getState();
  const failed: string[] = [];
  const bibles: string[] = [];
  let presentations = 0;
  let lastId: string | null = null;

  for (const file of files) {
    try {
      switch (extension(file)) {
        case 'pro':
          lastId = createFromImport(parseProPresenter7(new Uint8Array(await file.arrayBuffer()), baseName(file)), category);
          presentations++;
          break;
        case 'txt':
          lastId = s.createPresentation({ title: baseName(file), category }, await file.text());
          presentations++;
          break;
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
  if (lastId) {
    s.select(lastId);
    s.setUI({ sidebar: 'library', libraryCategory: category, mode: 'show' });
  }
  const done = [
    presentations && `${presentations} presentation${presentations === 1 ? '' : 's'}`,
    bibles.length && `Bible ${bibles.join(', ')} (use it from the Bible button)`,
  ].filter(Boolean);
  if (done.length) notify(`Imported ${done.join(' and ')}.`, 'success');
  if (failed.length)
    notify(`Could not import ${failed.length === 1 ? failed[0] : `${failed.length} files:\n${failed.join('\n')}`}`, 'error');
}
