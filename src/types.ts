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
  /** A colored tag on the slide's thumbnail ("Prayer", "Key Change"), as in ProPresenter. */
  label?: ColorLabel;
  /** How this slide comes on screen; unset uses the presentation's, then the global one. */
  transition?: SlideTransition;
  /** A media cue: showing the slide starts this image or video on the Media layer, as in ProPresenter. */
  media?: string;
  /** A slide from a PowerPoint or Keynote file: shown as a picture of itself, in place of text. */
  source?: SlideSource;
}

/** An imported slide (see src/slideshows.ts). */
export interface SlideSource {
  /** The slide's picture, a stored file (like media). */
  picture: string;
  /** Its words, for search and the stage display. */
  text: string;
  /** Its number in the file, from 1. */
  number: number;
  /**
   * The PowerPoint file it was made from (stored like media; for Keynote, Keynote's PowerPoint
   * export), whose pictures it uses. Unset on slides imported before editing: the presentation's.
   */
  file?: string;
  /** Once edited: the slide as Lumen's model (an EditableSlide, as JSON), stored like media. */
  model?: string;
  /** Pictures added in Lumen that the model uses ("media:<id>"), stored like media. */
  images?: string[];
}

/**
 * The file a presentation was made from (a PowerPoint or Keynote file). Its slides are pictures,
 * edited as Lumen's model of the file (src/deck.ts, src/deckEdit.ts).
 */
export interface PresentationSource {
  kind: 'powerpoint' | 'keynote';
  fileName: string;
  /** The original file, stored like media. */
  fileId?: string;
  /** Lumen's model of the slides (a Deck, as JSON), stored like media, as imported. */
  modelId?: string;
  /** Keynote: Keynote's PowerPoint export of it, which its slides are edited from. */
  pptxId?: string;
  /** The slides' size, in px. */
  width: number;
  height: number;
  importedAt: number;
}

/** A name with a color: a group preset or a slide label. */
export interface ColorLabel {
  name: string;
  color: string;
}

/** How one slide replaces the one before it. */
export type TransitionKind =
  'cut' | 'dissolve' | 'fade' | 'push' | 'slide' | 'reveal' | 'wipe' | 'split' | 'iris' | 'zoom' | 'blur' | 'flip' | 'cube';

/** Which way a transition moves. A split opens sideways (left, right) or up and down (up, down). */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down';

/** How a transition speeds up and slows down. */
export type TransitionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface SlideTransition {
  kind: TransitionKind;
  /** Length in ms; a cut ignores it. */
  ms: number;
  /** For the kinds that move (see TRANSITION_KINDS in src/transitions.ts); left when unset. */
  direction?: TransitionDirection;
  /** Unset: what suits the kind (a wipe is even, a push eases in and out). */
  easing?: TransitionEasing;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  slides: Slide[];
}

/**
 * The library a presentation is in: the id of one of `LibraryData.libraries`. Lumen's own
 * four are "song", "scripture", "announcement" and "other"; New Library adds more.
 */
export type Category = string;

/** A library in the sidebar (Songs, Scripture…, or one made with File ▸ New Library). */
export interface Library {
  id: Category;
  name: string;
}

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
  /**
   * The presentation's own background, in place of the theme's (a slide's own still wins). New
   * presentations start with none: transparent, so they go over whatever media is playing.
   */
  background?: ThemeBackground;
  /** Formatting applied to every slide, under any per-slide formatting. */
  style?: TextStyle;
  /** Overrides the global transition; a slide's own transition overrides this. */
  transition?: SlideTransition;
  groups: Group[];
  /** Group ids in the order they are performed. Groups may repeat. */
  arrangement: string[];
  updatedAt: number;
  /** Bible mode's working passage: kept out of the library. */
  hidden?: boolean;
  /** "announcements" shows its slides on the Announcements layer, over the slides, instead of the slide layer. */
  destination?: 'announcements';
  /** Moves on to the next slide by itself, e.g. an announcement loop. */
  autoAdvance?: AutoAdvance;
  /** Made from a PowerPoint or Keynote file: read-only. */
  source?: PresentationSource;
}

export interface AutoAdvance {
  /** Seconds each slide stays up. */
  seconds: number;
  /** After the last slide, start again from the first. */
  loop: boolean;
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
  /**
   * The background stays up when media from the Media bin is live (the media keeps playing under
   * it). Unset: the media replaces it, as before.
   */
  keepBackground?: boolean;
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
  /** Images and videos go in the media bin; audio in the Audio tab. */
  kind: 'image' | 'video' | 'audio';
  mime: string;
  /** Audio: start again when it ends. */
  loop?: boolean;
  /** Video: what happens when it ends. Loop when unset. */
  playback?: VideoPlayback;
  /** Video: a countdown, in the media bin's Countdowns tab; music fades out as it ends (src/countdowns.ts). */
  countdown?: boolean;
  /** Video: an outro (for the end of the service), in the media bin's Outro tab. */
  outro?: boolean;
  /** Image or video: a logo, in the media bin's Logo tab. */
  logo?: boolean;
  /** Image or video: a background, in the media bin's Backgrounds tab. */
  background?: boolean;
}

/**
 * Media bin tabs whose items have one active item: the outro Play Outro plays, and the logo the
 * Logo button (the Logo layer) shows.
 */
export type MarkedTab = 'outro' | 'logo';

/** The media bin's own tabs, which items are added to and taken out of. */
export type SpecialTab = 'background' | 'countdown' | 'outro' | 'logo';
export const TAB_NAMES: Record<SpecialTab, string> = { background: 'Backgrounds', countdown: 'Countdowns', outro: 'Outro', logo: 'Logo' };

/** Whether an item can go in a tab: countdowns and outros are videos; backgrounds and logos, images or videos. */
export const fitsTab = (m: Pick<MediaItem, 'kind'>, tab: SpecialTab) =>
  tab === 'countdown' || tab === 'outro' ? m.kind === 'video' : m.kind !== 'audio';

/** When a video ends: start again, hold the last frame, clear the Media layer, or play the next one. */
export type VideoPlayback = 'loop' | 'stop' | 'clear' | 'next';

/** A media bin (or Audio tab) playlist, like ProPresenter's: media items in an order. Each item is in the library once. */
export interface MediaPlaylist {
  id: string;
  name: string;
  items: string[];
  /** An audio playlist that starts over after its last track. */
  loop?: boolean;
  /** An audio playlist that plays its tracks in a random order (each once a round). */
  shuffle?: boolean;
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
  /** How long a look takes to change on the screens, in ms (Edit Looks…); 1000 when unset. */
  lookFadeMs?: number;
  capture?: CaptureSettings;
  /** The capture preset in use; "No Preset" when unset. */
  capturePresetId?: string;
  capturePresets?: CapturePreset[];
  /** Check Spelling While Typing (Edit ▸ Spelling and Grammar); on when unset. */
  spellcheck?: boolean;
  appIcon?: AppIconId;
  /** The color of selections and active buttons: ProPresenter's pink (unset) or macOS's blue. */
  highlight?: 'pink' | 'blue';
  /** The slide transition used unless a presentation or slide sets its own. */
  transition: SlideTransition;
  /** How backgrounds from the media bin come and go; a dissolve when unset. */
  mediaTransition?: SlideTransition;
  /** The groups offered when assigning slides; unset uses DEFAULT_GROUPS (src/labels.ts). */
  groupPresets?: ColorLabel[];
  /** The slide labels offered; unset uses DEFAULT_LABELS (src/labels.ts). */
  labelPresets?: ColorLabel[];
  /** Advancing past the last slide moves on to the next playlist item. */
  advanceAcrossItems: boolean;
  logoMediaId?: string;
  /** The active outro: the video Play Outro (beside the clear buttons) puts on the Media layer. */
  outroMediaId?: string;
  /** When an outro ends, the logo comes up (clearing the words and the background). */
  logoAfterOutro?: boolean;
  /** An audio playlist that starts with the logo when an outro ends. */
  outroPlaylistId?: string;
  /** Countdown Videos: the audio playlist that starts with Play a Random Countdown (unset: none). */
  countdownPlaylistId?: string;
  /** Countdown Fade (Audio tab): seconds before the end that music starts to fade; 10 when unset. */
  countdownFadeSeconds?: number;
  /** Countdown Fade follows countdown videos (on when unset) and the Timers tab's countdown (on when unset). */
  countdownFadeVideos?: boolean;
  countdownFadeTimer?: boolean;
  /** Crossfade Songs (Settings ▸ Audio, or the Audio tab's crossfade button): a track fades into the next. */
  crossfadeSongs?: boolean;
  /** How long a crossfade lasts, 1 to CROSSFADE_MAX seconds; CROSSFADE_SECONDS when unset. */
  crossfadeSeconds?: number;
  defaultThemeId: string;
  gridSize: number;
  /** View ▸ Slide View: Grid, Easy (just the words, large) or Table ('list'). */
  slideView: 'grid' | 'easy' | 'list';
  /** View ▸ Continuous Playlist: the playlist's presentations one after another in Show mode. */
  continuousPlaylist?: boolean;
  ccliLicense?: string;
  /** Translation last used in the Bible dialog: an imported Bible's id or an online one. */
  lastBible?: string;
  /** Bible mode's choices (see bibleSettings in src/bibleSlides.ts for the defaults). */
  bible?: Partial<BibleSettings>;
  /** Buttons under the preview that clear several layers at once; unset uses DEFAULT_CLEAR_GROUPS (src/layers.ts). */
  clearGroups?: ClearGroup[];
  /** Sizes the operator dragged the panes to; unset ones use the defaults (DEFAULT_PANES in Splitter.tsx). */
  panes?: Partial<PaneSizes>;
}

/** A layer of what's on screen (or, for audio, playing), each cleared on its own. */
export type ClearLayer = 'audio' | 'messages' | 'logo' | 'announcements' | 'slide' | 'media' | 'videoInput';

/** ProPresenter's Clear Groups: one button that clears several layers. */
export interface ClearGroup {
  id: string;
  name: string;
  /** An icon name from src/components/ui.tsx. */
  icon: string;
  color: string;
  layers: ClearLayer[];
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
  /** A stage screen's layout (Screens ▸ Edit Layouts…); the first layout when unset. */
  stageLayoutId?: string;
}

// ---- Looks (Screens ▸ Live, Edit Looks…) -------------------------------------------------------

/** A shape that leaves only part of an audience screen showing. */
export type LookMask = 'none' | 'fourThree' | 'letterbox' | 'lowerThird' | 'upperThird' | 'leftHalf' | 'rightHalf';

/** What one audience screen shows in a look. */
export interface LookScreen {
  messages: boolean;
  /** The logo layer (where ProPresenter has Props). */
  logo: boolean;
  announcements: boolean;
  slide: boolean;
  media: boolean;
  videoInput: boolean;
  /** Slides on this screen use this theme instead of their own: a lower third for a livestream, say. */
  themeId?: string;
  mask?: LookMask;
}

/** A Look: what each audience screen shows. The live look drives the screens; presets are saved looks. */
export interface Look {
  id: string;
  name: string;
  /** By screen id; a screen not listed shows everything. */
  screens: Record<string, LookScreen>;
}

// ---- Stage layouts (Screens ▸ Edit Layouts…) ---------------------------------------------------

export type StageObjectKind =
  | 'currentText'
  | 'nextText'
  | 'currentNotes'
  | 'nextNotes'
  | 'currentSlide'
  | 'nextSlide'
  | 'groupName'
  | 'title'
  | 'clock'
  | 'timer'
  | 'videoCountdown'
  | 'message'
  | 'text'
  | 'shape';

/** One thing on a stage layout, in the layout's pixels. */
export interface StageObject {
  id: string;
  kind: StageObjectKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Largest text size; long text shrinks to fit. */
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number;
  color: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  uppercase?: boolean;
  /** A small caption along the bottom ("Timer"). */
  showLabel?: boolean;
  /** Box fill, empty for none. */
  fill?: string;
  /** What a Text object says. */
  text?: string;
}

/** A stage screen's layout: what the confidence monitor shows, and where. */
export interface StageLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Behind the objects; null leaves the screen black. */
  background: string | null;
  objects: StageObject[];
}

// ---- Capture (Screens ▸ Start Capture, Capture Settings…) ----------------------------------------

export type CaptureCodec =
  | 'h264'
  | 'h265'
  | 'hap'
  | 'hapAlpha'
  | 'hapQ'
  | 'prores422'
  | 'prores422hq'
  | 'prores422lt'
  | 'prores422proxy'
  | 'prores4444'
  | 'prores4444xq'
  | 'vp9';

export interface CaptureEncoding {
  width: number;
  height: number;
  fps: number;
  /** Megabits a second. */
  mbps: number;
}

export interface CaptureSettings {
  /** The audience screen to record; the first one when unset. */
  sourceScreenId?: string;
  destination: 'disk';
  /** "downloads", "documents", "desktop", "movies", or a folder's path. */
  saveTo: string;
  codec: CaptureCodec;
  encoding: CaptureEncoding;
  /** Which of Lumen's two sound channels goes to the recording's left and right: matrix[input][output]. */
  audio: { auto: boolean; matrix: [[boolean, boolean], [boolean, boolean]] };
}

export interface CapturePreset {
  id: string;
  name: string;
  settings: CaptureSettings;
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
  /** When it last ran out: the stage shows 0:00 for a few seconds, then no timer until it's started or reset. */
  endedAt?: number | null;
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
  /** The live video jumps to `to` seconds whenever `n` changes. */
  mediaSeek: { to: number; n: number };
  /** The media playlist the live media was started from, for "play the next one". */
  mediaFrom: string | null;
  /** Audio playing from the Audio tab (on this computer, not the screens). */
  audioId: string | null;
  audioPaused: boolean;
  audioRestart: number;
  /** The audio playlist the playing track was started from (or AUDIO_LIBRARY, shuffling it): its next track follows when it ends. */
  audioFrom: string | null;
  /** Tracks played from there this round, so shuffling doesn't repeat one before the rest have played. */
  audioPlayed: string[];
  /** The playing track loops (its ↻ button); only a playing track can, and it stops looping when it stops. */
  audioLoop: boolean;
  /** A slide on the Announcements layer, over the slide layer. */
  announcement: LiveSlideRef | null;
  /** A camera or capture card on the Video Input layer, under everything. */
  videoInput: { deviceId: string; label: string } | null;
  /**
   * Presentation ▸ Show Slide on Stage Screens Only: a slide the stage screens show in place of
   * the live one, until the next slide goes live or the slide layer is cleared.
   */
  stageSlide?: LiveSlideRef | null;
}

/** One slide of a presentation in performance order. */
export interface SequenceEntry {
  group: Group;
  slide: Slide;
  indexInGroup: number;
}

/** Everything an output window needs to draw itself, sent over BroadcastChannel. */
export interface OutputFrame {
  /** `background` is the slide's own, if it has one (a look's theme doesn't replace it). */
  slide: {
    key: string;
    text: string;
    caption?: string;
    footer?: string;
    theme: Theme;
    background?: ThemeBackground;
    /** An imported slide's picture, shown in place of the text. */
    picture?: string;
  } | null;
  background: FrameBackground | null;
  /** The slide's own background over live media from the Media bin, when its theme keeps it. */
  cover?: FrameBackground | null;
  message: { key: string; text: string } | null;
  /** The Announcements layer: a slide over the slides, with its own background. */
  announcement: {
    key: string;
    text: string;
    caption?: string;
    theme: Theme;
    background: FrameBackground | null;
    picture?: string;
  } | null;
  /** The Video Input layer: a camera, opened by each window that shows it. */
  videoInput: { deviceId: string } | null;
  logoMediaId: string | null;
  /** How the slide layer (and its background) changes: the incoming slide's transition. */
  transition: SlideTransition;
  /** How a background from the media bin comes and goes. */
  mediaTransition: SlideTransition;
  /** How the Announcements layer changes. */
  announcementTransition: SlideTransition;
  /** Fade length for messages and the logo. */
  fadeMs: number;
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
    nextNotes: string | null;
    message: string | null;
    /** The current and next slides as pictures, for a stage layout's slide objects. */
    currentSlide: SlidePicture | null;
    nextSlide: SlidePicture | null;
  };
  /** Each audience screen's part of the live look, by screen id. */
  looks?: Record<string, ScreenLook>;
  /** Each stage screen's layout, by screen id. */
  stageLayouts?: Record<string, StageLayout>;
  /** The live video's end, for a stage layout's Video Countdown. */
  videoClock?: VideoClock;
}

/** When the live video ends if it's playing, or the time left if it's paused; and when it last ended. */
export interface VideoClock {
  endsAt: number | null;
  remainingMs: number | null;
  /** It played to its end then (the stage shows 0:00 for a few seconds, then no countdown). */
  endedAt?: number | null;
}

/** A slide as a picture: its words in its theme, over its background or media. */
export interface SlidePicture {
  text: string;
  caption?: string;
  theme: Theme;
  background?: ThemeBackground;
  media?: string;
  picture?: string;
}

/** What an audience screen shows under the live look (src/looks.ts). */
export interface ScreenLook {
  show: Omit<LookScreen, 'themeId' | 'mask'>;
  /** The look's theme for the slides on this screen. */
  theme?: Theme;
  mask: LookMask;
  fadeMs: number;
}

export type FrameBackground =
  | { key: string; kind: 'color'; color: string }
  | { key: string; kind: 'gradient'; color: string; color2: string }
  /**
   * `live`: from the media bin, rather than a theme or slide background. `loop`: a video starts
   * again at the end (the default). `seek`: jump to `to` seconds whenever `n` changes.
   */
  | {
      key: string;
      kind: 'media';
      mediaId: string;
      paused?: boolean;
      live?: boolean;
      loop?: boolean;
      seek?: { to: number; n: number };
      /** A countdown: its own sound fades out over its last this-many seconds. */
      fadeOut?: number;
    };
