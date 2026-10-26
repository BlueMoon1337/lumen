import type { KeyboardEvent, PointerEvent } from 'react';
import { useStore } from '../store';
import type { PaneSizes } from '../types';

export const DEFAULT_PANES: Omit<PaneSizes, 'liveTop'> = { side: 290, live: 340, media: 250, outline: 240, inspector: 360 };

/** Saves one pane's size; `undefined` goes back to the default. */
export function setPaneSize(key: keyof PaneSizes, size: number | undefined) {
  const s = useStore.getState();
  const panes = { ...s.settings.panes };
  if (size === undefined) delete panes[key];
  else panes[key] = Math.round(size);
  s.updateSettings({ panes });
}

/**
 * A draggable divider between two panes, as in ProPresenter. While dragging, `apply` shows
 * the new size straight away (without re-rendering the app); letting go saves it. Double-click
 * puts the default back; with the divider focused, the arrow keys nudge it.
 */
export function Splitter({
  axis,
  label,
  className = '',
  invert = false,
  measure,
  min,
  max,
  apply,
  commit,
  reset,
}: {
  /** "x": a vertical divider dragged left and right. "y": a horizontal one dragged up and down. */
  axis: 'x' | 'y';
  label: string;
  className?: string;
  /** The pane grows when the divider moves left or up (a pane on the right or at the bottom). */
  invert?: boolean;
  /** The pane's size now, in px. */
  measure: () => number;
  min: number;
  max: () => number;
  apply: (size: number) => void;
  commit: (size: number) => void;
  reset: () => void;
}) {
  const clamp = (size: number) => Math.max(min, Math.min(Math.max(min, max()), size));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const origin = axis === 'x' ? e.clientX : e.clientY;
    const start = measure();
    let size = start;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add(`resizing-${axis}`);
    const move = (ev: globalThis.PointerEvent) => {
      const delta = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
      size = clamp(start + (invert ? -delta : delta));
      apply(size);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove(`resizing-${axis}`);
      if (size !== start) commit(size);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const i = keys.indexOf(e.key);
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const step = (i === 0 ? -1 : 1) * (e.shiftKey ? 50 : 10) * (invert ? -1 : 1);
    commit(clamp(measure() + step));
  };

  return (
    <div
      className={`splitter splitter-${axis} ${className}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label}: drag to resize, double-click to reset`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
}
