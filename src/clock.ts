import { useEffect, useState } from 'react';
import type { TimerState, VideoClock } from './types';

/** Re-renders every `ms` so clocks and countdowns stay current. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** How long the stage shows 0:00 after a countdown (the timer or a video) runs out, before it goes. */
export const ENDED_HOLD_MS = 5000;

/** A countdown that ran out at `endedAt`: 0:00 for ENDED_HOLD_MS, then null (nothing to show). */
const afterEnd = (endedAt: number, now: number) => (now - endedAt < ENDED_HOLD_MS ? 0 : null);

/**
 * The Timers tab's countdown as the screens show it: when it has run out, 0:00 for a few seconds
 * and then null (no timer), until it's started or reset.
 */
export function shownTimer(t: TimerState, now: number): number | null {
  if (!t.running && t.endedAt != null) return afterEnd(t.endedAt, now);
  return timerRemaining(t, now);
}

/** Time left in the live video, for the stage: 0:00 for a few seconds after it ends, then null. */
export function shownVideoClock(clock: VideoClock | undefined, now: number): number | null {
  if (!clock) return null;
  if (clock.endedAt != null && clock.endsAt == null) return afterEnd(clock.endedAt, now);
  const left = clock.endsAt != null ? clock.endsAt - now : clock.remainingMs;
  return left == null ? null : Math.max(0, left);
}

/** Time left on the Timers tab's countdown. It stops at 0:00 (there's no overtime). */
export function timerRemaining(t: TimerState, now: number): number {
  return Math.max(0, t.running && t.endsAt != null ? t.endsAt - now : t.remainingMs);
}
