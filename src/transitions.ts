import type { Presentation, Settings, Slide, SlideTransition, TransitionDirection, TransitionEasing, TransitionKind } from './types';

export const DEFAULT_TRANSITION: SlideTransition = { kind: 'dissolve', ms: 400 };

const MOVES: TransitionDirection[] = ['left', 'right', 'up', 'down'];

export const TRANSITION_KINDS: {
  kind: TransitionKind;
  label: string;
  hint: string;
  /** The ways it can move; none for kinds that don't. */
  directions?: TransitionDirection[];
  /** How it speeds up and slows down unless the transition says otherwise. */
  easing: TransitionEasing;
}[] = [
  { kind: 'cut', label: 'Cut', hint: 'Straight to the next slide', easing: 'linear' },
  { kind: 'dissolve', label: 'Dissolve', hint: 'The next slide fades in as this one fades out', easing: 'ease-in-out' },
  { kind: 'fade', label: 'Fade', hint: 'This slide fades out, then the next fades in', easing: 'ease-in-out' },
  { kind: 'push', label: 'Push', hint: 'The next slide pushes this one off', directions: MOVES, easing: 'ease-in-out' },
  { kind: 'slide', label: 'Slide', hint: 'The next slide slides in over this one', directions: MOVES, easing: 'ease-out' },
  { kind: 'reveal', label: 'Reveal', hint: 'This slide slides away, uncovering the next', directions: MOVES, easing: 'ease-in' },
  { kind: 'wipe', label: 'Wipe', hint: 'An edge sweeps across, revealing the next slide', directions: MOVES, easing: 'linear' },
  { kind: 'split', label: 'Split', hint: 'The next slide opens out from the middle', directions: ['left', 'up'], easing: 'ease-out' },
  { kind: 'iris', label: 'Iris', hint: 'The next slide opens in a growing circle', easing: 'ease-in' },
  { kind: 'zoom', label: 'Zoom', hint: 'The next slide grows in as this one grows away', easing: 'ease-out' },
  { kind: 'blur', label: 'Blur', hint: 'Blurs out, and the next slide comes into focus', easing: 'ease-in-out' },
  { kind: 'flip', label: 'Flip', hint: 'Turns over like a card', directions: MOVES, easing: 'ease-in-out' },
  { kind: 'cube', label: 'Cube', hint: 'Turns like the sides of a cube', directions: MOVES, easing: 'ease-in-out' },
];

export const DIRECTIONS: { value: TransitionDirection; label: string; arrow: string }[] = [
  { value: 'left', label: 'Left', arrow: '←' },
  { value: 'right', label: 'Right', arrow: '→' },
  { value: 'up', label: 'Up', arrow: '↑' },
  { value: 'down', label: 'Down', arrow: '↓' },
];

export const EASINGS: { value: TransitionEasing; label: string; css: string }[] = [
  { value: 'linear', label: 'Even', css: 'linear' },
  { value: 'ease-in', label: 'Ease In', css: 'cubic-bezier(0.42, 0, 1, 1)' },
  { value: 'ease-out', label: 'Ease Out', css: 'cubic-bezier(0, 0, 0.58, 1)' },
  { value: 'ease-in-out', label: 'Ease In & Out', css: 'cubic-bezier(0.42, 0, 0.58, 1)' },
];

/** Durations offered in menus, in ms. */
export const QUICK_DURATIONS = [250, 500, 1000, 2000];

const kindInfo = (kind: TransitionKind) => TRANSITION_KINDS.find((k) => k.kind === kind) ?? TRANSITION_KINDS[1];

/** The ways a kind can move, or none. */
export const directionsOf = (kind: TransitionKind) => kindInfo(kind).directions ?? [];
export const isDirectional = (kind: TransitionKind) => directionsOf(kind).length > 0;

/** "Left", or for a split "Sideways" / "Up & Down". */
export function directionLabel(kind: TransitionKind, d: TransitionDirection = 'left'): string {
  if (kind === 'split') return d === 'up' || d === 'down' ? 'Up & Down' : 'Sideways';
  return DIRECTIONS.find((x) => x.value === d)?.label ?? d;
}

/** The direction a transition actually moves (its own, if the kind allows it, else the kind's first). */
export function directionOf(t: Pick<SlideTransition, 'kind' | 'direction'>): TransitionDirection | undefined {
  const dirs = directionsOf(t.kind);
  if (!dirs.length) return undefined;
  if (t.kind === 'split') return t.direction === 'up' || t.direction === 'down' ? 'up' : 'left';
  return t.direction && dirs.includes(t.direction) ? t.direction : dirs[0];
}

/** The easing a transition plays with: its own, or its kind's. */
export const easingOf = (t: Pick<SlideTransition, 'kind' | 'easing'>): TransitionEasing => t.easing ?? kindInfo(t.kind).easing;
export const easingCss = (t: Pick<SlideTransition, 'kind' | 'easing'>) => EASINGS.find((e) => e.value === easingOf(t))!.css;

/**
 * A transition with a new kind, direction, length or easing, kept sensible: a direction only for
 * kinds that move, a length for anything but a cut, and the kind's own easing when the kind changes.
 */
export function withChanges(t: SlideTransition, patch: Partial<SlideTransition>): SlideTransition {
  const next: SlideTransition = { ...t, ...patch };
  // A new kind starts with the easing that suits it.
  if (patch.kind && patch.kind !== t.kind && !patch.easing) delete next.easing;
  if (next.kind !== 'cut' && next.ms < 100) next.ms = DEFAULT_TRANSITION.ms;
  const direction = directionOf(next);
  if (direction) next.direction = direction;
  else delete next.direction;
  if (next.easing === undefined) delete next.easing;
  return next;
}

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
  const kind = kindInfo(t.kind).label;
  if (t.kind === 'cut') return kind;
  const direction = directionOf(t);
  return `${kind}${direction ? ` ${directionLabel(t.kind, direction)}` : ''} · ${seconds(t.ms)}`;
}

export const sameTransition = (a?: SlideTransition, b?: SlideTransition) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === 'cut' || (a.ms === b.ms && easingOf(a) === easingOf(b))) &&
    directionOf(a) === directionOf(b));

/** How backgrounds from the media bin come and go. */
export const mediaTransitionOf = (settings: Pick<Settings, 'mediaTransition'>) => settings.mediaTransition ?? DEFAULT_TRANSITION;

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
  const has = (...words: string[]) => words.some((w) => n.includes(w));
  const kind: TransitionKind =
    ms === 0 || n === 'cut'
      ? 'cut'
      : has('cube')
        ? 'cube'
        : has('flip', 'swap', 'card')
          ? 'flip'
          : has('iris', 'circle')
            ? 'iris'
            : has('split', 'barn', 'door')
              ? 'split'
              : has('reveal', 'uncover')
                ? 'reveal'
                : has('slide', 'cover')
                  ? 'slide'
                  : has('push', 'move')
                    ? 'push'
                    : has('wipe')
                      ? 'wipe'
                      : has('zoom', 'scale')
                        ? 'zoom'
                        : has('blur')
                          ? 'blur'
                          : has('fade', 'black')
                            ? 'fade'
                            : 'dissolve';
  const t: SlideTransition = { kind, ms: kind === 'cut' ? 0 : ms };
  if (isDirectional(kind)) t.direction = directionOf({ kind, direction: PRO_DIRECTIONS[direction ?? 0] ?? 'left' });
  return t;
}
