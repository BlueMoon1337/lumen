/**
 * Slides from PowerPoint (and, where it can be read, Keynote) as Lumen keeps them: each slide's
 * shapes, pictures and text with their positions, fills and formatting, resolved from the file's
 * masters, layouts and theme. Lumen draws them into pictures to show (src/deckRender.ts), and
 * keeps the model with the presentation, so they can be redrawn, searched and one day edited.
 *
 * Positions and sizes are pixels of a slide 1920 wide (its height follows the file's shape);
 * font sizes are pixels at that size too.
 */

export const DECK_WIDTH = 1920;

/** A CSS color, e.g. "rgba(38, 50, 72, 1)". */
export type DeckColor = string;

export type DeckFill =
  | { kind: 'solid'; color: DeckColor }
  | { kind: 'gradient'; angle: number; radial: boolean; stops: { pos: number; color: DeckColor }[] }
  | { kind: 'image'; image: string; crop?: DeckCrop; alpha?: number; tile?: boolean };

/** How much of a picture is cut off each side, as fractions of it. */
export interface DeckCrop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface DeckStroke {
  color: DeckColor;
  width: number;
  dash?: number[];
}

export interface DeckRun {
  text: string;
  /** A CSS font family list. */
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: DeckColor;
  caps: boolean;
  /** Raised or lowered, as a fraction of the size (superscript 0.3, subscript -0.25). */
  baseline: number;
  /** A line break (<a:br/>), rather than text. */
  br?: boolean;
}

export interface DeckBullet {
  /** The bullet's text: a character, or the number ("3."). */
  text: string;
  font?: string;
  color?: DeckColor;
  /** Size as a fraction of the text's. */
  scale: number;
}

export interface DeckParagraph {
  align: 'left' | 'center' | 'right' | 'justify';
  /** Where the text starts, and where its first line starts (relative to that), in px. */
  marginLeft: number;
  indent: number;
  /** Line spacing: a multiple of the font's line (1 = single), or an exact height in px. */
  lineSpacing: { factor: number } | { px: number };
  spaceBefore: number;
  spaceAfter: number;
  bullet?: DeckBullet;
  runs: DeckRun[];
  /** The size of an empty paragraph's line. */
  emptySize: number;
}

export interface DeckText {
  paragraphs: DeckParagraph[];
  insets: { l: number; t: number; r: number; b: number };
  anchor: 'top' | 'middle' | 'bottom';
  wrap: boolean;
  /** PowerPoint's "shrink text on overflow", as it saved it. */
  fontScale: number;
  lineReduction: number;
  /** Text rotated with the shape or not; vertical text isn't drawn vertically yet. */
  vertical?: boolean;
}

/** A path in its own w × h box, scaled to the shape's. */
export interface DeckPath {
  w: number;
  h: number;
  fill: boolean;
  stroke: boolean;
  commands: (
    | { op: 'M' | 'L'; x: number; y: number }
    | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { op: 'Q'; x1: number; y1: number; x: number; y: number }
    | { op: 'A'; wR: number; hR: number; stAng: number; swAng: number }
    | { op: 'Z' }
  )[];
}

export type DeckGeometry = { preset: string; adjust: Record<string, number> } | { paths: DeckPath[] };

interface DeckBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** From the slide master or layout (the slide's design), rather than the slide itself. */
  template?: boolean;
  /** The placeholder it fills: title, body, sldNum (slide number)… */
  placeholder?: string;
}

export interface DeckShape extends DeckBox {
  kind: 'shape';
  geometry: DeckGeometry;
  fill: DeckFill | null;
  stroke: DeckStroke | null;
  text?: DeckText;
}

export interface DeckPicture extends DeckBox {
  kind: 'picture';
  /** The picture's path in the file (ppt/media/image3.png), or "media:<id>" for one stored in Lumen. */
  image: string;
  crop?: DeckCrop;
  alpha?: number;
  geometry: DeckGeometry;
  stroke: DeckStroke | null;
}

export interface DeckGroup extends DeckBox {
  kind: 'group';
  children: DeckElement[];
}

export type DeckElement = DeckShape | DeckPicture | DeckGroup;

export interface DeckSlide {
  background: DeckFill | null;
  /** The master's and layout's own shapes first, then the slide's. */
  elements: DeckElement[];
  /** The slide's words, top to bottom, for search and the stage display. */
  text: string;
  /** The speaker notes. */
  notes: string;
  hidden: boolean;
}

/** One slide of a deck as Lumen keeps it for editing: the slide, and the deck's size. */
export interface EditableSlide {
  width: number;
  height: number;
  /** Drawn with nothing behind it, so it shows over what's behind (a ProPresenter slide's text boxes). */
  transparent?: boolean;
  slide: DeckSlide;
}

export interface Deck {
  width: number;
  height: number;
  slides: DeckSlide[];
  /** Fonts the file names, for knowing what to have installed. */
  fonts: string[];
  /** PowerPoint's sections: named runs of slides, by number (from 1). */
  sections?: { name: string; slides: number[] }[];
}
