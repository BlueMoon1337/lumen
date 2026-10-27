/**
 * Stage layouts, as in ProPresenter (Screens ▸ Edit Layouts…): what a stage screen shows, as
 * objects placed on it: the current and next slide's words or pictures, their notes, the clock,
 * the countdown timer, the time left in the live video, the stage message, text and boxes.
 */
import type { ScreenConfig, StageLayout, StageObject, StageObjectKind } from './types';
import { uid } from './util';

interface Kind {
  label: string;
  /** What the editor shows in an empty object, and the caption it can show. */
  sample: string;
  caption: string;
  defaults: Omit<StageObject, 'id' | 'kind' | 'name' | 'x' | 'y'>;
}

const text = (fontSize: number, color: string, extra: Partial<StageObject> = {}): Kind['defaults'] => ({
  width: 1600,
  height: 400,
  fontSize,
  color,
  textAlign: 'left',
  verticalAlign: 'top',
  ...extra,
});

const time = (color: string): Kind['defaults'] =>
  text(110, color, { width: 520, height: 160, textAlign: 'center', verticalAlign: 'middle', showLabel: true, fontWeight: 500 });

export const STAGE_KINDS: Record<StageObjectKind, Kind> = {
  currentText: { label: 'Current Slide Text', sample: 'Current Slide Text', caption: 'Current Slide', defaults: text(180, '#ffffff') },
  nextText: { label: 'Next Slide Text', sample: 'Next Slide Text', caption: 'Next Slide', defaults: text(120, '#d79c1e') },
  currentNotes: {
    label: 'Current Slide Notes',
    sample: 'Current Slide Notes',
    caption: 'Notes',
    defaults: text(60, '#93c5fd', { height: 200 }),
  },
  nextNotes: {
    label: 'Next Slide Notes',
    sample: 'Next Slide Notes',
    caption: 'Next Notes',
    defaults: text(50, '#7dd3fc', { height: 200 }),
  },
  currentSlide: {
    label: 'Current Slide',
    sample: 'Current Slide',
    caption: 'Current Slide',
    defaults: text(40, '#ffffff', { width: 960, height: 540, showLabel: true }),
  },
  nextSlide: {
    label: 'Next Slide',
    sample: 'Next Slide',
    caption: 'Next Slide',
    defaults: text(40, '#ffffff', { width: 640, height: 360, showLabel: true }),
  },
  groupName: {
    label: 'Current Group',
    sample: 'Verse 1 · Amazing Grace',
    caption: 'Group',
    defaults: text(56, '#c4c4c4', { width: 1200, height: 90, verticalAlign: 'middle', fontWeight: 600 }),
  },
  title: {
    label: 'Presentation Title',
    sample: 'Presentation Title',
    caption: 'Presentation',
    defaults: text(56, '#c4c4c4', { width: 1200, height: 90, verticalAlign: 'middle', fontWeight: 600 }),
  },
  clock: { label: 'System Clock', sample: '1:23 PM', caption: 'Clock', defaults: { ...time('#ffffff'), showLabel: false } },
  timer: { label: 'Timer', sample: '5:00', caption: 'Timer', defaults: time('#f7941d') },
  videoCountdown: { label: 'Video Countdown', sample: '12:34', caption: 'Video Countdown', defaults: time('#ffffff') },
  message: {
    label: 'Stage Message',
    sample: 'Stage Message',
    caption: 'Message',
    defaults: text(80, '#111111', {
      width: 1920,
      height: 140,
      textAlign: 'center',
      verticalAlign: 'middle',
      fill: '#f5c518',
      fontWeight: 700,
    }),
  },
  text: { label: 'Text', sample: 'Text', caption: 'Text', defaults: text(80, '#ffffff', { width: 800, height: 140, text: 'Text' }) },
  shape: {
    label: 'Rectangle',
    sample: '',
    caption: 'Rectangle',
    defaults: text(40, '#ffffff', { width: 600, height: 300, fill: '#3a3a3a' }),
  },
};

/** The objects the editor's toolbar adds, in its menus. */
export const STAGE_MENUS: { label: string; icon: 'slides' | 'clock' | 'send' | 'text' | 'fill'; kinds: StageObjectKind[] }[] = [
  {
    label: 'Slide',
    icon: 'slides',
    kinds: ['currentText', 'nextText', 'currentNotes', 'nextNotes', 'currentSlide', 'nextSlide', 'groupName', 'title'],
  },
  { label: 'Time', icon: 'clock', kinds: ['clock', 'timer', 'videoCountdown'] },
  { label: 'Message', icon: 'send', kinds: ['message'] },
  { label: 'Text', icon: 'text', kinds: ['text'] },
  { label: 'Shape', icon: 'fill', kinds: ['shape'] },
];

/** A new object of a kind, placed at x, y (centred on the layout when not given). */
export function newStageObject(
  kind: StageObjectKind,
  layout: Pick<StageLayout, 'width' | 'height'>,
  at?: { x: number; y: number },
): StageObject {
  const k = STAGE_KINDS[kind];
  const width = Math.min(k.defaults.width, layout.width);
  const height = Math.min(k.defaults.height, layout.height);
  return {
    id: uid(),
    kind,
    name: k.label,
    ...k.defaults,
    width,
    height,
    x: at?.x ?? Math.round((layout.width - width) / 2),
    y: at?.y ?? Math.round((layout.height - height) / 2),
  };
}

const place = (
  kind: StageObjectKind,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<StageObject> = {},
): StageObject => ({
  ...newStageObject(kind, { width: 1920, height: 1080 }),
  x,
  y,
  width,
  height,
  ...extra,
});

/** Layouts to start from: ProPresenter's Current + Next Text, and two more. */
export function layoutTemplates(): StageLayout[] {
  return [
    {
      id: 'layout-current-next',
      name: 'Current + Next Text',
      width: 1920,
      height: 1080,
      background: '#000000',
      objects: [
        place('currentText', 0, 0, 1920, 520),
        place('nextText', 0, 530, 1920, 340),
        place('timer', 100, 900, 520, 160),
        place('clock', 700, 900, 520, 160),
        place('videoCountdown', 1300, 900, 520, 160),
        place('message', 0, 0, 1920, 140),
      ],
    },
    {
      id: 'layout-lyrics-notes',
      name: 'Lyrics & Notes',
      width: 1920,
      height: 1080,
      background: '#000000',
      objects: [
        place('groupName', 40, 20, 1300, 90),
        place('clock', 1480, 20, 400, 90, { fontSize: 64, textAlign: 'right' }),
        place('currentText', 40, 130, 1840, 520, { fontSize: 120 }),
        place('nextText', 40, 670, 1840, 230, { fontSize: 72, color: '#fcd34d' }),
        place('currentNotes', 40, 920, 1300, 140),
        place('timer', 1400, 920, 480, 140, { fontSize: 90 }),
        place('message', 0, 0, 1920, 140),
      ],
    },
    {
      id: 'layout-slides',
      name: 'Current & Next Slide',
      width: 1920,
      height: 1080,
      background: '#000000',
      objects: [
        place('currentSlide', 40, 120, 1120, 630),
        place('nextSlide', 1200, 120, 680, 383),
        place('clock', 1200, 560, 680, 160),
        place('timer', 1200, 760, 680, 160),
        place('currentNotes', 40, 800, 1120, 240),
        place('message', 0, 0, 1920, 100, { fontSize: 64 }),
      ],
    },
  ];
}

export const DEFAULT_STAGE_LAYOUTS: StageLayout[] = layoutTemplates();

/** The layout a stage screen shows: its own, else the first. */
export function layoutFor(screen: Pick<ScreenConfig, 'stageLayoutId'>, layouts: StageLayout[]): StageLayout {
  return layouts.find((l) => l.id === screen.stageLayoutId) ?? layouts[0] ?? DEFAULT_STAGE_LAYOUTS[0];
}

export const LAYOUT_SIZES = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 3840, height: 2160 },
  { width: 1024, height: 768 },
  { width: 1080, height: 1920 },
];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_BOX = 20;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A box after dragging one of its handles (or the box itself, for 'move') by dx, dy pixels of
 * the layout, kept on the layout and at least 20 pixels across.
 */
export function adjustBox(b: Box, handle: string, dx: number, dy: number, layout: Pick<StageLayout, 'width' | 'height'>): Box {
  if (handle === 'move')
    return {
      ...b,
      x: Math.round(clamp(b.x + dx, 0, Math.max(0, layout.width - b.width))),
      y: Math.round(clamp(b.y + dy, 0, Math.max(0, layout.height - b.height))),
    };
  let { x, y } = b;
  let right = b.x + b.width;
  let bottom = b.y + b.height;
  if (handle.includes('w')) x = clamp(x + dx, 0, right - MIN_BOX);
  if (handle.includes('e')) right = clamp(right + dx, x + MIN_BOX, layout.width);
  if (handle.includes('n')) y = clamp(y + dy, 0, bottom - MIN_BOX);
  if (handle.includes('s')) bottom = clamp(bottom + dy, y + MIN_BOX, layout.height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(right - x), height: Math.round(bottom - y) };
}

/** A copy of a layout with new ids, named "<name> copy". */
export function copyLayout(l: StageLayout): StageLayout {
  return {
    ...structuredClone(l),
    id: uid(),
    name: `${l.name} copy`,
    objects: l.objects.map((o) => ({ ...structuredClone(o), id: uid() })),
  };
}
