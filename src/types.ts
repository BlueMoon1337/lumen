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

export interface Settings {
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

/** One output of a screen; a screen's outputs all show the same picture (mirror). */
export interface ScreenOutput {
  id: string;
  /** The display this output goes to; unset means Automatic. */
  display?: DisplayRef;
  delayFrames: number;
  color: OutputColor;
  cornerPin: CornerPin;
  /** "fill" drops backgrounds; "key" draws the foreground as a white matte for a video switcher. */
  alphaKey: 'off' | 'fill' | 'key';
}

export interface ScreenConfig {
  id: string;
  kind: ScreenKind;
  name: string;
  width: number;
  height: number;
  /** Fills the screen behind everything else; black when unset. */
  screenColor?: string;
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
