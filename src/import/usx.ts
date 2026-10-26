/** Paragraph styles that hold headings, titles and introductions rather than verse text. */
const SKIP_PARA = /^(h|toc\d*|toca\d*|mt\d*|mte\d*|ms\d*|mr|s\d*|sr|r|d|sp|cl|cd|rem|ide|imt\d*|is\d*|ip.*|iot|io\d*|ie|iex|lit|restore)$/;
const SKIP_ELEMENTS = new Set(['note', 'figure', 'sidebar', 'book', 'ref-note']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

export function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

export interface UsxBook {
  code: string;
  /** chapters[c - 1][v - 1] is the text of chapter c, verse v. */
  chapters: string[][];
}

/**
 * Reads the verse text out of a USX (2 or 3) book. Headings, footnotes and
 * cross references are dropped; verse bridges ("4-5") are kept under the
 * first verse number.
 */
export function parseUsx(xml: string): UsxBook {
  let code = '';
  const chapters: string[][] = [];
  let chapter = 0;
  let verse = 0;
  // One entry per open element: true when its contents should be skipped.
  const open: boolean[] = [];
  let skipping = 0;

  const append = (text: string) => {
    if (skipping || !chapter || !verse) return;
    const verses = (chapters[chapter - 1] ??= []);
    verses[verse - 1] = (verses[verse - 1] ?? '') + text;
  };

  const tokens = /<(\/?)([\w:-]+)([^>]*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|([^<]+)/g;
  for (let m: RegExpExecArray | null; (m = tokens.exec(xml));) {
    const [, closing, name, attrs, selfClosing, text] = m;
    if (text !== undefined) {
      append(decodeXml(text));
      continue;
    }
    if (!name) continue;
    if (closing) {
      if (open.pop()) skipping--;
      // Keep poetry lines apart when a verse spans paragraphs.
      if (name === 'para') append(' ');
      continue;
    }
    if (name === 'book') code = attr(attrs, 'code') ?? code;
    if (name === 'chapter') {
      const n = attr(attrs, 'number');
      if (n) {
        chapter = parseInt(n, 10) || chapter;
        verse = 0;
        chapters[chapter - 1] ??= [];
      }
    } else if (name === 'verse') {
      const n = attr(attrs, 'number');
      if (n) verse = parseInt(n, 10) || verse;
      else if (attr(attrs, 'eid')) verse = 0;
    }
    if (selfClosing) continue;
    const style = attr(attrs, 'style') ?? '';
    const skip = SKIP_ELEMENTS.has(name) || (name === 'para' && SKIP_PARA.test(style));
    open.push(skip);
    if (skip) skipping++;
  }

  return {
    code,
    chapters: Array.from(chapters, (verses = []) => Array.from(verses, (v = '') => v.replace(/\s+/g, ' ').trim())),
  };
}
