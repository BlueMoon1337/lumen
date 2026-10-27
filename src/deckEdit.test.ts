import { describe, expect, it } from 'vitest';
import type { DeckElement, DeckShape, DeckSlide } from './deck';
import {
  addElement,
  blankSlideLike,
  contains,
  deleteElement,
  duplicateElement,
  elementAt,
  formatText,
  hexOf,
  moveElement,
  newShape,
  newTextBox,
  placeElement,
  resizeBox,
  restackElement,
  rgba,
  slideWordsOf,
  textFormat,
} from './deckEdit';

const box = { rotation: 0, flipH: false, flipV: false };
const rect = (x: number, y: number, w: number, h: number, extra: Partial<DeckShape> = {}): DeckShape => ({
  kind: 'shape',
  x,
  y,
  w,
  h,
  ...box,
  geometry: { preset: 'rect', adjust: {} },
  fill: { kind: 'solid', color: 'rgba(0, 0, 0, 1)' },
  stroke: null,
  ...extra,
});
const withText = (x: number, y: number, words: string, extra: Partial<DeckShape> = {}): DeckShape => {
  const shape = newTextBox(slide([]), 1920, 1080, words);
  return { ...shape, x, y, ...extra };
};
const slide = (elements: DeckElement[]): DeckSlide => ({ background: null, elements, text: '', notes: '', hidden: false });

describe('the slide editor', () => {
  // The design's band across the top, then the slide's own title and a box.
  const design = rect(0, 0, 1920, 100, { template: true });
  const title = withText(100, 40, 'Welcome', { placeholder: 'title' });
  const square = rect(800, 500, 200, 200);
  const s = slide([design, title, square]);

  it('selects the topmost of the slide’s own shapes, never the design’s', () => {
    expect(elementAt(s, 900, 600)).toBe(2);
    expect(elementAt(s, 1800, 50)).toBeNull();
    // A shape turned 45° covers its corners' diagonals, not its unturned corners.
    const turned = { ...square, rotation: 45 };
    expect(contains(turned, 900, 600 - 135)).toBe(true);
    expect(contains(turned, 800 + 2, 500 + 2, 0)).toBe(false);
  });

  it('moves groups with their shapes', () => {
    const group: DeckElement = { kind: 'group', x: 0, y: 0, w: 100, h: 100, ...box, children: [rect(10, 10, 20, 20)] };
    const moved = moveElement(group, 5, 7);
    expect(moved).toMatchObject({ x: 5, y: 7 });
    expect(moved.kind === 'group' && moved.children[0]).toMatchObject({ x: 15, y: 17 });
    const placed = placeElement(group, { x: 0, y: 0, w: 200, h: 50, rotation: 0 });
    expect(placed.kind === 'group' && placed.children[0]).toMatchObject({ x: 20, y: 5, w: 40, h: 10 });
  });

  it('resizes from a handle, keeping the opposite side where it is', () => {
    const b = { x: 100, y: 100, w: 200, h: 100, rotation: 0 };
    expect(resizeBox(b, { sx: 1, sy: 1 }, 50, 20)).toEqual({ x: 100, y: 100, w: 250, h: 120, rotation: 0 });
    expect(resizeBox(b, { sx: -1, sy: 0 }, 50, 20)).toEqual({ x: 150, y: 100, w: 150, h: 100, rotation: 0 });
    // Shift keeps the shape.
    expect(resizeBox(b, { sx: 1, sy: 1 }, 200, 0, true)).toMatchObject({ w: 400, h: 200 });
    // Turned upside down, dragging the bottom-right handle down grows it upward on the slide.
    const r = resizeBox({ ...b, rotation: 180 }, { sx: 1, sy: 1 }, 0, -40);
    expect(r.h).toBeCloseTo(140);
    expect(r.y).toBeCloseTo(60);
    // Never smaller than a few pixels.
    expect(resizeBox(b, { sx: 1, sy: 0 }, -500, 0).w).toBeGreaterThan(0);
  });

  it('adds, duplicates, deletes and restacks, keeping the design at the back', () => {
    const added = addElement(s, newShape('ellipse', 1920, 1080));
    expect(added.index).toBe(3);
    const dup = duplicateElement(added.slide, 2);
    expect(dup.slide.elements[3]).toMatchObject({ x: 830, y: 530 });
    expect(deleteElement(s, 2).elements).toHaveLength(2);
    const back = restackElement(s, 2, -Infinity);
    expect(back.index).toBe(1);
    expect(back.slide.elements[0]).toBe(design);
    expect(restackElement(s, 1, Infinity).index).toBe(2);
  });

  it('changes a text box’s look, settling PowerPoint’s shrink-to-fit', () => {
    const shrunk = { ...title, text: { ...title.text!, fontScale: 0.5 } };
    expect(textFormat(shrunk.text).size).toBe(24);
    const bigger = formatText(shrunk.text, { size: 36, bold: true, align: 'right', color: 'rgba(255, 0, 0, 1)' });
    expect(bigger.fontScale).toBe(1);
    expect(textFormat(bigger)).toMatchObject({ size: 36, bold: true, align: 'right', color: 'rgba(255, 0, 0, 1)' });
  });

  it('keeps a slide’s design for a new blank slide', () => {
    const blank = blankSlideLike({ ...s, background: { kind: 'solid', color: 'red' } });
    expect(blank.elements).toEqual([design]);
    expect(blank.background).toEqual({ kind: 'solid', color: 'red' });
  });

  it('reads a slide’s words from the top down, without the slide number', () => {
    const body = withText(100, 300, 'First line');
    const number = withText(1800, 1000, '7', { placeholder: 'sldNum' });
    expect(slideWordsOf(slide([design, body, number, title]))).toBe('Welcome\n\nFirst line');
  });

  it('converts colours for colour pickers', () => {
    expect(hexOf('rgba(255, 128, 0, 0.5)')).toEqual({ hex: '#ff8000', alpha: 0.5 });
    expect(hexOf('rgb(1, 2, 3)')).toEqual({ hex: '#010203', alpha: 1 });
    expect(rgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
  });
});
