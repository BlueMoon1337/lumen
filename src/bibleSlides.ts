import type { Passage, Verse } from './bible';
import type { BibleSettings, BibleSlot, Group, Settings, Theme } from './types';
import { uid } from './util';

/** Bible mode's slides as they're being put together, kept out of the library. */
export const BIBLE_DRAFT_ID = 'bible-draft';
/** The copy that's on screen, so typing the next reference doesn't change what the audience sees. */
export const BIBLE_LIVE_ID = 'bible-live';

const GROUP_COLOR = '#52525b';

export function bibleSettings(settings: Settings, firstBibleId?: string): BibleSettings {
  return {
    reference: 'John 3:16',
    translations: [{ bibleId: settings.lastBible ?? firstBibleId ?? 'web', verse: 'text', reference: 'caption' }],
    showVerseNumbers: false,
    breakOnNewVerse: true,
    displayTranslation: false,
    references: 'verse',
    themeId: 'theme-bible',
    library: 'scripture',
    ...settings.bible,
  };
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (n: number) => String(n).replace(/\d/g, (d) => SUPERSCRIPT[Number(d)]);
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** "Genesis 25:30", "Genesis 25:30-31" or "Genesis 25:34-26:2". */
export function rangeLabel(verses: Verse[]): string {
  const first = verses[0];
  const last = verses[verses.length - 1];
  if (!first) return '';
  const end = verses.length === 1 ? '' : first.chapter === last.chapter ? `-${last.verse}` : `-${last.chapter}:${last.verse}`;
  return `${first.book_name} ${first.chapter}:${first.verse}${end}`;
}

const SAMPLE = 'Then he arose and went to Zarephath; y cuando llegó a la puerta de la ciudad, he aquí una mujer viuda';

/** The width of an average character in the template's font, measured where there's a page to measure on. */
function charWidth(theme: Theme, size: number): number {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.font = `${theme.italic ? 'italic ' : ''}${theme.fontWeight} ${size}px ${theme.fontFamily}`;
      const text = theme.uppercase ? SAMPLE.toUpperCase() : SAMPLE;
      const w = ctx.measureText(text).width / text.length;
      if (w > 0) return w;
    }
  } catch {
    // No page (tests): estimate.
  }
  return size * (theme.uppercase ? 0.68 : 0.55);
}

/**
 * Roughly how many characters fit the template's main box near its font size (shrinking it a
 * little at most). A verse longer than this goes over several slides, as in ProPresenter, rather
 * than shrinking to fit; when not breaking on each verse, slides are filled up to it.
 */
export function slideCapacity(theme: Theme): number {
  const width = 1920 * (1 - (theme.inset.left + theme.inset.right) / 100);
  const height = 1080 * (1 - (theme.inset.top + theme.inset.bottom) / 100);
  const size = Math.max(36, theme.fontSize * 0.85);
  const perLine = Math.max(8, Math.floor(width / charWidth(theme, size)));
  const lines = Math.max(1, Math.floor(height / (size * theme.lineHeight)));
  return Math.max(40, Math.floor(perLine * lines * 0.85));
}

/**
 * Splits text into `parts` pieces of about the same length, each ending at the end of a sentence
 * or clause where there's one near, else at a space.
 */
export function splitText(text: string, parts: number): string[] {
  if (parts <= 1) return [text];
  const out: string[] = [];
  let rest = text;
  for (let left = parts; left > 1; left--) {
    const target = rest.length / left;
    const window = target * 0.3;
    const near = (re: RegExp) => {
      let best = -1;
      for (const m of rest.matchAll(re)) {
        const at = m.index + m[0].length;
        if (Math.abs(at - target) <= window && (best < 0 || Math.abs(at - target) < Math.abs(best - target))) best = at;
      }
      return best;
    };
    let cut = near(/[.;:!?»”"')]+\s/g);
    if (cut < 0) cut = near(/,\s/g);
    if (cut < 0) cut = near(/\s/g);
    if (cut < 0) cut = Math.round(target);
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  out.push(rest);
  return out.filter(Boolean);
}

/** A verse, or a part of one too long for a slide. */
interface Piece {
  verse: Verse;
  /** Which part, of how many. */
  part: number;
  parts: number;
}

function chunkVerses(verses: Verse[], breakOnNewVerse: boolean, capacity: number): Piece[][] {
  const pieces = verses.flatMap((verse): Piece[] => {
    const parts = Math.max(1, Math.ceil(clean(verse.text).length / capacity));
    return splitText(clean(verse.text), parts).map((_, part, all) => ({ verse, part, parts: all.length }));
  });
  if (breakOnNewVerse) return pieces.map((p) => [p]);
  const chunks: Piece[][] = [];
  let chunk: Piece[] = [];
  let length = 0;
  for (const p of pieces) {
    const n = clean(p.verse.text).length / p.parts + 1;
    if (chunk.length && length + n > capacity) {
      chunks.push(chunk);
      chunk = [];
      length = 0;
    }
    chunk.push(p);
    length += n;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export interface BibleSlide {
  /** The slide's verses, e.g. "Genesis 25:30"; shown under its thumbnail. */
  label: string;
  /** For the template's main (Verse) box. */
  text: string;
  /** For its caption (Reference) box. */
  caption?: string;
}

/**
 * Turns a passage (and the same verses in any further translations) into slides:
 * each translation's verse text and reference go to the box its row picked.
 */
export function buildBibleSlides(passages: (Passage | null)[], settings: BibleSettings, capacity: number): BibleSlide[] {
  const primary = passages[0];
  if (!primary) return [];
  const chunks = chunkVerses(primary.verses, settings.breakOnNewVerse, capacity);
  const byVerse = passages.map((p) => new Map((p?.verses ?? []).map((v) => [`${v.chapter}:${v.verse}`, v])));

  return chunks.map((chunk, index) => {
    const boxes: Record<Exclude<BibleSlot, 'none'>, string[]> = { text: [], caption: [] };
    settings.translations.forEach((row, i) => {
      const passage = passages[i];
      if (!passage) return;
      // The same verses in this translation, split into the same number of parts.
      const found = chunk
        .map((p) => ({ p, v: byVerse[i].get(`${p.verse.chapter}:${p.verse.verse}`) }))
        .filter((x): x is { p: Piece; v: Verse } => !!x.v);
      const verses = [...new Set(found.map((x) => x.v))];
      const body = found
        .map(({ p, v }) => {
          const text = splitText(clean(v.text), p.parts)[p.part] ?? '';
          return `${settings.showVerseNumbers && p.part === 0 ? `${superscript(v.verse)} ` : ''}${text}`;
        })
        .filter(Boolean)
        .join(' ');
      let reference = '';
      if (settings.references === 'verse') reference = rangeLabel(verses);
      else if (settings.references === 'passage-each') reference = passage.reference;
      else if (settings.references === 'passage-last' && index === chunks.length - 1) reference = passage.reference;
      if (reference && settings.displayTranslation) reference = `${reference} ${passage.translation_id}`;

      const own: Record<Exclude<BibleSlot, 'none'>, string[]> = { text: [], caption: [] };
      if (row.verse !== 'none' && body) own[row.verse].push(body);
      if (row.reference !== 'none' && reference) own[row.reference].push(reference);
      if (own.text.length) boxes.text.push(own.text.join('\n'));
      if (own.caption.length) boxes.caption.push(own.caption.join('\n'));
    });
    return {
      label: rangeLabel([...new Set(chunk.map((p) => p.verse))]),
      text: boxes.text.join('\n\n'),
      caption: boxes.caption.join('\n') || undefined,
    };
  });
}

/**
 * One group per verse (or run of verses), named after them, as in ProPresenter: a verse split
 * over several slides is one group of those slides. Every slide is labelled with its verses too,
 * so each thumbnail says which verse it is, not only the group's first.
 */
export function bibleGroups(slides: BibleSlide[]): { groups: Group[]; arrangement: string[] } {
  const groups: Group[] = [];
  for (const s of slides) {
    const slide = { id: uid(), text: s.text, caption: s.caption, label: { name: s.label, color: GROUP_COLOR } };
    const last = groups[groups.length - 1];
    if (last && last.name === s.label) last.slides.push(slide);
    else groups.push({ id: uid(), name: s.label, color: GROUP_COLOR, slides: [slide] });
  }
  return { groups, arrangement: groups.map((g) => g.id) };
}
