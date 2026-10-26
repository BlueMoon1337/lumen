import type { CornerPin, DisplayRef, OutputColor, ScreenConfig, ScreenKind, ScreenOutput, ScreenSetup } from './types';
import { uid } from './util';

export const DEFAULT_COLOR: OutputColor = { brightness: 1, contrast: 1, saturation: 1, hue: 0 };
export const DEFAULT_PIN: CornerPin = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };

export function newOutput(display?: DisplayRef): ScreenOutput {
  return { id: uid(), display, delayFrames: 0, color: { ...DEFAULT_COLOR }, cornerPin: structuredClone(DEFAULT_PIN), alphaKey: 'off' };
}

export function newScreen(kind: ScreenKind, name: string): ScreenConfig {
  return { id: uid(), kind, name, width: 1920, height: 1080, outputs: [newOutput()] };
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
  index: number;
  display?: DetectedDisplay;
  /**
   * display: shown fullscreen on a connected display.
   * window: Automatic with no spare display, so it opens as a window on the operator's screen.
   * disconnected: its assigned display isn't connected; it comes back when the display does.
   */
  status: 'display' | 'window' | 'disconnected';
}

/**
 * Decides where every output goes. Assigned outputs use their display when it's
 * connected. Automatic outputs take the first spare display that isn't the
 * operator's (external screens first), audience screens before stage screens.
 */
export function planOutputs(setup: ScreenSetup, displays: DetectedDisplay[]): PlannedOutput[] {
  const used = new Set<DetectedDisplay>();
  const order = [...setup.screens.filter((s) => s.kind === 'audience'), ...setup.screens.filter((s) => s.kind === 'stage')];
  const entries = order.flatMap((screen) =>
    screen.outputs.map((output, index): PlannedOutput => ({
      key: `${screen.id}:${output.id}`,
      kind: screen.kind,
      screen,
      output,
      index,
      status: 'window',
    })),
  );

  for (const e of entries) {
    if (!e.output.display) continue;
    const d = findDisplay(e.output.display, displays);
    if (d) {
      e.display = d;
      e.status = 'display';
      used.add(d);
    } else e.status = 'disconnected';
  }

  const operator = (d: DetectedDisplay) => (displays.some((x) => x.current) ? d.current : d.primary);
  const spare = () => displays.filter((d) => !used.has(d) && !operator(d)).sort((a, b) => Number(!!a.internal) - Number(!!b.internal))[0];
  for (const e of entries) {
    if (e.output.display) continue;
    const d = spare();
    if (d) {
      e.display = d;
      e.status = 'display';
      used.add(d);
    }
  }

  return entries.sort((a, b) => setup.screens.indexOf(a.screen) - setup.screens.indexOf(b.screen) || a.index - b.index);
}

/** The outputs that should have a window open right now. */
export function activeOutputs(setup: ScreenSetup, displays: DetectedDisplay[]): PlannedOutput[] {
  return planOutputs(setup, displays).filter(
    (p) => p.status !== 'disconnected' && (p.kind === 'audience' ? setup.audienceEnabled : setup.stageEnabled),
  );
}

/** The output window's address within the app. */
export const outputRoute = (p: Pick<PlannedOutput, 'kind' | 'screen' | 'output'>) =>
  `${p.kind === 'stage' ? 'stage' : 'output'}?screen=${encodeURIComponent(p.screen.id)}&output=${encodeURIComponent(p.output.id)}`;

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
