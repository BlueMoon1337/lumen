import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SlideScope } from '../slideOps';
import { useStore } from '../store';
import { DEFAULT_TRANSITION, DIRECTIONS, isDirectional, sameTransition, TRANSITION_KINDS, transitionLabel } from '../transitions';
import type { Presentation, SlideTransition, TransitionKind } from '../types';
import { Transition } from './Canvas';
import { openPopupBelow } from './ContextMenu';

const GLYPHS: Record<TransitionKind, string> = {
  cut: 'M3 6h7v12H3zM14 6h7v12h-7z',
  dissolve: 'M3 4h12v10H3zM9 10h12v10H9z',
  fade: 'M3 6h18v12H3zM12 6v12M15 6v12M18 6v12',
  push: 'M2 6h9v12H2zM13 6h9v12h-9zM6 12h10M13 9l3 3-3 3',
  wipe: 'M3 6h18v12H3zM13 4v16M16 12h-8M11 9l-3 3 3 3',
  zoom: 'M3 4h18v16H3zM8 8.5h8v7H8z',
  blur: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
};

export function TransitionGlyph({ kind, size = 22 }: { kind: TransitionKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={GLYPHS[kind]} />
    </svg>
  );
}

function MockSlide({ n }: { n: 1 | 2 }) {
  return (
    <div className={`tp-mock tp-mock-${n}`}>
      <span>{n === 1 ? 'Amazing grace' : 'How sweet the sound'}</span>
    </div>
  );
}

/** Plays a transition over and over between two sample slides. */
export function TransitionPreview({ transition }: { transition: SlideTransition }) {
  const [flip, setFlip] = useState(false);
  const ms = transition.kind === 'cut' ? 0 : transition.ms;
  useEffect(() => {
    setFlip(false);
    const t = setInterval(() => setFlip((f) => !f), ms + 900);
    return () => clearInterval(t);
  }, [ms, transition.kind, transition.direction]);
  return (
    <div className="tp-preview" aria-hidden>
      <Transition itemKey={flip ? 'b' : 'a'} duration={ms} effect={transition}>
        <MockSlide n={flip ? 2 : 1} />
      </Transition>
    </div>
  );
}

/**
 * Chooses a transition: the kind, its direction and length, with a preview that plays it.
 * With `inherited`, the transition can also be left to follow the one above it.
 */
export function TransitionPicker({
  value,
  inherited,
  inheritedLabel,
  onChange,
}: {
  /** This scope's own transition; undefined follows `inherited`. */
  value: SlideTransition | undefined;
  inherited?: SlideTransition;
  inheritedLabel?: string;
  onChange: (t: SlideTransition | undefined) => void;
}) {
  const shown = value ?? inherited ?? DEFAULT_TRANSITION;
  const [hover, setHover] = useState<TransitionKind | null>(null);
  const set = (patch: Partial<SlideTransition>) => {
    const next = { ...shown, ...patch };
    // A cut has no length; going from a cut to anything else needs one.
    if (next.kind !== 'cut' && next.ms < 100) next.ms = DEFAULT_TRANSITION.ms;
    if (isDirectional(next.kind)) next.direction ??= 'left';
    else delete next.direction;
    onChange(next);
  };
  const previewed = hover ? { ...shown, kind: hover, ms: shown.ms < 100 ? DEFAULT_TRANSITION.ms : shown.ms } : shown;

  return (
    <div className="tp">
      <TransitionPreview transition={previewed} />
      <div className="tp-current">{transitionLabel(previewed)}</div>
      {inherited && (
        <label className="check-row tp-inherit">
          <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? undefined : { ...inherited })} />
          <span>
            Use {inheritedLabel} <span className="muted">({transitionLabel(inherited)})</span>
          </span>
        </label>
      )}
      <div className="tp-kinds" onMouseLeave={() => setHover(null)}>
        {TRANSITION_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={`tp-kind ${shown.kind === k.kind ? 'on' : ''} ${value ? '' : 'inherited'}`}
            title={k.hint}
            onMouseEnter={() => setHover(k.kind)}
            onFocus={() => setHover(k.kind)}
            onClick={() => set({ kind: k.kind })}
          >
            <TransitionGlyph kind={k.kind} />
            <span>{k.label}</span>
          </button>
        ))}
      </div>
      {isDirectional(shown.kind) && (
        <div className="tp-row">
          <span className="tp-row-label">Direction</span>
          <div className="seg">
            {DIRECTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={(shown.direction ?? 'left') === d.value ? 'on' : ''}
                title={d.label}
                aria-label={d.label}
                onClick={() => set({ direction: d.value })}
              >
                {d.arrow}
              </button>
            ))}
          </div>
        </div>
      )}
      {shown.kind !== 'cut' && (
        <label className="tp-row">
          <span className="tp-row-label">Duration</span>
          <input type="range" min={100} max={3000} step={50} value={shown.ms} onChange={(e) => set({ ms: Number(e.target.value) })} />
          <span className="tp-seconds">{(shown.ms / 1000).toFixed(2)}s</span>
        </label>
      )}
    </div>
  );
}

export type TransitionTarget = { presentationId: string; scope: SlideScope } | 'global';

/** What a slide, group, presentation or the global setting has, and what it falls back to. */
export function transitionState(
  s: { settings: { transition: SlideTransition }; presentations: Record<string, Presentation> },
  target: TransitionTarget,
): { value?: SlideTransition; inherited?: SlideTransition; inheritedLabel?: string; title: string } {
  if (target === 'global') return { value: s.settings.transition, title: 'Default Transition' };
  const p = s.presentations[target.presentationId];
  const global = s.settings.transition;
  const { scope } = target;
  if (!p) return { title: 'Transition' };
  if (scope === 'presentation')
    return { value: p.transition, inherited: global, inheritedLabel: 'the default from Settings', title: `Transition · ${p.title}` };
  const inherited = p.transition ?? global;
  const inheritedLabel = p.transition ? "the presentation's transition" : 'the default from Settings';
  if ('groupId' in scope) {
    const g = p.groups.find((x) => x.id === scope.groupId);
    const first = g?.slides[0]?.transition;
    const common = g?.slides.every((sl) => sameTransition(sl.transition, first)) ? first : undefined;
    return { value: common, inherited, inheritedLabel, title: `Transition · ${g?.name ?? 'Group'}` };
  }
  const slide = p.groups.flatMap((g) => g.slides).find((sl) => sl.id === scope.slideId);
  return { value: slide?.transition, inherited, inheritedLabel, title: 'Slide Transition' };
}

export function setTransitionFor(target: TransitionTarget, t: SlideTransition | undefined) {
  const s = useStore.getState();
  if (target === 'global') s.updateSettings({ transition: t ?? DEFAULT_TRANSITION });
  else s.setTransition(target.presentationId, target.scope, t);
}

/** The picker for a slide, group, presentation or the global default, kept in step with the library. */
export function TargetTransitionPicker({ target }: { target: TransitionTarget }) {
  const state = useStore(useShallow((s) => transitionState(s, target)));
  return (
    <div className="tp-panel">
      <div className="pop-title">{state.title}</div>
      <TransitionPicker
        value={state.value}
        inherited={state.inherited}
        inheritedLabel={state.inheritedLabel}
        onChange={(t) => setTransitionFor(target, t)}
      />
    </div>
  );
}

/** A button showing a transition ("Push Left · 0.5s"); it opens the picker. */
export function TransitionButton({ target, className = '' }: { target: TransitionTarget; className?: string }) {
  const state = useStore(useShallow((s) => transitionState(s, target)));
  const shown = state.value ?? state.inherited ?? DEFAULT_TRANSITION;
  return (
    <button
      type="button"
      className={`btn transition-btn ${state.value ? '' : 'inherited'} ${className}`}
      title={state.value ? 'Change the transition' : `Following ${state.inheritedLabel}; click to change`}
      onClick={(e) => openPopupBelow(e.currentTarget, <TargetTransitionPicker target={target} />)}
    >
      <TransitionGlyph kind={shown.kind} size={16} />
      <span>{transitionLabel(shown)}</span>
    </button>
  );
}
