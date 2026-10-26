import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, installHistory, undo } from './history';
import { useStore } from './store';

installHistory();

const s = () => useStore.getState();
const make = () => {
  const id = s().createPresentation({ title: 'Song' }, '[Verse 1]\na\n\nb\n\n[Chorus]\nc\n\nd');
  s().select(id);
  return () => s().presentations[id];
};
const texts = (get: ReturnType<typeof make>) => get().groups.flatMap((g) => g.slides.map((sl) => sl.text));
const ids = (get: ReturnType<typeof make>) => get().groups.flatMap((g) => g.slides.map((sl) => sl.id));

beforeEach(() => clearHistory());

describe('selected slides', () => {
  it('are forgotten when another presentation is selected, and lose deleted slides', () => {
    const get = make();
    const [a, b] = ids(get);
    s().setUI({ selectedSlideIds: [a, b] });
    s().select(get().id);
    expect(s().selectedSlideIds).toEqual([a, b]);
    s().deleteSlide(get().id, a);
    expect(s().selectedSlideIds).toEqual([b]);
    const other = s().createPresentation({ title: 'Other' }, 'x');
    s().select(other);
    expect(s().selectedSlideIds).toEqual([]);
  });

  it('duplicate in place, each after its slide, as one step', () => {
    const get = make();
    const [a, , c] = ids(get);
    clearHistory();
    const copies = s().duplicateSlides(get().id, [a, c]);
    expect(texts(get)).toEqual(['a', 'a', 'b', 'c', 'c', 'd']);
    expect(s().selectedSlideIds).toEqual(copies);
    expect(undo()).toBe('Duplicate Slides (Song)');
    expect(texts(get)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('delete together, as one step', () => {
    const get = make();
    const [a, , , d] = ids(get);
    clearHistory();
    s().deleteSlides(get().id, [a, d]);
    expect(texts(get)).toEqual(['b', 'c']);
    expect(undo()).toBe('Delete Slides (Song)');
    expect(texts(get)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('paste after the last one, selected, and Paste and Match Style drops their own formatting', () => {
    const get = make();
    const [a, b, c] = ids(get);
    s().updateSlide(get().id, a, { style: { color: '#ff0000' } });
    s().copySlides(get().id, [a, b]);
    s().pasteSlides(get().id, c);
    expect(texts(get)).toEqual(['a', 'b', 'c', 'a', 'b', 'd']);
    const pasted = s().selectedSlideIds;
    expect(pasted).toHaveLength(2);
    expect(get().groups[1].slides[1].style).toEqual({ color: '#ff0000' });
    s().pasteSlides(get().id, null, { matchStyle: true });
    const last = get().groups.at(-1)!.slides;
    expect(last.at(-2)).toMatchObject({ text: 'a' });
    expect(last.at(-2)!.style).toBeUndefined();
  });

  it('take a pasted text style together', () => {
    const get = make();
    const [a, b, c] = ids(get);
    s().updateSlide(get().id, a, { style: { fontSize: 99 } });
    s().copyTextStyle(get().id, a);
    s().pasteTextStyle(get().id, { slideIds: [b, c] });
    const slides = get().groups.flatMap((g) => g.slides);
    expect(slides[1].style?.fontSize).toBe(99);
    expect(slides[2].style?.fontSize).toBe(99);
    expect(slides[3].style).toBeUndefined();
  });
});
