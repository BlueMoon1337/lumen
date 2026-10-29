/**
 * Center guides for the slide editors, as ProPresenter has: a box being dragged snaps to the
 * middle of the slide when its own middle comes close, and a line shows while it's there.
 * Boxes and slides are in any one unit (pixels, or percent of the slide).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far off the middle still counts as on it, for showing a guide. */
const ON = 0.01;

/** Whether a box's middle is on the slide's middle, across (`x`, a vertical line) and down (`y`, a horizontal one). */
export function centered(box: Rect, slideW: number, slideH: number): { x: boolean; y: boolean } {
  return {
    x: Math.abs(box.x + box.w / 2 - slideW / 2) < ON * Math.max(1, slideW / 100),
    y: Math.abs(box.y + box.h / 2 - slideH / 2) < ON * Math.max(1, slideH / 100),
  };
}

/** A box moved onto the slide's middle where its own middle is within `tolerance` of it (per axis). */
export function snapToCenter(box: Rect, slideW: number, slideH: number, tolerance: { x: number; y: number }): Rect {
  const offX = slideW / 2 - (box.x + box.w / 2);
  const offY = slideH / 2 - (box.y + box.h / 2);
  return {
    ...box,
    x: Math.abs(offX) <= tolerance.x ? box.x + offX : box.x,
    y: Math.abs(offY) <= tolerance.y ? box.y + offY : box.y,
  };
}

/** A box put in the middle of the slide: across, down, or both. */
export function centerOn(box: Rect, slideW: number, slideH: number, axis: 'both' | 'x' | 'y' = 'both'): Rect {
  return {
    ...box,
    x: axis === 'y' ? box.x : (slideW - box.w) / 2,
    y: axis === 'x' ? box.y : (slideH - box.h) / 2,
  };
}

/** Screen pixels within which a dragged box snaps to the middle. */
export const SNAP_PX = 8;
