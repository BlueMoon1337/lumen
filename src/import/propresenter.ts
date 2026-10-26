import { cssFamilyFor, styleFromName } from '../fonts';
import { transitionFromPro } from '../transitions';
import type { SlideTransition, TextStyle } from '../types';
import { PbMessage } from './protobuf';
import { rtfToText } from './rtf';

export interface ImportedSlide {
  text: string;
  notes?: string;
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

/** Formatting of a text box, as Lumen text style. */
function readStyle(text: PbMessage | undefined): TextStyle | undefined {
  const attrs = text?.message(3);
  if (!attrs) return undefined;
  const style: TextStyle = {};
  const font = attrs.message(TEXT_ATTRIBUTES.font);
  const postscript = font?.string(FONT.name)?.trim();
  const family = font?.string(FONT.family)?.trim() || postscript?.replace(/-.*$/, '');
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

function readSlide(cue: PbMessage): ImportedSlide & { style?: TextStyle } {
  for (const action of cue.messages(CUE.actions)) {
    // Action → slide (23) → presentation slide (2).
    const presentationSlide = action.path(23, 2);
    if (!presentationSlide) continue;
    // Presentation slide → base slide (1) → elements (1) → graphics element (1) → text (13) → RTF (5).
    const elements = (presentationSlide.message(1)?.messages(1) ?? []).map((el) => el.path(1, 13));
    const withText = elements.filter((t) => richText(t?.bytes(5)));
    let texts = withText.map((t) => richText(t?.bytes(5)));
    if (!texts.length) texts = findRtf(presentationSlide.message(1) ?? presentationSlide).filter(Boolean);
    const notes = richText(presentationSlide.message(2)?.bytes(1)) || undefined;
    return { text: texts.join('\n'), notes, style: readStyle(withText[0]) };
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
 * Reads a ProPresenter 7 `.pro` presentation: text, structure, and the font,
 * size, color and alignment most slides use. Box positions and backgrounds
 * are left to the Lumen theme. `arrangementId` picks an arrangement other than the
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
    groups.push({ name, color: color ? toHex(color) : undefined, slides: slides.map(({ text, notes }) => ({ text, notes })) });
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
    style: commonStyle(styles),
  };
}
