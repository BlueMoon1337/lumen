import { strFromU8, unzipSync } from 'fflate';
import { BOOK_CODES, englishBookName } from '../bible';
import { attr, decodeXml, parseUsx } from './usx';

export interface ImportedBibleBook {
  code: string;
  name: string;
  short: string;
  abbr: string;
  chapters: string[][];
}

export interface ImportedBible {
  name: string;
  abbreviation: string;
  language?: string;
  books: ImportedBibleBook[];
}

const tagText = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXml(m[1]).trim() : undefined;
};

/**
 * Reads a ProPresenter `.rvbible` file: a zip in Digital Bible Library layout
 * with `metadata.xml`, `rvmetadata.xml` and one USX file per book.
 */
export function parseRvBible(bytes: Uint8Array, fallbackName = 'Bible'): ImportedBible {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /\.(xml|usx)$/i.test(f.name) });
  } catch {
    throw new Error('Not a Bible file (expected a ProPresenter .rvbible).');
  }
  const find = (re: RegExp) => Object.keys(files).find((n) => re.test(n));
  const read = (name: string | undefined) => (name ? strFromU8(files[name]) : '');

  const rvMeta = read(find(/(^|\/)rvmetadata\.xml$/i));
  const dblMeta = read(find(/(^|\/)metadata\.xml$/i));

  // Book names as the Bible itself spells them, e.g. "Génesis" or "Juan".
  const names = new Map<string, { long?: string; short?: string; abbr?: string }>();
  for (const m of dblMeta.matchAll(/<book\b([^>]*)>([\s\S]*?)<\/book>/g)) {
    const code = attr(m[1], 'code');
    if (code) names.set(code, { long: tagText(m[2], 'long'), short: tagText(m[2], 'short'), abbr: tagText(m[2], 'abbr') });
  }

  const parsed = new Map<string, string[][]>();
  for (const name of Object.keys(files).filter((n) => /\.usx$/i.test(n))) {
    const book = parseUsx(read(name));
    const code =
      book.code ||
      name
        .replace(/^.*\//, '')
        .replace(/\.usx$/i, '')
        .toUpperCase();
    if (book.chapters.some((c) => c.length)) parsed.set(code, book.chapters);
  }
  if (!parsed.size) throw new Error('No Bible books found in this file.');

  const order = [...BOOK_CODES, ...[...parsed.keys()].filter((c) => !BOOK_CODES.includes(c))];
  const books = order
    .filter((code) => parsed.has(code))
    .map((code) => {
      const n = names.get(code) ?? {};
      const fallback = englishBookName(code) ?? code;
      return {
        code,
        name: n.long || n.short || fallback,
        short: n.short || n.long || fallback,
        abbr: n.abbr || '',
        chapters: parsed.get(code)!,
      };
    });

  return {
    name: tagText(rvMeta, 'name') || tagText(dblMeta, 'nameLocal') || tagText(dblMeta, 'name') || fallbackName,
    abbreviation:
      tagText(rvMeta, 'displayAbbreviation') ||
      tagText(rvMeta, 'abbreviation') ||
      tagText(dblMeta, 'abbreviationLocal') ||
      fallbackName.slice(0, 8).toUpperCase(),
    language: tagText(dblMeta, 'iso'),
    books,
  };
}
