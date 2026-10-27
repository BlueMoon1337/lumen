/**
 * Editing a PowerPoint or Keynote slide (Lumen's model of it, src/deck.ts): what the slide
 * editor's moves, resizes, text and formatting changes do. Each takes a slide and gives a new
 * one, so the editor can show a change as it's made and keep it as one step for Undo.
 *
 * Elements are addressed by their place in `slide.elements`. The slide master's and layout's
 * shapes (the slide's design, `template`) stay put; the slide's own can be changed.
 */
import type { DeckElement, DeckFill, DeckParagraph, DeckRun, DeckShape, DeckSlide, DeckStroke, DeckText } from './deck';

export const MIN_ELEMENT = 8;

export type Box = Pick<DeckElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>;

/** Which corner or side a resize handle is on: -1, 0 or 1 across and down. */
export type HandleDir = { sx: -1 | 0 | 1; sy: -1 | 0 | 1 };

const replaceAt = <T>(list: T[], i: number, item: T) => list.map((x, j) => (j === i ? item : x));

export const isEditable = (e: DeckElement) => !e.template;

/** The topmost of the slide's own elements under a point, if any. */
export function elementAt(slide: DeckSlide, x: number, y: number): number | null {
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    const e = slide.elements[i];
    if (isEditable(e) && contains(e, x, y)) return i;
  }
  return null;
}

/** Whether a point is in an element's box, turned as it is. */
export function contains(e: Box, x: number, y: number, slack = 6): boolean {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const a = (-e.rotation * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= e.w / 2 + slack && Math.abs(ly) <= e.h / 2 + slack;
}

/** Moves an element (a group's shapes go with it). */
export function moveElement(e: DeckElement, dx: number, dy: number): DeckElement {
  const moved = { ...e, x: e.x + dx, y: e.y + dy };
  if (moved.kind === 'group') moved.children = moved.children.map((c) => moveElement(c, dx, dy));
  return moved;
}

/**
 * The box after dragging a resize handle by (dx, dy) on the slide: the opposite side stays
 * where it is, also when the element is turned. `keepAspect` keeps its shape (Shift).
 */
export function resizeBox(box: Box, dir: HandleDir, dx: number, dy: number, keepAspect = false): Box {
  const a = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // The drag in the element's own (unturned) directions.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  let w = Math.max(MIN_ELEMENT, box.w + dir.sx * lx);
  let h = Math.max(MIN_ELEMENT, box.h + dir.sy * ly);
  if (keepAspect && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    if (dir.sx && dir.sy) {
      if (w / box.w > h / box.h) h = w / ratio;
      else w = h * ratio;
    } else if (dir.sx) h = w / ratio;
    else w = h * ratio;
  }
  const dw = w - box.w;
  const dh = h - box.h;
  // The middle moves half the growth, toward the handle (or both ways when keeping the shape from a side).
  const mx = dir.sx ? (dir.sx * dw) / 2 : 0;
  const my = dir.sy ? (dir.sy * dh) / 2 : 0;
  const cx = box.x + box.w / 2 + mx * cos - my * sin;
  const cy = box.y + box.h / 2 + mx * sin + my * cos;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotation: box.rotation };
}

/** Puts an element in a new box: a group's shapes are scaled into it, text keeps its size. */
export function placeElement(e: DeckElement, box: Box): DeckElement {
  if (e.kind !== 'group') return { ...e, ...box };
  const sx = e.w ? box.w / e.w : 1;
  const sy = e.h ? box.h / e.h : 1;
  const fit = (c: DeckElement): DeckElement => {
    const placed = { ...c, x: box.x + (c.x - e.x) * sx, y: box.y + (c.y - e.y) * sy, w: c.w * sx, h: c.h * sy };
    if (placed.kind === 'group') placed.children = placed.children.map(fit);
    return placed;
  };
  return { ...e, ...box, children: e.children.map(fit) };
}

export const rotateElement = (e: DeckElement, degrees: number): DeckElement => ({ ...e, rotation: ((degrees % 360) + 360) % 360 });

export function updateElement(slide: DeckSlide, i: number, change: (e: DeckElement) => DeckElement): DeckSlide {
  const e = slide.elements[i];
  return e ? { ...slide, elements: replaceAt(slide.elements, i, change(e)) } : slide;
}

export function deleteElement(slide: DeckSlide, i: number): DeckSlide {
  return { ...slide, elements: slide.elements.filter((_, j) => j !== i) };
}

/** A copy just below and to the right of the original, in front of it. Returns the copy's place. */
export function duplicateElement(slide: DeckSlide, i: number): { slide: DeckSlide; index: number } {
  const e = slide.elements[i];
  if (!e) return { slide, index: i };
  const copy = moveElement(structuredClone(e), 30, 30);
  const elements = [...slide.elements];
  elements.splice(i + 1, 0, copy);
  return { slide: { ...slide, elements }, index: i + 1 };
}

/**
 * Moves an element forward (1) or back (-1) one, or to the front or back (±Infinity). It never
 * goes behind the slide's design. Returns its new place.
 */
export function restackElement(slide: DeckSlide, i: number, by: number): { slide: DeckSlide; index: number } {
  const floor = slide.elements.filter((e) => e.template).length;
  const last = slide.elements.length - 1;
  const to = Math.max(floor, Math.min(last, by === Infinity ? last : by === -Infinity ? floor : i + by));
  if (to === i || !slide.elements[i]) return { slide, index: i };
  const elements = [...slide.elements];
  const [e] = elements.splice(i, 1);
  elements.splice(to, 0, e);
  return { slide: { ...slide, elements }, index: to };
}

export function addElement(slide: DeckSlide, e: DeckElement): { slide: DeckSlide; index: number } {
  return { slide: { ...slide, elements: [...slide.elements, e] }, index: slide.elements.length };
}

// ---- Making new things --------------------------------------------------------------------------

/** The text a new text box or shape starts with: the slide's own body text's look, or plain. */
function textLook(slide: DeckSlide): Omit<DeckRun, 'text'> {
  const runs = slide.elements.flatMap(function all(e): DeckRun[] {
    if (e.kind === 'group') return e.children.flatMap(all);
    return e.kind === 'shape' && e.text && !e.template && e.placeholder !== 'title' && e.placeholder !== 'ctrTitle'
      ? e.text.paragraphs.flatMap((p) => p.runs.filter((r) => r.text.trim()))
      : [];
  });
  const r = runs[0];
  return {
    font: r?.font ?? '"Helvetica Neue", Arial, sans-serif',
    size: r?.size ?? 48,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: r?.color ?? 'rgba(0, 0, 0, 1)',
    caps: false,
    baseline: 0,
  };
}

export function paragraphOf(text: string, look: Omit<DeckRun, 'text'>, align: DeckParagraph['align'] = 'left'): DeckParagraph {
  return {
    align,
    marginLeft: 0,
    indent: 0,
    lineSpacing: { factor: 1 },
    spaceBefore: 0,
    spaceAfter: 0,
    runs: text ? [{ ...look, text }] : [],
    emptySize: look.size,
  };
}

const plainBox = { rotation: 0, flipH: false, flipV: false };

export function newTextBox(slide: DeckSlide, width: number, height: number, text = 'Text'): DeckShape {
  const look = textLook(slide);
  const h = look.size * 1.2 + 40;
  return {
    kind: 'shape',
    x: width * 0.2,
    y: (height - h) / 2,
    w: width * 0.6,
    h,
    ...plainBox,
    geometry: { preset: 'rect', adjust: {} },
    fill: null,
    stroke: null,
    text: {
      paragraphs: [paragraphOf(text, look, 'center')],
      insets: { l: 19, t: 10, r: 19, b: 10 },
      anchor: 'top',
      wrap: true,
      fontScale: 1,
      lineReduction: 0,
    },
  };
}

export const SHAPE_PRESETS = [
  { preset: 'rect', label: 'Rectangle' },
  { preset: 'roundRect', label: 'Rounded Rectangle' },
  { preset: 'ellipse', label: 'Oval' },
  { preset: 'triangle', label: 'Triangle' },
  { preset: 'rtTriangle', label: 'Right Triangle' },
  { preset: 'line', label: 'Line' },
] as const;

export function newShape(preset: string, width: number, height: number, color = 'rgba(68, 114, 196, 1)'): DeckShape {
  const line = preset === 'line';
  const size = Math.min(width, height) * 0.3;
  return {
    kind: 'shape',
    x: (width - size) / 2,
    y: (height - (line ? 0 : size)) / 2,
    w: size,
    h: line ? 0 : size,
    ...plainBox,
    geometry: { preset, adjust: {} },
    fill: line ? null : { kind: 'solid', color },
    stroke: line ? { color, width: 6 } : null,
  };
}

/** A picture stored in Lumen (`media:<id>`), as large as fits in the middle of the slide. */
export function newPicture(mediaId: string, natural: { w: number; h: number }, width: number, height: number): DeckElement {
  const k = Math.min((width * 0.6) / natural.w, (height * 0.6) / natural.h, 1);
  const w = natural.w * k;
  const h = natural.h * k;
  return {
    kind: 'picture',
    x: (width - w) / 2,
    y: (height - h) / 2,
    w,
    h,
    ...plainBox,
    image: `media:${mediaId}`,
    geometry: { preset: 'rect', adjust: {} },
    stroke: null,
  };
}

/** A new slide with the same design (background, master and layout shapes) as `like`. */
export function blankSlideLike(like: DeckSlide): DeckSlide {
  return { background: like.background, elements: like.elements.filter((e) => e.template), text: '', notes: '', hidden: false };
}

// ---- Formatting ---------------------------------------------------------------------------------

export interface TextFormat {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: DeckParagraph['align'];
  anchor: DeckText['anchor'];
}

/** How a text box's text looks, from its first run (what the inspector shows). */
export function textFormat(t: DeckText): TextFormat {
  const p = t.paragraphs.find((x) => x.runs.some((r) => r.text)) ?? t.paragraphs[0];
  const r = p?.runs.find((x) => x.text) ?? p?.runs[0];
  return {
    font: r?.font ?? 'sans-serif',
    size: (r?.size ?? p?.emptySize ?? 48) * t.fontScale,
    color: r?.color ?? 'rgba(0, 0, 0, 1)',
    bold: !!r?.bold,
    italic: !!r?.italic,
    underline: !!r?.underline,
    align: p?.align ?? 'left',
    anchor: t.anchor,
  };
}

/** Changes the look of all of a text box's text. A size is as shown, so it settles PowerPoint's shrink-to-fit. */
export function formatText(t: DeckText, patch: Partial<TextFormat>): DeckText {
  const runPatch: Partial<DeckRun> = {};
  if (patch.font !== undefined) runPatch.font = patch.font;
  if (patch.color !== undefined) runPatch.color = patch.color;
  if (patch.bold !== undefined) runPatch.bold = patch.bold;
  if (patch.italic !== undefined) runPatch.italic = patch.italic;
  if (patch.underline !== undefined) runPatch.underline = patch.underline;
  // A new size: every run scales by the same amount, so sizes within the box keep their proportions.
  const current = textFormat(t).size;
  const k = patch.size !== undefined && current > 0 ? patch.size / current : 1;
  const scaled = patch.size !== undefined;
  return {
    ...t,
    anchor: patch.anchor ?? t.anchor,
    fontScale: scaled ? 1 : t.fontScale,
    lineReduction: scaled ? 0 : t.lineReduction,
    paragraphs: t.paragraphs.map((p) => ({
      ...p,
      align: patch.align ?? p.align,
      emptySize: scaled ? p.emptySize * t.fontScale * k : p.emptySize,
      lineSpacing: scaled && 'px' in p.lineSpacing ? { px: p.lineSpacing.px * t.fontScale * k } : p.lineSpacing,
      runs: p.runs.map((r) => ({ ...r, ...runPatch, ...(scaled ? { size: r.size * t.fontScale * k } : {}) })),
    })),
  };
}

export const setFill = (e: DeckElement, fill: DeckFill | null): DeckElement => (e.kind === 'shape' ? { ...e, fill } : e);
export const setStroke = (e: DeckElement, stroke: DeckStroke | null): DeckElement =>
  e.kind === 'shape' || e.kind === 'picture' ? { ...e, stroke } : e;

// ---- Words --------------------------------------------------------------------------------------

const UNSPOKEN = new Set(['sldNum', 'dt', 'ftr']);

export const textOf = (t: DeckText) => t.paragraphs.map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n');

/** A slide's words, its own shapes' text from the top down (not the slide number, date or footer). */
export function slideWordsOf(slide: DeckSlide): string {
  const found: { y: number; x: number; text: string }[] = [];
  const walk = (e: DeckElement) => {
    if (e.template) return;
    if (e.kind === 'group') return e.children.forEach(walk);
    if (e.kind !== 'shape' || !e.text || UNSPOKEN.has(e.placeholder ?? '')) return;
    const text = textOf(e.text).trim();
    if (text) found.push({ y: e.y, x: e.x, text });
  };
  slide.elements.forEach(walk);
  return found
    .sort((a, b) => (Math.abs(a.y - b.y) > 10 ? a.y - b.y : a.x - b.x))
    .map((f) => f.text)
    .join('\n\n');
}

/** The colour as #rrggbb (for colour pickers) and its opacity. */
export function hexOf(color: string): { hex: string; alpha: number } {
  const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (m) {
    const hex = `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
    return { hex, alpha: m[4] === undefined ? 1 : Number(m[4]) };
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) return { hex: color.toLowerCase(), alpha: 1 };
  return { hex: '#000000', alpha: 1 };
}

export function rgba(hex: string, alpha = 1): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
