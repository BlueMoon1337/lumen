import type { Presentation, Settings, Slide, SlideTransition, TransitionDirection, TransitionKind } from './types';

export const DEFAULT_TRANSITION: SlideTransition = { kind: 'dissolve', ms: 400 };

export const TRANSITION_KINDS: { kind: TransitionKind; label: string; directional?: boolean; hint: string }[] = [
  { kind: 'cut', label: 'Cut', hint: 'Straight to the next slide' },
  { kind: 'dissolve', label: 'Dissolve', hint: 'The next slide fades in as this one fades out' },
  { kind: 'fade', label: 'Fade', hint: 'Fades out, then the next slide fades in' },
  { kind: 'push', label: 'Push', directional: true, hint: 'The next slide pushes this one off' },
  { kind: 'wipe', label: 'Wipe', directional: true, hint: 'An edge sweeps across, revealing the next slide' },
  { kind: 'zoom', label: 'Zoom', hint: 'The next slide grows in as this one grows away' },
  { kind: 'blur', label: 'Blur', hint: 'Blurs out, and the next slide comes into focus' },
];

export const DIRECTIONS: { value: TransitionDirection; label: string; arrow: string }[] = [
  { value: 'left', label: 'Left', arrow: '←' },
  { value: 'right', label: 'Right', arrow: '→' },
  { value: 'up', label: 'Up', arrow: '↑' },
  { value: 'down', label: 'Down', arrow: '↓' },
];

/** Durations offered in menus, in ms. */
export const QUICK_DURATIONS = [250, 500, 1000, 2000];

export const isDirectional = (kind: TransitionKind) => kind === 'push' || kind === 'wipe';

/** A transition of a given length, the way older versions stored it: 0 is a cut, anything else a dissolve. */
export const fromMs = (ms: number): SlideTransition => (ms > 0 ? { kind: 'dissolve', ms } : { kind: 'cut', ms: 0 });

/** The transition a slide comes on with: its own, else its presentation's, else the global one. */
export function effectiveTransition(settings: Pick<Settings, 'transition'>, p?: Presentation, slide?: Slide): SlideTransition {
  return slide?.transition ?? p?.transition ?? settings.transition ?? DEFAULT_TRANSITION;
}

/** How long a transition takes on screen. */
export const transitionDuration = (t: SlideTransition) => (t.kind === 'cut' ? 0 : t.ms);

const seconds = (ms: number) => `${Number((ms / 1000).toFixed(2))}s`;

/** "Push Left · 0.5s", "Cut". */
export function transitionLabel(t: SlideTransition): string {
  const kind = TRANSITION_KINDS.find((k) => k.kind === t.kind)?.label ?? t.kind;
  if (t.kind === 'cut') return kind;
  const dir = isDirectional(t.kind) ? ` ${DIRECTIONS.find((d) => d.value === (t.direction ?? 'left'))?.label}` : '';
  return `${kind}${dir} · ${seconds(t.ms)}`;
}

export const sameTransition = (a?: SlideTransition, b?: SlideTransition) =>
  a === b ||
  (!!a && !!b && a.kind === b.kind && (a.kind === 'cut' || a.ms === b.ms) && (!isDirectional(a.kind) || a.direction === b.direction));

/**
 * ProPresenter 7's effect directions (TopLeft = 1 … BottomRight = 9) in the way they move.
 * The diagonals go sideways.
 */
const PRO_DIRECTIONS: Record<number, TransitionDirection> = {
  1: 'left',
  2: 'up',
  3: 'right',
  4: 'left',
  6: 'right',
  7: 'left',
  8: 'down',
  9: 'right',
};

/** A ProPresenter transition (effect name, length in seconds, direction) as the nearest Lumen one. */
export function transitionFromPro(name: string | undefined, secs: number, direction?: number): SlideTransition {
  const ms = Math.round(Math.max(0, secs) * 1000);
  const n = (name ?? '').toLowerCase();
  const kind: TransitionKind =
    ms === 0 || n === 'cut'
      ? 'cut'
      : n.includes('push') || n.includes('slide') || n.includes('move')
        ? 'push'
        : n.includes('wipe') || n.includes('reveal')
          ? 'wipe'
          : n.includes('zoom') || n.includes('scale')
            ? 'zoom'
            : n.includes('blur')
              ? 'blur'
              : n.includes('fade') || n.includes('black')
                ? 'fade'
                : 'dissolve';
  const t: SlideTransition = { kind, ms: kind === 'cut' ? 0 : ms };
  if (isDirectional(kind)) t.direction = PRO_DIRECTIONS[direction ?? 0] ?? 'left';
  return t;
}
