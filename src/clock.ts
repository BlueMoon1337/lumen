import { useEffect, useState } from 'react';
import type { TimerState } from './types';

/** Re-renders every `ms` so clocks and countdowns stay current. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function timerRemaining(t: TimerState, now: number): number {
  return t.running && t.endsAt != null ? t.endsAt - now : t.remainingMs;
}
