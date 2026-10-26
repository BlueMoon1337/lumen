import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { undoBatch } from '../history';
import type { SlideScope } from '../slideOps';
import { useStore } from '../store';
import {
  DEFAULT_TRANSITION,
  directionLabel,
  directionOf,
  directionsOf,
  DIRECTIONS,
  EASINGS,
  easingOf,
  mediaTransitionOf,
  sameTransition,
  TRANSITION_KINDS,
  transitionLabel,
  withChanges,
} from '../transitions';
import type { Presentation, Settings, SlideTransition, TransitionKind } from '../types';
import { Transition } from './Canvas';
import { openPopupBelow } from './ContextMenu';
import { confirmThen } from './Ask';
import { undoHint } from './deleting';

const GLYPHS: Record<TransitionKind, string> = {
  cut: 'M3 6h7v12H3zM14 6h7v12h-7z',
  dissolve: 'M3 4h12v10H3zM9 10h12v10H9z',
  fade: 'M3 6h18v12H3zM12 6v12M15 6v12M18 6v12',
  push: 'M2 6h9v12H2zM13 6h9v12h-9zM6 12h10M13 9l3 3-3 3',
  slide: 'M3 6h18v12H3zM10 6h11v12H10zM8 12H4M6 10l-2 2 2 2',
  reveal: 'M3 6h18v12H3zM3 6h8v12H3zM14 12h6M18 10l2 2-2 2',
  wipe: 'M3 6h18v12H3zM13 4v16M16 12h-8M11 9l-3 3 3 3',
  split: 'M3 6h18v12H3zM12 6v12M9 12H5M7 10l-2 2 2 2M15 12h4M17 10l2 2-2 2',
  iris: 'M3 6h18v12H3zM8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  zoom: 'M3 4h18v16H3zM8 8.5h8v7H8z',
  blur: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  flip: 'M12 3v18M4 6l5 1.5v9L4 18zM20 6l-5 1.5v9l5 1.5z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
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
      strokeLinecap="round"
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
  }, [ms, transition.kind, transition.direction, transition.easing]);
  return (
    <div className="tp-preview" aria-hidden>
      <Transition itemKey={flip ? 'b' : 'a'} duration={ms} effect={transition}>
        <MockSlide n={flip ? 2 : 1} />
      </Transition>
    </div>
  );
}

/**
 * Chooses a transition: its kind, direction, length and easing, with a preview that plays it.
 * With `inherited`, the transition can also be left to follow the one above it.
 */
export function TransitionPicker({
  value,
  inherited,
  inheritedLabel,
  onChange,
}: {
  /** This level's own transition; undefined follows `inherited`. */
  value: SlideTransition | undefined;
  inherited?: SlideTransition;
  inheritedLabel?: string;
  onChange: (t: SlideTransition | undefined) => void;
}) {
  const shown = value ?? inherited ?? DEFAULT_TRANSITION;
  const [hover, setHover] = useState<TransitionKind | null>(null);
  const set = (patch: Partial<SlideTransition>) => onChange(withChanges(shown, patch));
  const previewed = hover ? withChanges(shown, { kind: hover }) : shown;
  const directions = directionsOf(shown.kind);

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
      {directions.length > 0 && (
        <div className="tp-row">
          <span className="tp-row-label">Direction</span>
          <div className="seg">
            {directions.map((d) => (
              <button
                key={d}
                type="button"
                className={directionOf(shown) === d ? 'on' : ''}
                title={directionLabel(shown.kind, d)}
                aria-label={directionLabel(shown.kind, d)}
                onClick={() => set({ direction: d })}
              >
                {shown.kind === 'split' ? (d === 'up' ? '↕' : '↔') : DIRECTIONS.find((x) => x.value === d)?.arrow}
              </button>
            ))}
          </div>
        </div>
      )}
      {shown.kind !== 'cut' && (
        <>
          <label className="tp-row">
            <span className="tp-row-label">Duration</span>
            <input type="range" min={100} max={3000} step={50} value={shown.ms} onChange={(e) => set({ ms: Number(e.target.value) })} />
            <span className="tp-seconds">{(shown.ms / 1000).toFixed(2)}s</span>
          </label>
          <div className="tp-row">
            <span className="tp-row-label">Easing</span>
            <div className="seg tp-easing">
              {EASINGS.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  className={easingOf(shown) === e.value ? 'on' : ''}
                  onClick={() => set({ easing: e.value })}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Where a transition is set: a slide, a group's slides or a presentation, every slide (global), or media backgrounds. */
export type TransitionTarget = { presentationId: string; scope: SlideScope } | 'global' | 'media';

type LibraryState = { settings: Settings; presentations: Record<string, Presentation> };

/** What a level has, and what it falls back to. */
export function transitionState(
  s: LibraryState,
  target: TransitionTarget,
): { value?: SlideTransition; inherited?: SlideTransition; inheritedLabel?: string; title: string } {
  if (target === 'global') return { value: s.settings.transition, title: 'Global Slide Transition' };
  if (target === 'media') return { value: mediaTransitionOf(s.settings), title: 'Media Transition' };
  const p = s.presentations[target.presentationId];
  const global = s.settings.transition;
  const { scope } = target;
  if (!p) return { title: 'Transition' };
  if (scope === 'presentation')
    return { value: p.transition, inherited: global, inheritedLabel: 'the global transition', title: `Transition · ${p.title}` };
  const inherited = p.transition ?? global;
  const inheritedLabel = p.transition ? "the presentation's transition" : 'the global transition';
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
  else if (target === 'media') s.updateSettings({ mediaTransition: t });
  else s.setTransition(target.presentationId, target.scope, t);
}

// ---- One panel for every level ------------------------------------------------------------

type Level = 'slide' | 'group' | 'presentation' | 'global' | 'media';

const LEVEL_LABELS: Record<Level, string> = {
  slide: 'Slide',
  group: 'Group',
  presentation: 'Presentation',
  global: 'Global',
  media: 'Media',
};

/** The levels open from a slide, group, presentation or neither, and the one to show first. */
interface PanelContext {
  presentationId?: string;
  slideId?: string;
  groupId?: string;
  initial: Level;
}

function contextFor(target: TransitionTarget): PanelContext {
  if (target === 'global' || target === 'media')
    return { presentationId: useStore.getState().selectedPresentationId ?? undefined, initial: target };
  const { presentationId, scope } = target;
  if (scope === 'presentation') return { presentationId, initial: 'presentation' };
  if ('groupId' in scope) return { presentationId, groupId: scope.groupId, initial: 'group' };
  const p = useStore.getState().presentations[presentationId];
  const groupId = p?.groups.find((g) => g.slides.some((sl) => sl.id === scope.slideId))?.id;
  return { presentationId, slideId: scope.slideId, groupId, initial: 'slide' };
}

function targetFor(level: Level, ctx: PanelContext): TransitionTarget {
  if (level === 'global' || level === 'media' || !ctx.presentationId) return level === 'media' ? 'media' : 'global';
  if (level === 'slide' && ctx.slideId) return { presentationId: ctx.presentationId, scope: { slideId: ctx.slideId } };
  if (level === 'group' && ctx.groupId) return { presentationId: ctx.presentationId, scope: { groupId: ctx.groupId } };
  return { presentationId: ctx.presentationId, scope: 'presentation' };
}

/** What a level covers, in a sentence. */
function scopeNote(level: Level, p: Presentation | undefined, groupName: string | undefined): string {
  switch (level) {
    case 'slide':
      return 'Just this slide. A badge on its thumbnail shows it has its own.';
    case 'group':
      return `Every slide in “${groupName ?? 'this group'}”.`;
    case 'presentation':
      return `Every slide in “${p?.title ?? 'this presentation'}” that doesn’t have its own.`;
    case 'global':
      return 'Every slide of every presentation, unless the presentation or the slide has its own.';
    case 'media':
      return 'Backgrounds from the media bin, as they start, change and clear.';
  }
}

/**
 * Transitions for a slide, its group, its presentation, every presentation (global), or media
 * backgrounds, each on its own tab, with a preview and ways to apply one more widely.
 */
export function TransitionPanel(ctx: PanelContext) {
  const [level, setLevel] = useState<Level>(ctx.initial);
  const levels = (['slide', 'group', 'presentation', 'global', 'media'] as Level[]).filter(
    (l) => (l !== 'slide' || ctx.slideId) && (l !== 'group' || ctx.groupId) && (l !== 'presentation' || ctx.presentationId),
  );
  const target = targetFor(level, ctx);
  const state = useStore(useShallow((s) => transitionState(s, target)));
  const p = useStore((s) => (ctx.presentationId ? s.presentations[ctx.presentationId] : undefined));
  const groupName = p?.groups.find((g) => g.id === ctx.groupId)?.name;

  return (
    <div className="tp-panel">
      <div className="seg tp-levels" role="tablist" aria-label="Where the transition applies">
        {levels.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={l === level}
            className={l === level ? 'on' : ''}
            onClick={() => setLevel(l)}
          >
            {LEVEL_LABELS[l]}
          </button>
        ))}
      </div>
      <p className="tp-scope">{scopeNote(level, p, groupName)}</p>
      <TransitionPicker
        value={state.value}
        inherited={state.inherited}
        inheritedLabel={state.inheritedLabel}
        onChange={(t) => setTransitionFor(target, t)}
      />
      <LevelActions level={level} ctx={ctx} value={state.value} groupName={groupName} />
    </div>
  );
}

/** Applying a transition more widely, and clearing the ones that override it. */
function LevelActions({ level, ctx, value, groupName }: { level: Level; ctx: PanelContext; value?: SlideTransition; groupName?: string }) {
  const p = useStore((s) => (ctx.presentationId ? s.presentations[ctx.presentationId] : undefined));
  const overridingSlides = useStore((s) => {
    const pr = ctx.presentationId ? s.presentations[ctx.presentationId] : undefined;
    return pr ? pr.groups.reduce((n, g) => n + g.slides.filter((sl) => sl.transition).length, 0) : 0;
  });
  const overridingPresentations = useStore(
    (s) =>
      Object.values(s.presentations).filter(
        (pr) => !pr.hidden && (pr.transition || pr.groups.some((g) => g.slides.some((sl) => sl.transition))),
      ).length,
  );
  const s = useStore.getState();

  if (level === 'slide' && value && p)
    return (
      <div className="tp-actions">
        {ctx.groupId && (
          <button type="button" className="btn small" onClick={() => s.setTransition(p.id, { groupId: ctx.groupId! }, value)}>
            Use for All of “{groupName}”
          </button>
        )}
        <button
          type="button"
          className="btn small"
          title="Make this the presentation's transition, and clear slides' own"
          onClick={() =>
            undoBatch('Transition for Every Slide', () => {
              s.setTransition(p.id, 'presentation', value);
              s.clearSlideTransitions(p.id);
            })
          }
        >
          Use for Every Slide
        </button>
      </div>
    );
  if (level === 'presentation' && p && overridingSlides > 0)
    return (
      <div className="tp-actions">
        <span className="muted">
          {overridingSlides} slide{overridingSlides === 1 ? ' has its' : 's have their'} own transition.
        </span>
        <button type="button" className="btn small" onClick={() => s.clearSlideTransitions(p.id)}>
          Clear {overridingSlides === 1 ? 'It' : 'Them'}
        </button>
      </div>
    );
  if (level === 'global' && overridingPresentations > 0)
    return (
      <div className="tp-actions">
        <span className="muted">
          {overridingPresentations} presentation{overridingPresentations === 1 ? ' has' : 's have'}{' '}
          {overridingPresentations === 1 ? 'its' : 'their'} own transitions.
        </span>
        <button
          type="button"
          className="btn small"
          title="Every presentation and slide uses the global transition"
          onClick={() =>
            confirmThen(
              {
                title: 'Use the global transition for every presentation and slide?',
                message: `Their own transitions are cleared. ${undoHint()}`,
                confirmLabel: 'Use Global',
              },
              () => s.clearPresentationTransitions(),
            )
          }
        >
          Use Global Everywhere
        </button>
      </div>
    );
  return null;
}

/** The transition panel for a slide, group, presentation, global or media, opened on that tab. */
export function TargetTransitionPicker({ target }: { target: TransitionTarget }) {
  const [ctx] = useState(() => contextFor(target));
  return <TransitionPanel {...ctx} />;
}

/** A button showing a transition ("Push Left · 0.5s"); it opens the panel on that level. */
export function TransitionButton({
  target,
  className = '',
  prefix,
}: {
  target: TransitionTarget;
  className?: string;
  /** Says which level it is, e.g. "Global". */
  prefix?: string;
}) {
  const state = useStore(useShallow((s) => transitionState(s, target)));
  const shown = state.value ?? state.inherited ?? DEFAULT_TRANSITION;
  return (
    <button
      type="button"
      className={`btn transition-btn ${state.value ? '' : 'inherited'} ${className}`}
      title={state.value ? `${state.title}: click to change` : `Following ${state.inheritedLabel}; click to change`}
      onClick={(e) => openPopupBelow(e.currentTarget, <TargetTransitionPicker target={target} />)}
    >
      <TransitionGlyph kind={shown.kind} size={16} />
      {prefix && <span className="transition-btn-prefix">{prefix}</span>}
      <span>{transitionLabel(shown)}</span>
    </button>
  );
}
