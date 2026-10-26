/** Text formatting that overrides the theme, for one slide or a whole presentation. */
export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  uppercase?: boolean;
  color?: string;
  textAlign?: Theme['textAlign'];
  verticalAlign?: Theme['verticalAlign'];
  inset?: Theme['inset'];
}

export interface Slide {
  id: string;
  text: string;
  /** Small line under the main text, e.g. a scripture reference. */
  caption?: string;
  /** Shown on the stage display only. */
  notes?: string;
  style?: TextStyle;
  /** Replaces the theme background for this slide. */
  background?: ThemeBackground;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  slides: Slide[];
}

export type Category = 'song' | 'scripture' | 'announcement' | 'other';

export interface Presentation {
  id: string;
  title: string;
  category: Category;
  author?: string;
  copyright?: string;
  ccli?: string;
  artist?: string;
  album?: string;
  publisher?: string;
  year?: string;
  /** Show the copyright line on the first and last slides. */
  showCopyright?: boolean;
  themeId?: string;
  /** Formatting applied to every slide, under any per-slide formatting. */
  style?: TextStyle;
  /** Overrides the global transition length; 0 is a cut. */
  transitionMs?: number;
  groups: Group[];
  /** Group ids in the order they are performed. Groups may repeat. */
  arrangement: string[];
  updatedAt: number;
  /** Bible mode's working passage: kept out of the library. */
  hidden?: boolean;
}

export type BackgroundType = 'none' | 'color' | 'gradient' | 'media';

export interface ThemeBackground {
  type: BackgroundType;
  color: string;
  color2: string;
  mediaId?: string;
}

export interface Theme {
  id: string;
  name: string;
  fontFamily: string;
  /** Maximum font size in px on a 1920x1080 canvas; long text shrinks to fit. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  uppercase: boolean;
  lineHeight: number;
  shadow: boolean;
  /** Text outline width in px, 0 for none. */
  outline: number;
  outlineColor: string;
  /** Text box insets as a percentage of the canvas. */
  inset: { top: number; right: number; bottom: number; left: number };
  /** Fill behind the text box (useful for lower thirds). Empty for none. */
  boxColor: string;
  captionScale: number;
  background: ThemeBackground;
  /** What the main text box is called in menus, e.g. "Verse" in a Bible template. "Text" when unset. */
  textName?: string;
  /** A second text box for the slide's caption (a scripture reference, say). Unset: the caption sits under the text. */
  captionBox?: ThemeTextBox;
}

/** A theme's extra text box, positioned on its own, like the Reference box of a Bible template. */
export interface ThemeTextBox {
  name: string;
  /** Box insets as a percentage of the canvas. */
  inset: { top: number; right: number; bottom: number; left: number };
  textAlign: Theme['textAlign'];
  verticalAlign: Theme['verticalAlign'];
  /** Maximum font size in px; long text shrinks to fit. */
  fontSize: number;
  /** Unset values follow the theme's main text. */
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
  uppercase?: boolean;
  italic?: boolean;
}

/** A font file the user added; the file itself is stored in IndexedDB under `id`. */
export interface FontMeta {
  id: string;
  family: string;
  weight: number;
  italic: boolean;
  fileName: string;
}

export interface MediaItem {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mime: string;
}

export type PlaylistItem = { id: string; type: 'presentation'; presentationId: string } | { id: string; type: 'header'; label: string };

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
}

export interface Message {
  id: string;
  text: string;
}

/** Lumen's app icon. */
export type AppIconId = 'star' | 'camera' | 'film' | 'projector';

export interface Settings {
  /** Chosen on first launch; unset until then. */
  appIcon?: AppIconId;
  transitionMs: number;
  /** Advancing past the last slide moves on to the next playlist item. */
  advanceAcrossItems: boolean;
  logoMediaId?: string;
  defaultThemeId: string;
  gridSize: number;
  slideView: 'grid' | 'list';
  ccliLicense?: string;
  /** Translation last used in the Bible dialog: an imported Bible's id or an online one. */
  lastBible?: string;
  /** Bible mode's choices (see bibleSettings in src/bibleSlides.ts for the defaults). */
  bible?: Partial<BibleSettings>;
  /** Sizes the operator dragged the panes to; unset ones use the defaults (DEFAULT_PANES in Splitter.tsx). */
  panes?: Partial<PaneSizes>;
}

/** Pane sizes in px. */
export interface PaneSizes {
  /** Library and playlist sidebar (and the media sidebar under it), Show and Bible modes. */
  side: number;
  /** Live panel on the right. */
  live: number;
  /** Media bin along the bottom. */
  media: number;
  /** Live panel: preview and transport, above the tabs. Unset: as tall as the preview needs. */
  liveTop: number;
  /** Edit and Reflow modes: the slide outline on the left. */
  outline: number;
  /** Edit and Reflow modes: the inspector on the right. */
  inspector: number;
}

/** Where Bible mode puts a translation's verse text or reference: the template's main box, its caption box, or nowhere. */
export type BibleSlot = 'none' | 'text' | 'caption';

/** Which slides show a reference: each slide its own verses, every slide the whole passage, only the last slide, or none. */
export type BibleReferences = 'verse' | 'passage-each' | 'passage-last' | 'none';

export interface BibleTranslation {
  /** An imported Bible's id, or an online one ("web", "kjv"…). */
  bibleId: string;
  verse: BibleSlot;
  reference: BibleSlot;
}

export interface BibleSettings {
  /** The passage last shown. */
  reference: string;
  /** The first is the main translation; more add parallel text. */
  translations: BibleTranslation[];
  showVerseNumbers: boolean;
  breakOnNewVerse: boolean;
  displayTranslation: boolean;
  references: BibleReferences;
  /** The template (theme) the verse slides use. */
  themeId: string;
  /** The library Save As puts presentations in. */
  library: Category;
}

// ---- Screens ------------------------------------------------------------------

export type ScreenKind = 'audience' | 'stage';

export interface Point {
  x: number;
  y: number;
}

/** Where each corner of the picture lands, as fractions of the output (0,0 top-left; 1,1 bottom-right). */
export interface CornerPin {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

/** Picture adjustments for one output; 1 (or 0 for hue) leaves the picture unchanged. */
export interface OutputColor {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
}

/** A physical display as remembered in the setup, so it can be found again when reconnected. */
export interface DisplayRef {
  id?: number;
  label: string;
  width: number;
  height: number;
}

/**
 * The part of the display's signal an output fills. A grid or custom region
 * splits one signal across several projectors through a multi-display adapter
 * (TripleHead2Go, Datapath), so several outputs can share one display.
 */
export type OutputTarget =
  | { type: 'full' }
  | { type: 'grid'; cols: number; rows: number; cell: number }
  /** In pixels of the display's signal. */
  | { type: 'custom'; x: number; y: number; width: number; height: number };

/** One output of a screen: a display (or placeholder) and its picture adjustments. */
export interface ScreenOutput {
  id: string;
  /** The display this output goes to; unset means Automatic. */
  display?: DisplayRef;
  /** Holds a place for a display that isn't here yet; the output shows nowhere. */
  placeholder?: { width: number; height: number };
  target: OutputTarget;
  delayFrames: number;
  color: OutputColor;
  cornerPin: CornerPin;
  /** "fill" drops backgrounds; "key" draws the foreground as a white matte for a video switcher. */
  alphaKey: 'off' | 'fill' | 'key';
}

/**
 * single: one output. mirror: every output shows the whole picture.
 * grouped: the outputs sit side by side and together make one large screen.
 * blend: grouped, with neighbouring projectors overlapping and fading into each other.
 */
export type ScreenMode = 'single' | 'mirror' | 'grouped' | 'blend';

export interface EdgeBlend {
  /** Overlap between neighbouring outputs, in output pixels. */
  overlap: number;
  /** Projector gamma the fade is corrected for. */
  gamma: number;
}

export interface ScreenConfig {
  id: string;
  kind: ScreenKind;
  name: string;
  /** Size of one output's picture; a grouped screen is several of these. */
  width: number;
  height: number;
  /** Fills the screen behind everything else; black when unset. */
  screenColor?: string;
  mode: ScreenMode;
  /** Outputs per row when grouped or blended. */
  columns: number;
  blend: EdgeBlend;
  outputs: ScreenOutput[];
}

export interface ScreenSetup {
  audienceEnabled: boolean;
  stageEnabled: boolean;
  screens: ScreenConfig[];
}

export type TestPattern = 'bars' | 'grid' | 'checker' | 'gradient' | 'white' | 'black';

export interface ScreenTools {
  identify: boolean;
  testPattern: { pattern: TestPattern; screenId: string | null } | null;
}

export interface TimerState {
  mode: 'duration' | 'toTime';
  durationMs: number;
  /** "HH:MM" for toTime mode. */
  targetTime: string;
  running: boolean;
  /** Epoch ms when the countdown reaches zero, while running. */
  endsAt: number | null;
  /** Remaining time while paused. */
  remainingMs: number;
}

export interface LiveSlideRef {
  presentationId: string;
  index: number;
  playlistItemId?: string;
}

export interface LiveState {
  slide: LiveSlideRef | null;
  /** Media playing on the background layer, overriding theme backgrounds. */
  mediaId: string | null;
  logo: boolean;
  messageId: string | null;
  stageMessage: string | null;
  mediaPaused: boolean;
  /** Bumped to restart the live video from the beginning. */
  mediaRestart: number;
}

/** One slide of a presentation in performance order. */
export interface SequenceEntry {
  group: Group;
  slide: Slide;
  indexInGroup: number;
}

/** Everything an output window needs to draw itself, sent over BroadcastChannel. */
export interface OutputFrame {
  slide: { key: string; text: string; caption?: string; footer?: string; theme: Theme } | null;
  background: FrameBackground | null;
  message: { key: string; text: string } | null;
  logoMediaId: string | null;
  transitionMs: number;
  /** Added fonts, so output windows can load the ones slides use. */
  fonts: FontMeta[];
  /** For the output windows' own icon. */
  appIcon: AppIconId;
  /** Screen setup and tools, so each output window can apply its own settings. */
  screens: ScreenSetup;
  screenTools: ScreenTools;
  timer: TimerState;
  stage: {
    title: string | null;
    current: string | null;
    currentLabel: string | null;
    next: string | null;
    nextLabel: string | null;
    notes: string | null;
    message: string | null;
  };
}

export type FrameBackground =
  | { key: string; kind: 'color'; color: string }
  | { key: string; kind: 'gradient'; color: string; color2: string }
  | { key: string; kind: 'media'; mediaId: string; paused?: boolean };
