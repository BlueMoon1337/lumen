import { beforeEach, describe, expect, it } from 'vitest';
import {
  encodeJson,
  mediaUsedBy,
  planImport,
  playlistFile,
  presentationFile,
  presentationText,
  readLumenFile,
  safeFileName,
  themesFile,
  zipFile,
} from './fileFormats';
import { clearHistory, installHistory, undo } from './history';
import { getSequence, parseLyrics, slidesEvery, titleFromText } from './lyrics';
import { extensionsOf } from './components/ui';
import { wrapLines } from './slideImages';
import { DEFAULT_LIBRARIES, librariesFor, useStore } from './store';
import type { Presentation, Theme } from './types';

installHistory();

const s = () => useStore.getState();
const startThemes = useStore.getState().themes;
const theme = (id: string, extra: Partial<Theme> = {}): Theme => ({ ...structuredClone(s().themes[0]), id, name: id, ...extra });

beforeEach(() => {
  s().clearAll();
  useStore.setState({ libraries: DEFAULT_LIBRARIES, themes: startThemes, media: [], mediaPlaylists: [] });
  clearHistory();
});

describe('libraries', () => {
  it('can be added, renamed, and deleted with their presentations, which Undo brings back', () => {
    const lib = s().createLibrary('Christmas');
    expect(s()).toMatchObject({ sidebar: 'library', libraryCategory: lib });
    s().renameLibrary(lib, 'Advent');
    const carol = s().createPresentation({ title: 'Silent Night', category: lib }, 'Silent night');
    s().addToPlaylist(carol);
    s().select(carol);
    s().goLive(carol, 0);
    clearHistory();

    s().deleteLibrary(lib);
    expect(s().libraries.map((l) => l.name)).toEqual(['Songs', 'Scripture', 'Announcements', 'Other']);
    expect(s().presentations[carol]).toBeUndefined();
    expect(s().playlists[0].items.some((it) => it.type === 'presentation' && it.presentationId === carol)).toBe(false);
    expect(s().live.slide).toBeNull();
    // The sidebar moves to a library that's still there.
    expect(s().libraryCategory).toBe('other');

    expect(undo()).toBe('Delete Library (Silent Night)');
    expect(s().libraries.at(-1)).toEqual({ id: lib, name: 'Advent' });
    expect(s().presentations[carol].title).toBe('Silent Night');
  });

  it('always keep one', () => {
    useStore.setState({ libraries: [{ id: 'song', name: 'Songs' }] });
    s().deleteLibrary('song');
    expect(s().libraries).toHaveLength(1);
  });

  it('come back for presentations whose library is missing', () => {
    const p = { id: 'p', title: 'x', category: 'retreat', groups: [], arrangement: [] } as unknown as Presentation;
    expect(librariesFor(undefined, { p }).map((l) => l.id)).toEqual(['song', 'scripture', 'announcement', 'other', 'retreat']);
    expect(librariesFor([{ id: 'song', name: 'Hymns' }], { p: { ...p, category: 'scripture' } })).toEqual([
      { id: 'song', name: 'Hymns' },
      { id: 'scripture', name: 'Scripture' },
    ]);
  });
});

describe('deleting', () => {
  it('a presentation clears it from both slide layers', () => {
    const id = s().createPresentation({ title: 'Notices', destination: 'announcements' }, 'One\n\nTwo');
    s().goLive(id, 0);
    expect(s().live.announcement).not.toBeNull();
    s().deletePresentation(id);
    expect(s().live.announcement).toBeNull();
  });

  it('media takes it off slide backgrounds as well as media cues', () => {
    useStore.setState({ media: [{ id: 'm1', name: 'Clouds', kind: 'image', mime: 'image/jpeg' }] });
    const id = s().createPresentation({ title: 'Song' }, 'a\n\nb');
    const [a, b] = s().presentations[id].groups[0].slides;
    s().updateSlide(id, a.id, { background: { type: 'media', color: '#000', color2: '#000', mediaId: 'm1' } });
    s().updateSlide(id, b.id, { media: 'm1' });
    s().deleteMedia('m1');
    const slides = s().presentations[id].groups[0].slides;
    expect(slides[0].background).toBeUndefined();
    expect(slides[1].media).toBeUndefined();
  });
});

describe('Lumen files', () => {
  const song = () => {
    useStore.setState({
      themes: [...s().themes, theme('mine', { background: { type: 'media', color: '#000', color2: '#000', mediaId: 'bg' } })],
    });
    useStore.setState({
      media: [
        { id: 'bg', name: 'Background', kind: 'video', mime: 'video/mp4' },
        { id: 'cue', name: 'Countdown', kind: 'video', mime: 'video/mp4' },
        { id: 'other', name: 'Unused', kind: 'image', mime: 'image/png' },
      ],
    });
    const id = s().createPresentation(
      { title: 'Amazing Grace', themeId: 'mine' },
      '[Verse 1]\nAmazing grace\n\nHow sweet\n\n[Chorus]\nMy chains\n\n[Verse 1]',
    );
    s().updateSlide(id, s().presentations[id].groups[0].slides[0].id, { media: 'cue' });
    return id;
  };

  it('carry a presentation with the theme it chose and the media it uses', () => {
    const id = song();
    const file = presentationFile(s(), id);
    expect(file.kind).toBe('presentation');
    expect(file.themes.map((t) => t.id)).toEqual(['mine']);
    expect(file.media.map((m) => m.id).sort()).toEqual(['bg', 'cue']);
    expect(mediaUsedBy(file.presentations, file.themes).sort()).toEqual(['bg', 'cue']);
  });

  it('come back in as new presentations, sharing what the library already has', () => {
    const id = song();
    const file = presentationFile(s(), id);
    const { file: read, blobs } = readLumenFile(encodeJson(file));
    const plan = planImport(s(), read, blobs, 'other');
    expect(plan.themes).toEqual([]);
    expect(plan.themeIds.get('mine')).toBe('mine');
    const [p] = plan.presentations;
    expect(p.id).not.toBe(id);
    expect(p).toMatchObject({ category: 'other', themeId: 'mine', title: 'Amazing Grace' });
    expect(getSequence(p).map((e) => e.slide.text)).toEqual(['Amazing grace', 'How sweet', 'My chains', 'Amazing grace', 'How sweet']);
    expect(p.groups[0].slides[0].media).toBe('cue');
  });

  it('bring their theme as a copy when the library’s differs, and leave out media they have no file for', () => {
    const id = song();
    const file = presentationFile(s(), id);
    useStore.setState({ themes: s().themes.map((t) => (t.id === 'mine' ? { ...t, fontSize: 10 } : t)), media: [] });
    const plan = planImport(s(), file, new Map([['cue', new Uint8Array([1])]]), 'song');
    expect(plan.themes).toHaveLength(1);
    expect(plan.themes[0].id).not.toBe('mine');
    expect(plan.themes[0].background.mediaId).toBeUndefined();
    expect(plan.presentations[0].themeId).toBe(plan.themes[0].id);
    expect(plan.media.map((m) => m.id)).toEqual(['cue']);
    expect(plan.presentations[0].groups[0].slides[0].media).toBe('cue');
  });

  it('zip with their media, and read back', () => {
    const id = song();
    const file = presentationFile(s(), id);
    const zipped = zipFile(file, new Map([['cue', new Uint8Array([1, 2, 3])]]));
    const { file: read, blobs } = readLumenFile(zipped);
    expect(read.presentations[0].title).toBe('Amazing Grace');
    expect([...blobs.keys()]).toEqual(['cue']);
    expect([...blobs.get('cue')!]).toEqual([1, 2, 3]);
  });

  it('carry a playlist in order, with headers', () => {
    const id = song();
    const playlist = {
      id: 'pl',
      name: 'Sunday',
      items: [
        { id: 'h', type: 'header' as const, label: 'Worship' },
        { id: 'a', type: 'presentation' as const, presentationId: id },
        { id: 'b', type: 'presentation' as const, presentationId: id },
        { id: 'c', type: 'presentation' as const, presentationId: 'gone' },
      ],
    };
    const file = playlistFile(s(), playlist);
    expect(file.presentations).toHaveLength(1);
    const plan = planImport(s(), file, new Map(), 'song');
    const newId = plan.presentations[0].id;
    expect(plan.playlist).toMatchObject({
      name: 'Sunday',
      items: [
        { type: 'header', label: 'Worship' },
        { type: 'presentation', presentationId: newId },
        { type: 'presentation', presentationId: newId },
      ],
    });
  });

  it('carry themes', () => {
    const file = themesFile(s(), [theme('a'), theme('b')]);
    const plan = planImport(useStore.getState(), file, new Map(), 'song');
    expect(plan.themes.map((t) => t.id)).toEqual(['a', 'b']);
    expect(plan.presentations).toEqual([]);
  });

  it('turn away other files', () => {
    expect(() => readLumenFile(new TextEncoder().encode('{"hello":1}'))).toThrow('This isn’t a Lumen file.');
    expect(() => readLumenFile(new TextEncoder().encode('not json'))).toThrow('This isn’t a Lumen file.');
    const id = song();
    const newer = { ...presentationFile(s(), id), version: 2 };
    expect(() => readLumenFile(new TextEncoder().encode(JSON.stringify(newer)))).toThrow('newer Lumen');
  });

  it('export text that imports back as the same slides', () => {
    const id = song();
    const p = s().presentations[id];
    const [title, ...rest] = presentationText(p).split('\n\n');
    expect(title).toBe('Amazing Grace');
    const again = parseLyrics(rest.join('\n\n'));
    expect(getSequence({ ...p, ...again }).map((e) => e.slide.text)).toEqual(getSequence(p).map((e) => e.slide.text));
  });

  it('get names file systems accept', () => {
    expect(safeFileName('AC/DC: Live? "Best"')).toBe('AC DC Live Best');
    expect(safeFileName('...hidden')).toBe('hidden');
    expect(safeFileName('  ')).toBe('Untitled');
  });
});

describe('the desktop Open panel', () => {
  it('offers the extensions a file input would accept', () => {
    expect(extensionsOf('.pro,.proplaylist,text/plain')).toEqual(['pro', 'proplaylist', 'txt']);
    expect(extensionsOf('audio/*')).toContain('m4a');
    expect(extensionsOf('image/*,.HEIC')).toContain('heic');
  });
});

describe('text from the clipboard', () => {
  it('can start a slide every few lines', () => {
    expect(slidesEvery('a\nb\nc\nd\ne', 2)).toBe('a\nb\n\nc\nd\n\ne');
    // Headers and blank lines still start a slide.
    expect(slidesEvery('[Verse]\na\nb\nc\n\n\nd\n[Chorus]\ne', 2)).toBe('[Verse]\na\nb\n\nc\n\nd\n\n[Chorus]\ne');
    expect(parseLyrics(slidesEvery('one\ntwo\nthree', 1)).groups[0].slides.map((sl) => sl.text)).toEqual(['one', 'two', 'three']);
  });

  it('gets its title from the first line', () => {
    expect(titleFromText('\n[Verse 1]\nAmazing grace, how sweet the sound,\nThat saved')).toBe('Amazing grace, how sweet the sound');
    expect(titleFromText('')).toBe('');
  });
});

describe('slide images', () => {
  it('wrap lines between words, as the screens do', () => {
    const measure = (t: string) => t.length * 10;
    expect(wrapLines('Amazing grace how sweet the sound', 130, measure)).toEqual(['Amazing grace', 'how sweet the', 'sound']);
    expect(wrapLines('one\n\ntwo', 100, measure)).toEqual(['one', '', 'two']);
    // A word too long for the line stays whole (and the text shrinks to fit it).
    expect(wrapLines('Hallelujah', 50, measure)).toEqual(['Hallelujah']);
  });
});
