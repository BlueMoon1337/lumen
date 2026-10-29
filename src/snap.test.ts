import { describe, expect, it } from 'vitest';
import { centered, centerOn, snapToCenter } from './snap';

describe('center guides', () => {
  it('snap a box being moved to the middle of the slide when its middle comes close', () => {
    const box = { x: 900, y: 300, w: 1927, h: 360 };
    // 3.5 off across, 60 off down: it snaps across only.
    const snapped = snapToCenter({ ...box, x: -3.5 + 7 }, 1920, 1080, { x: 10, y: 10 });
    expect(snapped.x).toBeCloseTo(-3.5);
    expect(snapped.y).toBe(300);
    expect(centered(snapped, 1920, 1080)).toEqual({ x: true, y: false });
    const both = snapToCenter({ ...box, x: -1, y: 355 }, 1920, 1080, { x: 10, y: 10 });
    expect(centered(both, 1920, 1080)).toEqual({ x: true, y: true });
    // Far off, it stays put.
    expect(snapToCenter({ ...box, y: 500 }, 1920, 1080, { x: 0, y: 10 })).toMatchObject({ x: 900, y: 500 });
  });

  it('center a box across, down, or both, keeping its size', () => {
    const box = { x: 10, y: 20, w: 40, h: 10 };
    expect(centerOn(box, 100, 100)).toEqual({ x: 30, y: 45, w: 40, h: 10 });
    expect(centerOn(box, 100, 100, 'x')).toEqual({ x: 30, y: 20, w: 40, h: 10 });
    expect(centerOn(box, 100, 100, 'y')).toEqual({ x: 10, y: 45, w: 40, h: 10 });
  });
});
