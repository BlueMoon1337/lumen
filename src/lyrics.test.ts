import { describe, expect, it } from 'vitest';
import { getSequence, parseLyrics, presentationToText } from './lyrics';
import type { Presentation } from './types';

const make = (text: string): Presentation => ({ id: 'p', title: 'T', category: 'song', updatedAt: 0, ...parseLyrics(text) });

describe('parseLyrics', () => {
  it('splits groups on headers and slides on blank lines', () => {
    const { groups } = parseLyrics('[Verse 1]\na\nb\n\nc\n\n[Chorus]\nd');
    expect(groups.map((g) => g.name)).toEqual(['Verse 1', 'Chorus']);
    expect(groups[0].slides.map((s) => s.text)).toEqual(['a\nb', 'c']);
    expect(groups[1].slides.map((s) => s.text)).toEqual(['d']);
  });

  it('treats an empty repeated header as a repeat in the arrangement', () => {
    const { groups, arrangement } = parseLyrics('[Verse 1]\na\n\n[Chorus]\nc\n\n[Verse 2]\nb\n\n[Chorus]');
    expect(groups).toHaveLength(3);
    expect(arrangement.map((id) => groups.find((g) => g.id === id)!.name)).toEqual(['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
  });

  it('renames a repeated header that has different lines', () => {
    const { groups } = parseLyrics('[Chorus]\na\n\n[Chorus]\nb');
    expect(groups.map((g) => g.name)).toEqual(['Chorus', 'Chorus 2']);
  });

  it('reads captions and stage notes', () => {
    const [slide] = parseLyrics('[John 3:16]\nFor God so loved\n~ John 3:16\n> slow').groups[0].slides;
    expect(slide).toMatchObject({ text: 'For God so loved', caption: 'John 3:16', notes: 'slow' });
  });

  it('puts text without a header into a default group', () => {
    const { groups } = parseLyrics('hello\n\nworld');
    expect(groups[0].name).toBe('Verse 1');
    expect(groups[0].slides).toHaveLength(2);
  });

  it('assigns colors by group type', () => {
    const { groups } = parseLyrics('[Chorus]\na\n\n[Pre-Chorus]\nb');
    expect(groups[0].color).not.toBe(groups[1].color);
  });
});

describe('presentationToText', () => {
  it('round-trips through the parser', () => {
    const text = '[Verse 1]\na\nb\n\nc\n~ cap\n> note\n\n[Chorus]\nd\n\n[Verse 2]\ne\n\n[Chorus]';
    expect(presentationToText(make(text))).toBe(text);
  });
});

describe('getSequence', () => {
  it('expands the arrangement into slides in order', () => {
    const seq = getSequence(make('[V]\n1\n\n2\n\n[C]\n3\n\n[V]'));
    expect(seq.map((e) => e.slide.text)).toEqual(['1', '2', '3', '1', '2']);
    expect(seq.map((e) => e.indexInGroup)).toEqual([0, 1, 0, 0, 1]);
  });
});
