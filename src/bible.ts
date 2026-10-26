import { idbRequest } from './idb';
import { VERSE_COUNTS } from './versification';

/** Books in canonical order with English names and common abbreviations. */
const ENGLISH =
  `GEN Genesis,Gen,Ge,Gn|EXO Exodus,Exod,Ex|LEV Leviticus,Lev,Lv|NUM Numbers,Num,Nm|DEU Deuteronomy,Deut,Dt|JOS Joshua,Josh|JDG Judges,Judg,Jdg|RUT Ruth,Ru|1SA 1 Samuel,1 Sam|2SA 2 Samuel,2 Sam|1KI 1 Kings,1 Kgs|2KI 2 Kings,2 Kgs|1CH 1 Chronicles,1 Chr|2CH 2 Chronicles,2 Chr|EZR Ezra|NEH Nehemiah,Neh|EST Esther,Esth|JOB Job|PSA Psalms,Psalm,Ps,Psa|PRO Proverbs,Prov,Pr|ECC Ecclesiastes,Eccl,Ecc|SNG Song of Songs,Song of Solomon,Song|ISA Isaiah,Isa|JER Jeremiah,Jer|LAM Lamentations,Lam|EZK Ezekiel,Ezek|DAN Daniel,Dan|HOS Hosea,Hos|JOL Joel|AMO Amos|OBA Obadiah,Obad|JON Jonah|MIC Micah,Mic|NAM Nahum,Nah|HAB Habakkuk,Hab|ZEP Zephaniah,Zeph|HAG Haggai,Hag|ZEC Zechariah,Zech|MAL Malachi,Mal|MAT Matthew,Matt,Mt|MRK Mark,Mk|LUK Luke,Lk|JHN John,Jn,Jhn|ACT Acts|ROM Romans,Rom|1CO 1 Corinthians,1 Cor|2CO 2 Corinthians,2 Cor|GAL Galatians,Gal|EPH Ephesians,Eph|PHP Philippians,Phil,Php|COL Colossians,Col|1TH 1 Thessalonians,1 Thess|2TH 2 Thessalonians,2 Thess|1TI 1 Timothy,1 Tim|2TI 2 Timothy,2 Tim|TIT Titus|PHM Philemon,Phlm|HEB Hebrews,Heb|JAS James,Jas|1PE 1 Peter,1 Pet|2PE 2 Peter,2 Pet|1JN 1 John|2JN 2 John|3JN 3 John|JUD Jude|REV Revelation,Rev`
    .split('|')
    .map((entry) => {
      const code = entry.slice(0, 3);
      return [code, entry.slice(4).split(',')] as const;
    });

export const BOOK_CODES = ENGLISH.map(([code]) => code);
const englishNames = new Map(ENGLISH);
export const englishBookName = (code: string) => englishNames.get(code)?.[0];

export interface BibleBookMeta {
  code: string;
  name: string;
  short: string;
  abbr: string;
  /** Number of verses in each chapter. */
  verses: number[];
}

/** Kept in the library; the verse text itself lives in IndexedDB. */
export interface BibleMeta {
  id: string;
  name: string;
  abbreviation: string;
  language?: string;
  /** License or copyright text from the imported file. */
  license?: string;
  books: BibleBookMeta[];
}

export interface BibleText {
  books: Record<string, string[][]>;
}

export interface Verse {
  book_name: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface Passage {
  reference: string;
  verses: Verse[];
  translation_id: string;
}

// ---- Storage ---------------------------------------------------------------

const cache = new Map<string, Promise<BibleText | undefined>>();

export const putBibleText = (id: string, text: BibleText) => {
  cache.set(id, Promise.resolve(text));
  return idbRequest('bibles', 'readwrite', (s) => s.put(text, id));
};

export const deleteBibleText = (id: string) => {
  cache.delete(id);
  return idbRequest('bibles', 'readwrite', (s) => s.delete(id));
};

export function loadBibleText(id: string): Promise<BibleText | undefined> {
  let p = cache.get(id);
  if (!p) {
    p = idbRequest<BibleText | undefined>('bibles', 'readonly', (s) => s.get(id));
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

// ---- References --------------------------------------------------------------

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(iii|ii|i)\s+/, (m) => String(m.trim().length))
    .replace(/[^a-z0-9]/g, '');

/** "SALMOS" → "Salmos", "1 SAMUEL" → "1 Samuel"; mixed-case names are left alone. */
export function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLocaleLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase());
}

export const bookLabel = (b: BibleBookMeta) => displayName(b.short || b.name);

/**
 * Each name plus the endings of it that start at a word, so "San Juan" and
 * "El Santo Evangelio según San Juan" also answer to "Juan". A leading book
 * number is never dropped, so "1 Juan" does not answer to "Juan".
 */
function nameForms(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const words = name.trim().split(/\s+/);
    const start = /^\d+$/.test(words[0]) ? 1 : words.length;
    out.add(norm(name));
    for (let i = 1; i < start; i++) out.add(norm(words.slice(i).join(' ')));
  }
  out.delete('');
  return [...out];
}

const formsCache = new WeakMap<BibleBookMeta, string[]>();
function formsOf(b: BibleBookMeta): string[] {
  let forms = formsCache.get(b);
  if (!forms) {
    forms = nameForms([b.name, b.short, b.abbr, b.code, ...(englishNames.get(b.code) ?? [])].filter(Boolean));
    formsCache.set(b, forms);
  }
  return forms;
}

/** Matches "Juan", "Jn", "John", "1 Co", "I Juan", "Salmo"… against a Bible's books. */
export function findBook(query: string, books: BibleBookMeta[]): BibleBookMeta | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return (
    books.find((b) => formsOf(b).includes(q)) ?? (q.length >= 2 ? books.find((b) => formsOf(b).some((n) => n.startsWith(q))) : undefined)
  );
}

export interface PassageRange {
  book: BibleBookMeta;
  chapter: number;
  verse: number;
  endChapter: number;
  endVerse: number;
  /** True when the reference named whole chapters. */
  wholeChapters: boolean;
}

const REF = /^(.*?[\p{L}.])\s*(\d+)\s*(?:[:.,]\s*(\d+))?\s*(?:[-–—]\s*(\d+)\s*(?:[:.]\s*(\d+))?)?\s*$/u;

export const MAX_VERSES = 300;

export function parseReference(input: string, books: BibleBookMeta[]): PassageRange | { error: string } {
  const m = input.trim().match(REF);
  if (!m) return { error: 'Type a reference like "Juan 3:16-18" or "Salmos 23".' };
  const [, bookPart, c, v, x, y] = m;
  const book = findBook(bookPart, books);
  if (!book) return { error: `No book matches “${bookPart.trim()}”.` };
  const chapter = Number(c);
  const last = (ch: number) => book.verses[ch - 1] ?? 0;
  if (!last(chapter)) return { error: `${bookLabel(book)} has ${book.verses.length} chapters.` };

  let verse = 1;
  let endChapter = chapter;
  let endVerse = last(chapter);
  let wholeChapters = !v;
  if (v) {
    verse = Number(v);
    endVerse = verse;
    if (y) {
      endChapter = Number(x);
      endVerse = Number(y);
    } else if (x) endVerse = Number(x);
  } else if (x) {
    endChapter = Number(x);
    endVerse = y ? Number(y) : last(endChapter);
    wholeChapters = !y;
  }
  if (!last(endChapter)) return { error: `${bookLabel(book)} has ${book.verses.length} chapters.` };
  if (verse < 1 || verse > last(chapter)) return { error: `${bookLabel(book)} ${chapter} has ${last(chapter)} verses.` };
  endVerse = Math.min(endVerse, last(endChapter));
  if (endChapter < chapter || (endChapter === chapter && endVerse < verse))
    return { error: 'The end of the range comes before the start.' };
  return { book, chapter, verse, endChapter, endVerse, wholeChapters };
}

export function formatRange(r: PassageRange): string {
  const name = bookLabel(r.book);
  if (r.wholeChapters) return r.endChapter === r.chapter ? `${name} ${r.chapter}` : `${name} ${r.chapter}-${r.endChapter}`;
  if (r.endChapter !== r.chapter) return `${name} ${r.chapter}:${r.verse}-${r.endChapter}:${r.endVerse}`;
  return r.endVerse === r.verse ? `${name} ${r.chapter}:${r.verse}` : `${name} ${r.chapter}:${r.verse}-${r.endVerse}`;
}

/** Looks a reference up in an imported Bible. */
export async function lookupLocal(meta: BibleMeta, input: string): Promise<Passage> {
  const range = parseReference(input, meta.books);
  if ('error' in range) throw new Error(range.error);
  return lookupRange(meta, range);
}

/** Looks a passage up in an imported Bible by book code, chapter and verse, so another translation's range works too. */
export async function lookupRange(meta: BibleMeta, range: PassageRange): Promise<Passage> {
  const book = meta.books.find((b) => b.code === range.book.code);
  if (!book) throw new Error(`${meta.abbreviation} doesn't include ${bookLabel(range.book)}.`);
  const text = await loadBibleText(meta.id);
  const chapters = text?.books[book.code];
  if (!chapters) throw new Error(`The text of ${meta.abbreviation} is missing on this computer. Import the .rvbible file again.`);
  const verses: Verse[] = [];
  const name = bookLabel(book);
  for (let c = range.chapter; c <= range.endChapter; c++) {
    const from = c === range.chapter ? range.verse : 1;
    const to = c === range.endChapter ? range.endVerse : (chapters[c - 1]?.length ?? 0);
    for (let v = from; v <= to; v++) {
      const t = chapters[c - 1]?.[v - 1];
      if (t) verses.push({ book_name: name, chapter: c, verse: v, text: t });
      if (verses.length > MAX_VERSES) throw new Error(`That passage is over ${MAX_VERSES} verses. Pick a shorter range.`);
    }
  }
  if (!verses.length) throw new Error('No verses found for that reference.');
  return { reference: formatRange({ ...range, book }), verses, translation_id: meta.abbreviation };
}

// ---- Online translations and standard versification -----------------------------------

/** Public-domain translations from the free bible-api.com service. */
export const ONLINE_BIBLES = [
  { id: 'web', name: 'World English Bible', abbreviation: 'WEB' },
  { id: 'kjv', name: 'King James Version', abbreviation: 'KJV' },
  { id: 'asv', name: 'American Standard Version (1901)', abbreviation: 'ASV' },
  { id: 'bbe', name: 'Bible in Basic English', abbreviation: 'BBE' },
  { id: 'ylt', name: "Young's Literal Translation", abbreviation: 'YLT' },
  { id: 'darby', name: 'Darby Translation', abbreviation: 'DARBY' },
];

/** The 66 books with English names and standard verse counts, for translations that don't bring their own. */
export const STANDARD_BOOKS: BibleBookMeta[] = VERSE_COUNTS.split('|').map((counts, i) => {
  const code = BOOK_CODES[i];
  const [name, abbr = ''] = englishNames.get(code) ?? [code];
  return { code, name, short: name, abbr, verses: counts.split(',').map(Number) };
});

/** Looks a passage up online (bible-api.com), by its English reference. */
export async function lookupOnline(id: string, range: PassageRange): Promise<Passage> {
  const english = STANDARD_BOOKS.find((b) => b.code === range.book.code) ?? range.book;
  const reference = formatRange({ ...range, book: english });
  let res: Response;
  try {
    res = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${id}`);
  } catch {
    throw new Error('Could not reach the online Bible service. Check the internet connection, or import a Bible to work offline.');
  }
  if (!res.ok) throw new Error(res.status === 404 ? `${reference} wasn't found online.` : `The online lookup failed (${res.status}).`);
  const data = (await res.json()) as { reference: string; verses: Verse[] };
  if (!data.verses?.length) throw new Error('No verses came back for that reference.');
  return {
    reference,
    verses: data.verses.map((v) => ({ ...v, book_name: english.name })),
    translation_id: ONLINE_BIBLES.find((b) => b.id === id)?.abbreviation ?? id.toUpperCase(),
  };
}
