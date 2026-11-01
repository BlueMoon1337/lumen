import type { DeckElement, DeckParagraph, DeckRun, EditableSlide } from '../deck';
import { cssFamilyFor, styleFromName } from '../fonts';
import { transitionFromPro } from '../transitions';
import type { ColorLabel, SlideTransition, TextStyle } from '../types';
import { PbMessage } from './protobuf';
import { rtfToParagraphs, rtfToText, type RtfParagraph } from './rtf';

export interface ImportedSlide {
  /** The slide's words (all its boxes', top to bottom, for a slide kept as boxes). */
  text: string;
  notes?: string;
  /** Its one text box's position and formatting, where they differ from the presentation's. */
  style?: TextStyle;
  /**
   * A slide with several text boxes (or one with mixed fonts, sizes or colors), kept as it was
   * laid out: drawn from Lumen's slide model (src/deck.ts), like an imported PowerPoint slide.
   */
  deck?: EditableSlide;
  /** The slide's label in ProPresenter ("Pastor", "Anuncios"), with its color. */
  label?: ColorLabel;
}

export interface ImportedGroup {
  name: string;
  /** Hex color, when the file set one. */
  color?: string;
  slides: ImportedSlide[];
}

export interface ImportedPresentation {
  title: string;
  groups: ImportedGroup[];
  /** Indices into `groups`, in performance order. */
  arrangement: number[];
  author?: string;
  artist?: string;
  album?: string;
  publisher?: string;
  year?: string;
  ccli?: string;
  showCopyright?: boolean;
  transition?: SlideTransition;
  /** The font, size, color and alignment most of the slides use. */
  style?: TextStyle;
}

// Field numbers from ProPresenter 7's (unofficial) protobuf schema.
const PRESENTATION = { name: 3, selectedArrangement: 10, arrangements: 11, cueGroups: 12, cues: 13, ccli: 14, transition: 18 };
const ARRANGEMENT = { uuid: 1, groupIds: 3 };
const CUE_GROUP = { group: 1, cueIds: 2 };
const GROUP = { uuid: 1, name: 2, color: 3 };
const CUE = { uuid: 1, actions: 10 };
// A slide action's label (3): text (2), color (3).
const ACTION = { label: 3 };
const LABEL = { text: 2, color: 3 };
/** A label ProPresenter saved without a color. */
const LABEL_GREY = '#8e8e93';
// Slide → elements (1) → element (1): name (2), bounds (3: origin (1) x, y; size (2) w, h), rotation (4),
// hidden (16), text (13: attributes (3), RTF (5), vertical alignment (6)). The slide's size is field 6.
const SLIDE = { elements: 1, size: 6 };
const ELEMENT = { bounds: 3, rotation: 4, text: 13, hidden: 16 };
const TEXT = { attributes: 3, rtf: 5, verticalAlign: 6 };
const VALIGN: Record<number, TextStyle['verticalAlign']> = { 0: 'top', 1: 'middle', 2: 'bottom' };
// Transition → effect (3) → name (3) and variables (7); a variable's direction (6) → direction (1).
const TRANSITION = { duration: 1, effect: 3 };
const EFFECT = { name: 3, variables: 7 };
const EFFECT_VARIABLE = { direction: 6 };
const CCLI = { author: 1, artist: 2, title: 3, publisher: 4, year: 5, songNumber: 6, display: 7, album: 8 };
// Graphics element → text (13) → attributes (3) → font (1) / color (3) / paragraph (6).
const TEXT_ATTRIBUTES = { font: 1, color: 3, paragraph: 6 };
const FONT = { name: 1, size: 2, family: 9 };
/** ProPresenter paragraph alignment values. */
const ALIGN: Record<number, TextStyle['textAlign']> = { 0: 'left', 1: 'right', 2: 'center' };

const utf8 = new TextDecoder('utf-8');
const uuidOf = (m: PbMessage | undefined) => m?.string(1) ?? '';

function toHex(color: PbMessage): string {
  const c = (field: number) =>
    Math.round(Math.min(1, Math.max(0, color.number(field) ?? 0)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(1)}${c(2)}${c(3)}`;
}

function richText(bytes: Uint8Array | undefined): string {
  if (!bytes?.length) return '';
  const s = utf8.decode(bytes);
  return s.trimStart().startsWith('{\\rtf') ? rtfToText(s) : s.trim();
}

/** Finds RTF payloads anywhere below a message, for files that nest text differently. */
function findRtf(m: PbMessage, depth = 0, out: string[] = []): string[] {
  if (depth > 12) return out;
  for (const f of m.fields) {
    if (!(f.value instanceof Uint8Array) || f.value.length < 6) continue;
    const head = utf8.decode(f.value.subarray(0, 6));
    if (head === '{\\rtf1') out.push(rtfToText(utf8.decode(f.value)));
    else {
      try {
        findRtf(PbMessage.parse(f.value), depth + 1, out);
      } catch {
        // Not a nested message.
      }
    }
  }
  return out;
}

/** The font a PostScript name stands for: "TimesNewRomanPSMT" → Times New Roman, "HelveticaNeue-Bold" → Helvetica Neue. */
function familyOf(postscript: string): string {
  return postscript
    .replace(/-.*$/, '')
    .replace(/(PSMT|PS|MT)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

/** Formatting of a text box, as Lumen text style. */
function readStyle(text: PbMessage | undefined): TextStyle | undefined {
  const attrs = text?.message(TEXT.attributes);
  if (!attrs) return undefined;
  const style: TextStyle = {};
  const font = attrs.message(TEXT_ATTRIBUTES.font);
  const postscript = font?.string(FONT.name)?.trim();
  const family = font?.string(FONT.family)?.trim() || (postscript && familyOf(postscript));
  if (family) style.fontFamily = cssFamilyFor(family);
  if (postscript) {
    const face = styleFromName(postscript);
    style.fontWeight = face.weight;
    if (face.italic) style.italic = true;
  }
  const size = font?.number(FONT.size);
  if (size && size > 0) style.fontSize = Math.round(size);
  const color = attrs.message(TEXT_ATTRIBUTES.color);
  if (color) style.color = toHex(color);
  const paragraph = attrs.message(TEXT_ATTRIBUTES.paragraph);
  if (paragraph) {
    const align = ALIGN[paragraph.number(1) ?? 0];
    if (align) style.textAlign = align;
  }
  return Object.keys(style).length ? style : undefined;
}

/** A text box on a slide: where it is (px of the slide), and its formatted text. */
interface ProBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  valign?: TextStyle['verticalAlign'];
  paragraphs: RtfParagraph[];
  /** The box's own formatting (ProPresenter's text attributes), for what the text doesn't say. */
  base?: TextStyle;
  /** The PostScript name of the box's font, and its family. */
  postscript?: string;
  family?: string;
  rtf: string;
}

function readBox(element: PbMessage): ProBox | null {
  const text = element.message(ELEMENT.text);
  const bytes = text?.bytes(TEXT.rtf);
  if (!text || !bytes?.length || element.number(ELEMENT.hidden)) return null;
  const raw = utf8.decode(bytes);
  const isRtf = raw.trimStart().startsWith('{\\rtf');
  const paragraphs: RtfParagraph[] = isRtf
    ? rtfToParagraphs(raw)
    : raw
        .trim()
        .split(/\r?\n/)
        .map((line) => ({ align: 'left' as const, runs: line ? [{ text: line, bold: false, italic: false }] : [] }));
  if (!paragraphs.some((p) => p.runs.length)) return null;
  const bounds = element.message(ELEMENT.bounds);
  const origin = bounds?.message(1);
  const size = bounds?.message(2);
  const font = text.message(TEXT.attributes)?.message(TEXT_ATTRIBUTES.font);
  const valign = text.number(TEXT.verticalAlign);
  return {
    x: origin?.number(1) ?? 0,
    y: origin?.number(2) ?? 0,
    w: size?.number(1) ?? 0,
    h: size?.number(2) ?? 0,
    rotation: element.number(ELEMENT.rotation) ?? 0,
    valign: valign !== undefined ? VALIGN[valign] : undefined,
    paragraphs,
    base: readStyle(text),
    postscript: font?.string(FONT.name)?.trim(),
    family: font?.string(FONT.family)?.trim(),
    rtf: isRtf ? rtfToText(raw) : raw.trim(),
  };
}

/** One box in one format throughout: it can be a Lumen text slide. */
function isPlain(box: ProBox): boolean {
  const runs = box.paragraphs.flatMap((p) => p.runs);
  const key = (r: (typeof runs)[number]) => `${r.font}|${r.size}|${r.color}|${r.bold}|${r.italic}`;
  const aligns = new Set(box.paragraphs.filter((p) => p.runs.length).map((p) => p.align));
  return new Set(runs.map(key)).size <= 1 && aligns.size <= 1;
}

/** A plain box's formatting and place, as Lumen text style (insets in % of the slide). */
function boxStyle(box: ProBox, slideW: number, slideH: number): TextStyle | undefined {
  const style: TextStyle = { ...box.base };
  const run = box.paragraphs.flatMap((p) => p.runs)[0];
  if (run?.font && run.font !== box.postscript) {
    style.fontFamily = cssFamilyFor(familyOf(run.font));
    const face = styleFromName(run.font);
    style.fontWeight = face.weight;
    if (face.italic) style.italic = true;
  }
  if (run?.bold && (style.fontWeight ?? 400) < 600) style.fontWeight = 700;
  if (run?.italic) style.italic = true;
  if (run?.size) style.fontSize = Math.round(run.size);
  if (run?.color) style.color = run.color;
  const align = box.paragraphs.find((p) => p.runs.length)?.align;
  if (align && align !== 'justify' && (run?.font || run?.size || run?.color || !style.textAlign)) style.textAlign = align;
  if (box.valign) style.verticalAlign = box.valign;
  if (box.w > 0 && box.h > 0) {
    const pct = (v: number) => Math.round(Math.max(0, v) * 10) / 10;
    style.inset = {
      top: pct((box.y / slideH) * 100),
      left: pct((box.x / slideW) * 100),
      bottom: pct(100 - ((box.y + box.h) / slideH) * 100),
      right: pct(100 - ((box.x + box.w) / slideW) * 100),
    };
  }
  return Object.keys(style).length ? style : undefined;
}

/** A run of a box, as the slide model draws it. */
function deckRun(run: RtfParagraph['runs'][number], box: ProBox): DeckRun {
  const postscript = run.font ?? box.postscript;
  const family = run.font ? familyOf(run.font) : box.family || (postscript ? familyOf(postscript) : '');
  const weight = postscript ? styleFromName(postscript).weight : (box.base?.fontWeight ?? 400);
  return {
    text: run.text,
    font: family ? cssFamilyFor(family) : '"Helvetica Neue", Helvetica, Arial, sans-serif',
    size: run.size ?? box.base?.fontSize ?? 72,
    bold: run.bold || weight >= 600,
    italic: run.italic || (postscript ? styleFromName(postscript).italic : !!box.base?.italic),
    underline: false,
    strike: false,
    color: run.color ?? box.base?.color ?? '#ffffff',
    caps: false,
    baseline: 0,
  };
}

/** A slide's boxes as Lumen's slide model, with no background: it shows over whatever is behind it. */
function deckSlide(boxes: ProBox[], width: number, height: number, text: string, notes?: string): EditableSlide {
  const elements: DeckElement[] = boxes.map((box) => {
    let size = box.base?.fontSize ?? 72;
    const paragraphs: DeckParagraph[] = box.paragraphs.map((p) => {
      const runs = p.runs.map((r) => deckRun(r, box));
      if (runs.length) size = runs.at(-1)!.size;
      return { align: p.align, marginLeft: 0, indent: 0, lineSpacing: { factor: 1 }, spaceBefore: 0, spaceAfter: 0, runs, emptySize: size };
    });
    return {
      kind: 'shape',
      x: box.x,
      y: box.y,
      w: box.w || width,
      h: box.h || height,
      rotation: box.rotation,
      flipH: false,
      flipV: false,
      geometry: { preset: 'rect', adjust: {} },
      fill: null,
      stroke: null,
      text: {
        paragraphs,
        insets: { l: 0, t: 0, r: 0, b: 0 },
        anchor: box.valign ?? 'middle',
        wrap: true,
        fontScale: 1,
        lineReduction: 0,
      },
    };
  });
  return { width, height, transparent: true, slide: { background: null, elements, text, notes: notes ?? '', hidden: false } };
}

function readSlide(cue: PbMessage): ImportedSlide {
  for (const action of cue.messages(CUE.actions)) {
    // Action → slide (23) → presentation slide (2).
    const presentationSlide = action.path(23, 2);
    if (!presentationSlide) continue;
    // Presentation slide → base slide (1) → elements (1) → graphics element (1).
    const base = presentationSlide.message(1);
    const notes = richText(presentationSlide.message(2)?.bytes(1)) || undefined;
    const tag = action.message(ACTION.label);
    const tagName = tag?.string(LABEL.text)?.trim();
    const tagColor = tag?.message(LABEL.color);
    const label = tagName ? { name: tagName, color: tagColor ? toHex(tagColor) : LABEL_GREY } : undefined;
    const boxes = (base?.messages(SLIDE.elements) ?? [])
      .map((el) => el.message(1))
      .filter((el): el is PbMessage => !!el)
      .map(readBox)
      .filter((b): b is ProBox => !!b);
    if (!boxes.length) {
      const texts = findRtf(base ?? presentationSlide).filter(Boolean);
      return { text: texts.join('\n'), notes, label };
    }
    const text = boxes
      .map((b) => b.rtf)
      .filter(Boolean)
      .join('\n');
    const size = base?.message(SLIDE.size);
    const width = size?.number(1) || 1920;
    const height = size?.number(2) || 1080;
    if (boxes.length === 1 && isPlain(boxes[0])) return { text, notes, label, style: boxStyle(boxes[0], width, height) };
    return { text, notes, label, deck: deckSlide(boxes, width, height, text, notes) };
  }
  return { text: '' };
}

/** The style used by the most slides, so one odd slide doesn't set the look. */
function commonStyle(styles: (TextStyle | undefined)[]): TextStyle | undefined {
  const counts = new Map<string, { style: TextStyle; n: number }>();
  for (const style of styles) {
    if (!style) continue;
    const key = JSON.stringify(style);
    const entry = counts.get(key) ?? { style, n: 0 };
    entry.n++;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.style;
}

/**
 * Reads a ProPresenter 7 `.pro` presentation: text, structure, and each slide's text boxes. A
 * slide with one box in one format becomes a Lumen text slide in that box's place and format
 * (the format most slides use is the presentation's); a slide with several boxes, or mixed
 * fonts, sizes or colors, is kept laid out as it was (`deck`). Backgrounds are left to the
 * Lumen theme. `arrangementId` picks an arrangement other than the
 * one saved as selected, as playlist items can.
 */
export function parseProPresenter7(bytes: Uint8Array, fallbackTitle = 'Imported', arrangementId?: string): ImportedPresentation {
  const head = utf8.decode(bytes.subarray(0, 64)).trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<RVPresentationDocument')) {
    throw new Error('This is a ProPresenter 6 file. Only ProPresenter 7 .pro files can be imported.');
  }
  let root: PbMessage;
  try {
    root = PbMessage.parse(bytes);
  } catch {
    throw new Error('Not a ProPresenter 7 presentation.');
  }
  const cueGroups = root.messages(PRESENTATION.cueGroups);
  const cues = root.messages(PRESENTATION.cues);
  if (!cueGroups.length && !cues.length) throw new Error('Not a ProPresenter 7 presentation.');

  const slidesById = new Map(cues.map((cue) => [uuidOf(cue.message(CUE.uuid)), cue]));
  const usedNames = new Set<string>();
  const groups: ImportedGroup[] = [];
  const styles: (TextStyle | undefined)[] = [];
  const indexByGroupId = new Map<string, number>();

  for (const cg of cueGroups) {
    const group = cg.message(CUE_GROUP.group);
    const slides = cg
      .messages(CUE_GROUP.cueIds)
      .map((id) => slidesById.get(uuidOf(id)))
      .filter((cue): cue is PbMessage => !!cue)
      .map(readSlide);
    styles.push(...slides.map((sl) => sl.style));
    if (!slides.length) continue;
    // Group names must be unique so Reflow can tell groups apart.
    const base = group?.string(GROUP.name)?.trim() || 'Group';
    let name = base;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = /\d$/.test(base) ? `${base} (${n})` : `${base} ${n}`;
    usedNames.add(name.toLowerCase());
    const color = group?.message(GROUP.color);
    indexByGroupId.set(uuidOf(group?.message(GROUP.uuid)), groups.length);
    groups.push({ name, color: color ? toHex(color) : undefined, slides });
  }

  // Text slides share the style most of them use; a slide keeps its own only where it differs.
  const style = commonStyle(styles);
  const shared = JSON.stringify(style);
  for (const g of groups)
    for (const sl of g.slides) {
      if (!sl.style || JSON.stringify(sl.style) === shared) delete sl.style;
      if (!sl.notes) delete sl.notes;
      if (!sl.deck) delete sl.deck;
      if (!sl.label) delete sl.label;
    }

  const arrangements = root.messages(PRESENTATION.arrangements);
  const selected = arrangementId || uuidOf(root.message(PRESENTATION.selectedArrangement));
  // With no arrangement selected, ProPresenter plays every group in order.
  const chosen = selected ? arrangements.find((a) => uuidOf(a.message(ARRANGEMENT.uuid)) === selected) : undefined;
  let arrangement = chosen
    ? chosen
        .messages(ARRANGEMENT.groupIds)
        .map((id) => indexByGroupId.get(uuidOf(id)))
        .filter((i): i is number => i !== undefined)
    : [];
  if (!arrangement.length) arrangement = groups.map((_, i) => i);

  const ccli = root.message(PRESENTATION.ccli);
  const str = (field: number) => ccli?.string(field)?.trim() || undefined;
  const year = ccli?.number(CCLI.year);
  const songNumber = ccli?.number(CCLI.songNumber);
  const transition = root.message(PRESENTATION.transition);
  const seconds = transition?.number(TRANSITION.duration);
  const effect = transition?.message(TRANSITION.effect);
  const direction = effect
    ?.messages(EFFECT.variables)
    .map((v) => v.message(EFFECT_VARIABLE.direction)?.number(1))
    .find((d) => d !== undefined);

  return {
    title: root.string(PRESENTATION.name)?.trim() || str(CCLI.title) || fallbackTitle,
    groups,
    arrangement,
    author: str(CCLI.author),
    artist: str(CCLI.artist),
    album: str(CCLI.album),
    publisher: str(CCLI.publisher),
    year: year ? String(year) : undefined,
    ccli: songNumber ? String(songNumber) : undefined,
    showCopyright: ccli?.number(CCLI.display) === 1 || undefined,
    transition: seconds != null && seconds >= 0 ? transitionFromPro(effect?.string(EFFECT.name), seconds, direction) : undefined,
    style,
  };
}
