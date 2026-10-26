import { describe, expect, it } from 'vitest';
import { STANDARD_BOOKS, parseReference, type Passage } from './bible';
import { BIBLE_DRAFT_ID, BIBLE_LIVE_ID, bibleGroups, bibleSettings, buildBibleSlides, rangeLabel, slideCapacity } from './bibleSlides';
import { getSequence } from './lyrics';
import { useStore } from './store';
import { defaultThemes } from './seed';
import type { BibleSettings, Settings } from './types';

// Made-up verse text: the tests only care how verses are laid out.
const passage = (book: string, abbr: string, reference: string, verses: [number, number, string][]): Passage => ({
  reference,
  translation_id: abbr,
  verses: verses.map(([chapter, verse, text]) => ({ book_name: book, chapter, verse, text })),
});

const english = passage('Genesis', 'TST', 'Genesis 25:30-32', [
  [25, 30, 'First verse text.'],
  [25, 31, 'Second   verse\ntext.'],
  [25, 32, 'Third verse text.'],
]);
const spanish = passage('Génesis', 'PRB', 'Génesis 25:30-32', [
  [25, 30, 'Primer versículo.'],
  [25, 31, 'Segundo versículo.'],
  [25, 32, 'Tercer versículo.'],
]);

const settings = (patch: Partial<BibleSettings> = {}): BibleSettings => ({
  ...bibleSettings({} as Settings),
  translations: [{ bibleId: 'tst', verse: 'text', reference: 'caption' }],
  ...patch,
});

describe('Bible slides', () => {
  it('puts each verse on its own slide, with its reference in the caption box', () => {
    const slides = buildBibleSlides([english], settings(), 500);
    expect(slides.map((s) => [s.label, s.text, s.caption])).toEqual([
      ['Genesis 25:30', 'First verse text.', 'Genesis 25:30'],
      ['Genesis 25:31', 'Second verse text.', 'Genesis 25:31'],
      ['Genesis 25:32', 'Third verse text.', 'Genesis 25:32'],
    ]);
  });

  it('fills slides with as many verses as fit when not breaking on each verse', () => {
    const slides = buildBibleSlides([english], settings({ breakOnNewVerse: false }), 40);
    expect(slides.map((s) => s.label)).toEqual(['Genesis 25:30-31', 'Genesis 25:32']);
    expect(slides[0].text).toBe('First verse text. Second verse text.');
  });

  it('shows verse numbers as superscripts', () => {
    const [first] = buildBibleSlides([english], settings({ showVerseNumbers: true, breakOnNewVerse: false }), 500);
    expect(first.text).toBe('³⁰ First verse text. ³¹ Second verse text. ³² Third verse text.');
  });

  it('places references by the chosen style, with the translation if asked', () => {
    const captions = (references: BibleSettings['references'], displayTranslation = false) =>
      buildBibleSlides([english], settings({ references, displayTranslation }), 500).map((s) => s.caption);
    expect(captions('passage-each')).toEqual(['Genesis 25:30-32', 'Genesis 25:30-32', 'Genesis 25:30-32']);
    expect(captions('passage-last')).toEqual([undefined, undefined, 'Genesis 25:30-32']);
    expect(captions('none')).toEqual([undefined, undefined, undefined]);
    expect(captions('verse', true)[0]).toBe('Genesis 25:30 TST');
  });

  it('follows the Verse and Reference box choices', () => {
    const [both] = buildBibleSlides([english], settings({ translations: [{ bibleId: 'tst', verse: 'text', reference: 'text' }] }), 500);
    expect([both.text, both.caption]).toEqual(['First verse text.\nGenesis 25:30', undefined]);
    const [swapped] = buildBibleSlides(
      [english],
      settings({ translations: [{ bibleId: 'tst', verse: 'caption', reference: 'text' }] }),
      500,
    );
    expect([swapped.text, swapped.caption]).toEqual(['Genesis 25:30', 'First verse text.']);
  });

  it('lines up a second translation verse by verse', () => {
    const s = settings({
      translations: [
        { bibleId: 'tst', verse: 'text', reference: 'caption' },
        { bibleId: 'prb', verse: 'text', reference: 'none' },
      ],
    });
    const [first] = buildBibleSlides([english, spanish], s, 500);
    expect(first.text).toBe('First verse text.\n\nPrimer versículo.');
    expect(first.caption).toBe('Genesis 25:30');
  });

  it('labels ranges across chapters and makes one group per slide', () => {
    const across = passage('Genesis', 'TST', '', [
      [25, 34, 'a'],
      [26, 1, 'b'],
    ]).verses;
    expect(rangeLabel(across)).toBe('Genesis 25:34-26:1');
    const { groups, arrangement } = bibleGroups(buildBibleSlides([english], settings(), 500));
    expect(groups.map((g) => g.name)).toEqual(['Genesis 25:30', 'Genesis 25:31', 'Genesis 25:32']);
    expect(arrangement).toEqual(groups.map((g) => g.id));
  });

  it('estimates how much text the template holds', () => {
    const bible = defaultThemes.find((t) => t.id === 'theme-bible')!;
    expect(slideCapacity(bible)).toBeGreaterThan(150);
    expect(slideCapacity({ ...bible, fontSize: 300 })).toBeLessThan(slideCapacity(bible));
  });
});

describe('standard versification', () => {
  it('knows every book, chapter and verse count for online translations', () => {
    expect(STANDARD_BOOKS).toHaveLength(66);
    expect(STANDARD_BOOKS.reduce((n, b) => n + b.verses.length, 0)).toBe(1189);
    const range = parseReference('Gen 25:30-34', STANDARD_BOOKS);
    expect(range).toMatchObject({ chapter: 25, verse: 30, endVerse: 34 });
    expect(parseReference('Psalm 119', STANDARD_BOOKS)).toMatchObject({ endVerse: 176 });
  });
});

describe('Bible mode in the store', () => {
  const draftOf = (slides: ReturnType<typeof buildBibleSlides>) => ({
    title: 'Genesis 25:30-32 (TST)',
    themeId: 'theme-bible',
    ...bibleGroups(slides),
  });

  it('shows a copy, so a new passage typed meanwhile leaves the screen alone', () => {
    const s = useStore.getState();
    s.setBibleDraft(draftOf(buildBibleSlides([english], settings(), 500)));
    s.showBibleSlide(1);
    expect(useStore.getState().live.slide).toMatchObject({ presentationId: BIBLE_LIVE_ID, index: 1 });
    s.setBibleDraft(draftOf(buildBibleSlides([spanish], settings(), 500)));
    const live = useStore.getState().presentations[BIBLE_LIVE_ID];
    expect(live.groups[1].slides[0].text).toBe('Second verse text.');
    expect(live.hidden).toBe(true);
  });

  it('steps through the verses on screen with the arrow keys', () => {
    const s = useStore.getState();
    s.bibleStep(1);
    expect(useStore.getState().live.slide?.index).toBe(2);
    s.bibleStep(1);
    expect(useStore.getState().live.slide?.index).toBe(2);
    s.bibleStep(-1);
    expect(useStore.getState().live.slide?.index).toBe(1);
  });

  it('saves the passage to a library and playlist, or into the selected presentation', () => {
    const s = useStore.getState();
    s.setBibleDraft(draftOf(buildBibleSlides([english], settings(), 500)));
    const playlist = useStore.getState().playlists[0];
    const id = s.saveBible({ title: 'Genesis 25:30-32', category: 'scripture', playlistId: playlist.id })!;
    const saved = useStore.getState().presentations[id];
    expect([saved.title, saved.category, saved.themeId, saved.hidden]).toEqual(['Genesis 25:30-32', 'scripture', 'theme-bible', undefined]);
    expect(saved.groups[0].id).not.toBe(useStore.getState().presentations[BIBLE_DRAFT_ID].groups[0].id);
    expect(useStore.getState().playlists[0].items.some((i) => i.type === 'presentation' && i.presentationId === id)).toBe(true);

    const target = s.createPresentation({ title: 'Sermon' }, '[Intro]\nWelcome');
    s.copyBibleTo(target);
    const sermon = useStore.getState().presentations[target];
    expect(getSequence(sermon).map((e) => e.slide.text)).toEqual([
      'Welcome',
      'First verse text.',
      'Second verse text.',
      'Third verse text.',
    ]);
  });
});
