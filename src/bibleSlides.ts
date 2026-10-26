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

/** Roughly how many characters fit the template's main box at a comfortable size; used to fill slides when not breaking on each verse. */
export function slideCapacity(theme: Theme): number {
  const width = 1920 * (1 - (theme.inset.left + theme.inset.right) / 100);
  const height = 1080 * (1 - (theme.inset.top + theme.inset.bottom) / 100);
  const size = Math.max(36, theme.fontSize * 0.7);
  return Math.max(60, Math.floor((width / (size * 0.55)) * (height / (size * theme.lineHeight)) * 0.85));
}

function chunkVerses(verses: Verse[], breakOnNewVerse: boolean, capacity: number): Verse[][] {
  if (breakOnNewVerse) return verses.map((v) => [v]);
  const chunks: Verse[][] = [];
  let chunk: Verse[] = [];
  let length = 0;
  for (const v of verses) {
    const n = clean(v.text).length + 1;
    if (chunk.length && length + n > capacity) {
      chunks.push(chunk);
      chunk = [];
      length = 0;
    }
    chunk.push(v);
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
    const keys = chunk.map((v) => `${v.chapter}:${v.verse}`);
    const boxes: Record<Exclude<BibleSlot, 'none'>, string[]> = { text: [], caption: [] };
    settings.translations.forEach((row, i) => {
      const passage = passages[i];
      if (!passage) return;
      const verses = keys.map((k) => byVerse[i].get(k)).filter((v): v is Verse => !!v);
      const body = verses.map((v) => `${settings.showVerseNumbers ? `${superscript(v.verse)} ` : ''}${clean(v.text)}`).join(' ');
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
    return { label: rangeLabel(chunk), text: boxes.text.join('\n\n'), caption: boxes.caption.join('\n') || undefined };
  });
}

/** One group per slide, named after its verses, as Bible slides are labelled in ProPresenter. */
export function bibleGroups(slides: BibleSlide[]): { groups: Group[]; arrangement: string[] } {
  const groups = slides.map((s) => ({
    id: uid(),
    name: s.label,
    color: GROUP_COLOR,
    slides: [{ id: uid(), text: s.text, caption: s.caption }],
  }));
  return { groups, arrangement: groups.map((g) => g.id) };
}
