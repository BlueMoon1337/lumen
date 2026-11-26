import type {
  CornerPin,
  DisplayRef,
  EdgeBlend,
  OutputColor,
  OutputTarget,
  ScreenConfig,
  ScreenKind,
  ScreenOutput,
  ScreenSetup,
} from './types';
import { uid } from './util';

export const DEFAULT_COLOR: OutputColor = { brightness: 1, contrast: 1, saturation: 1, hue: 0 };
export const DEFAULT_PIN: CornerPin = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
export const DEFAULT_BLEND: EdgeBlend = { overlap: 240, gamma: 2.2 };

export function newOutput(display?: DisplayRef): ScreenOutput {
  return {
    id: uid(),
    display,
    target: { type: 'full' },
    delayFrames: 0,
    color: { ...DEFAULT_COLOR },
    cornerPin: structuredClone(DEFAULT_PIN),
    alphaKey: 'off',
  };
}

export function newScreen(kind: ScreenKind, name: string): ScreenConfig {
  return {
    id: uid(),
    kind,
    name,
    width: 1920,
    height: 1080,
    mode: 'mirror',
    columns: 2,
    blend: { ...DEFAULT_BLEND },
    outputs: [newOutput()],
  };
}

/** Fills in settings added since a setup was saved (or exported). */
export function normalizeScreens(setup: Partial<ScreenSetup> | undefined): ScreenSetup {
  if (!setup?.screens) return defaultScreenSetup();
  return {
    audienceEnabled: !!setup.audienceEnabled,
    stageEnabled: !!setup.stageEnabled,
    screens: setup.screens.map((s) => {
      const outputs = (s.outputs ?? []).map((o) => ({ ...newOutput(), ...o, target: o.target ?? { type: 'full' } }));
      return {
        ...newScreen(s.kind, s.name),
        ...s,
        mode: s.mode ?? 'mirror',
        columns: s.columns ?? 2,
        blend: { ...DEFAULT_BLEND, ...s.blend },
        outputs: outputs.length ? outputs : [newOutput()],
      };
    }),
  };
}

// ---- Layout ---------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The outputs a screen uses: Single uses only the first, and keeps the rest for switching back. */
export const usedOutputs = (screen: ScreenConfig): ScreenOutput[] =>
  screen.mode === 'single' ? screen.outputs.slice(0, 1) : screen.outputs;

export const isGrouped = (screen: ScreenConfig) => screen.mode === 'grouped' || screen.mode === 'blend';

/**
 * The screen's whole picture and the part each used output shows, in pixels.
 * Mirrored outputs each show all of it; grouped outputs tile it left to right,
 * then top to bottom; blended ones overlap their neighbours by `overlap`.
 */
export function screenLayout(screen: ScreenConfig): {
  width: number;
  height: number;
  cols: number;
  rows: number;
  overlap: number;
  rects: Rect[];
} {
  const n = usedOutputs(screen).length;
  const { width: w, height: h } = screen;
  if (!isGrouped(screen)) {
    return {
      width: w,
      height: h,
      cols: 1,
      rows: 1,
      overlap: 0,
      rects: Array.from({ length: n }, () => ({ x: 0, y: 0, width: w, height: h })),
    };
  }
  const cols = Math.max(1, Math.min(n, Math.round(screen.columns) || 1));
  const rows = Math.ceil(n / cols);
  const overlap = screen.mode === 'blend' ? Math.max(0, Math.min(Math.round(screen.blend.overlap), Math.floor(Math.min(w, h) / 2))) : 0;
  const rects = Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * (w - overlap),
    y: Math.floor(i / cols) * (h - overlap),
    width: w,
    height: h,
  }));
  return { width: cols * w - (cols - 1) * overlap, height: rows * h - (rows - 1) * overlap, cols, rows, overlap, rects };
}

/**
 * How bright a projector should be across an overlap, from its outer edge
 * (t = 0) to where its neighbour's picture ends (t = 1). Two overlapping
 * projectors' light, value^gamma, adds up to one everywhere.
 */
export function blendAlpha(t: number, gamma: number): number {
  const c = Math.max(0, Math.min(1, t));
  const s = c * c * (3 - 2 * c);
  return Math.pow(s, 1 / Math.max(0.1, gamma));
}

/** CSS mask layers that fade an output's edges where it overlaps its neighbours (combine with mask-composite: intersect). */
export function blendMask(screen: ScreenConfig, index: number): string[] {
  if (screen.mode !== 'blend') return [];
  const { cols, overlap, rects } = screenLayout(screen);
  if (!overlap) return [];
  const col = index % cols;
  const n = rects.length;
  const ramp = (direction: string, size: number) => {
    const stops = Array.from(
      { length: 11 },
      (_, i) => `rgba(0, 0, 0, ${blendAlpha(i / 10, screen.blend.gamma).toFixed(3)}) ${((i / 10) * size).toFixed(2)}%`,
    );
    return `linear-gradient(${direction}, ${stops.join(', ')}, #000 ${size.toFixed(2)}%)`;
  };
  const fx = (overlap / screen.width) * 100;
  const fy = (overlap / screen.height) * 100;
  return [
    col > 0 && ramp('to right', fx),
    col < cols - 1 && index + 1 < n && ramp('to left', fx),
    index >= cols && ramp('to bottom', fy),
    index + cols < n && ramp('to top', fy),
  ].filter((m): m is string => !!m);
}

// ---- Output targets ---------------------------------------------------------------

export const TARGET_GRIDS: [number, number][] = [
  [2, 1],
  [2, 2],
  [3, 1],
];

export function describeTarget(t: OutputTarget): string {
  return t.type === 'grid' ? `${t.cols} x ${t.rows}` : t.type === 'custom' ? 'Custom' : 'Full';
}

/** The part of its display's signal an output fills, as fractions (0–1). */
export function targetRect(target: OutputTarget, signal: { width: number; height: number }): Rect {
  if (target.type === 'grid') {
    const cols = Math.max(1, target.cols);
    const rows = Math.max(1, target.rows);
    const cell = Math.max(0, Math.min(cols * rows - 1, target.cell));
    return { x: (cell % cols) / cols, y: Math.floor(cell / cols) / rows, width: 1 / cols, height: 1 / rows };
  }
  if (target.type === 'custom') {
    return {
      x: target.x / signal.width,
      y: target.y / signal.height,
      width: target.width / signal.width,
      height: target.height / signal.height,
    };
  }
  return { x: 0, y: 0, width: 1, height: 1 };
}

export function defaultScreenSetup(): ScreenSetup {
  return {
    audienceEnabled: false,
    stageEnabled: false,
    screens: [newScreen('audience', 'Screen 1'), newScreen('stage', 'Stage Screen 1')],
  };
}

export function nextScreenName(setup: ScreenSetup, kind: ScreenKind): string {
  const base = kind === 'audience' ? 'Screen' : 'Stage Screen';
  const taken = new Set(setup.screens.map((s) => s.name));
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

// ---- Displays ---------------------------------------------------------------------

/** A display the computer can see right now: a built-in panel, or a TV/projector on HDMI, DisplayPort, USB-C… */
export interface DetectedDisplay {
  id?: number;
  /** The name the display reports about itself (e.g. "E65-E0"), or a generic one. */
  label: string;
  width: number;
  height: number;
  /** Built into the computer (a laptop panel). Unset when the browser can't tell. */
  internal?: boolean;
  primary: boolean;
  /** The display the operator window is on. */
  current: boolean;
  refresh?: number;
  /** Position in the desktop, for placing windows. */
  left?: number;
  top?: number;
  /** Device pixels per desktop unit (2 on a Retina display); width and height are in device pixels. */
  scale?: number;
}

export const toDisplayRef = (d: DetectedDisplay): DisplayRef => ({ id: d.id, label: d.label, width: d.width, height: d.height });

/** Finds a remembered display among the connected ones: same id and name, else same name and size, else same name. */
export function findDisplay(ref: DisplayRef, displays: DetectedDisplay[]): DetectedDisplay | undefined {
  return (
    displays.find((d) => ref.id != null && d.id === ref.id && d.label === ref.label) ??
    displays.find((d) => d.label === ref.label && d.width === ref.width && d.height === ref.height) ??
    displays.find((d) => d.label === ref.label)
  );
}

export interface PlannedOutput {
  /** Stable key for this output's window. */
  key: string;
  kind: ScreenKind;
  screen: ScreenConfig;
  output: ScreenOutput;
  /** Position among the screen's used outputs. */
  index: number;
  display?: DetectedDisplay;
  /**
   * display: shown on a connected display.
   * window: Automatic with no spare display, so it opens as a window on the operator's screen.
   * disconnected: its assigned display isn't connected; it comes back when the display does.
   * placeholder: holds a place for a display that isn't here; shown nowhere.
   */
  status: 'display' | 'window' | 'disconnected' | 'placeholder';
}

/**
 * Decides where every output goes. Assigned outputs use their display when it's
 * connected. Automatic outputs take the first spare display that isn't the
 * operator's (external screens first), audience screens before stage screens.
 * Automatic outputs that fill only part of a signal (2 x 1 and so on) share one
 * display, as they would through a multi-display adapter.
 */
export function planOutputs(setup: ScreenSetup, displays: DetectedDisplay[]): PlannedOutput[] {
  const used = new Set<DetectedDisplay>();
  const order = [...setup.screens.filter((s) => s.kind === 'audience'), ...setup.screens.filter((s) => s.kind === 'stage')];
  const entries = order.flatMap((screen) =>
    usedOutputs(screen).map(
      (output, index): PlannedOutput => ({
        key: `${screen.id}:${output.id}`,
        kind: screen.kind,
        screen,
        output,
        index,
        status: output.placeholder ? 'placeholder' : 'window',
      }),
    ),
  );

  for (const e of entries) {
    if (!e.output.display || e.status === 'placeholder') continue;
    const d = findDisplay(e.output.display, displays);
    if (d) {
      e.display = d;
      e.status = 'display';
      used.add(d);
    } else e.status = 'disconnected';
  }

  const operator = (d: DetectedDisplay) => (displays.some((x) => x.current) ? d.current : d.primary);
  const spare = () => displays.filter((d) => !used.has(d) && !operator(d)).sort((a, b) => Number(!!a.internal) - Number(!!b.internal))[0];
  let shared: DetectedDisplay | undefined;
  for (const e of entries) {
    if (e.output.display || e.status === 'placeholder') continue;
    const split = e.output.target.type !== 'full';
    const d = (split && shared) || spare();
    if (d) {
      e.display = d;
      e.status = 'display';
      used.add(d);
      if (split) shared = d;
    }
  }

  return entries.sort((a, b) => setup.screens.indexOf(a.screen) - setup.screens.indexOf(b.screen) || a.index - b.index);
}

/** The outputs that should be showing right now. */
export function activeOutputs(setup: ScreenSetup, displays: DetectedDisplay[]): PlannedOutput[] {
  return planOutputs(setup, displays).filter(
    (p) => (p.status === 'display' || p.status === 'window') && (p.kind === 'audience' ? setup.audienceEnabled : setup.stageEnabled),
  );
}

// ---- Output windows ---------------------------------------------------------------

/**
 * One output window: fullscreen on a display, showing every output that goes
 * to that display in its part of the signal, or a plain window for one output
 * that has no display.
 */
export interface OutputHost {
  key: string;
  display?: DetectedDisplay;
  outputs: PlannedOutput[];
  /** Pixel size of the signal, which output targets are measured in. */
  width: number;
  height: number;
}

export const hostKey = (p: PlannedOutput) =>
  p.status === 'display' && p.display ? `display:${p.display.id ?? p.display.label}` : `window:${p.key}`;

/** The signal size an output's target is measured in: its display's, or what it would be on one. */
export function signalSize(p: Pick<PlannedOutput, 'screen' | 'output' | 'display'>): { width: number; height: number } {
  const d = p.display ?? p.output.display ?? p.output.placeholder;
  if (d) return { width: d.width, height: d.height };
  const t = p.output.target;
  return t.type === 'grid'
    ? { width: p.screen.width * t.cols, height: p.screen.height * t.rows }
    : { width: p.screen.width, height: p.screen.height };
}

export function planHosts(outputs: PlannedOutput[]): OutputHost[] {
  const hosts = new Map<string, OutputHost>();
  for (const p of outputs) {
    const key = hostKey(p);
    const host = hosts.get(key) ?? { key, display: p.status === 'display' ? p.display : undefined, outputs: [], ...signalSize(p) };
    host.outputs.push(p);
    hosts.set(key, host);
  }
  return [...hosts.values()];
}

/** The output window's address within the app: its signal size and the outputs it shows. */
export const hostRoute = (h: Pick<OutputHost, 'width' | 'height' | 'outputs'>) =>
  `screen?size=${h.width}x${h.height}&${h.outputs.map((p) => `o=${encodeURIComponent(p.screen.id)}:${encodeURIComponent(p.output.id)}`).join('&')}`;

export function describeDisplay(d: Pick<DetectedDisplay, 'width' | 'height' | 'internal' | 'refresh'>): string {
  const hz = d.refresh ? ` @ ${Math.round(d.refresh)} Hz` : '';
  const kind = d.internal === undefined ? '' : d.internal ? 'Built-in · ' : 'External · ';
  return `${kind}${d.width} × ${d.height}${hz}`;
}

// ---- Picture adjustments ------------------------------------------------------------

export function colorFilter(c: OutputColor): string | undefined {
  const parts = [
    c.brightness !== 1 && `brightness(${c.brightness})`,
    c.contrast !== 1 && `contrast(${c.contrast})`,
    c.saturation !== 1 && `saturate(${c.saturation})`,
    c.hue !== 0 && `hue-rotate(${c.hue}deg)`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

type M3 = number[];

const adj = (m: M3): M3 => [
  m[4] * m[8] - m[5] * m[7],
  m[2] * m[7] - m[1] * m[8],
  m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8],
  m[0] * m[8] - m[2] * m[6],
  m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6],
  m[1] * m[6] - m[0] * m[7],
  m[0] * m[4] - m[1] * m[3],
];

const mul = (a: M3, b: M3): M3 => {
  const out: M3 = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return out;
};

const mulV = (m: M3, v: number[]) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Maps the unit square's corners onto four points (projective basis). */
function basis(p: number[]): M3 {
  const m = [p[0], p[2], p[4], p[1], p[3], p[5], 1, 1, 1];
  const v = mulV(adj(m), [p[6], p[7], 1]);
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

/** The 3×3 projective transform taking a w×h rectangle's corners to the pinned corners (in pixels). */
export function cornerPinHomography(pin: CornerPin, w: number, h: number): M3 {
  const src = [0, 0, w, 0, 0, h, w, h];
  const dst = [pin.tl.x * w, pin.tl.y * h, pin.tr.x * w, pin.tr.y * h, pin.bl.x * w, pin.bl.y * h, pin.br.x * w, pin.br.y * h];
  const t = mul(basis(dst), adj(basis(src)));
  return t.map((v) => v / t[8]);
}

export const isDefaultPin = (pin: CornerPin) =>
  (['tl', 'tr', 'br', 'bl'] as const).every((k) => pin[k].x === DEFAULT_PIN[k].x && pin[k].y === DEFAULT_PIN[k].y);

/** CSS transform (with transform-origin 0 0) that keystones a w×h element to the pinned corners. */
export function cornerPinTransform(pin: CornerPin, w: number, h: number): string | undefined {
  if (isDefaultPin(pin)) return undefined;
  const t = cornerPinHomography(pin, w, h);
  return `matrix3d(${t[0]}, ${t[3]}, 0, ${t[6]}, ${t[1]}, ${t[4]}, 0, ${t[7]}, 0, 0, 1, 0, ${t[2]}, ${t[5]}, 0, ${t[8]})`;
}
