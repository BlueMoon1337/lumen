/**
 * Countdown videos: the walk-in timers played before a service. They have their own tab in the
 * media bin, and as one runs out, any music on the Audio layer (and the countdown's own sound)
 * fades away with it, so the service starts in silence.
 */

/** Seconds over which the sound fades at a countdown's end, unless Settings say otherwise. */
export const COUNTDOWN_FADE_SECONDS = 10;

/** A video named like a countdown ("Bloom_Countdown_4K", "Cuenta regresiva 5 min"). */
export const isCountdownName = (name: string) => /count[\s_-]*down|cuenta[\s_-]*regresiva|compte[\s_-]*(à|a)[\s_-]*rebours/i.test(name);

/** How loud sound is with `remaining` seconds of a countdown left: full until the fade, then down to nothing at the end. */
export function countdownVolume(remaining: number, fadeSeconds: number): number {
  if (!Number.isFinite(remaining) || fadeSeconds <= 0) return 1;
  return Math.max(0, Math.min(1, remaining / fadeSeconds));
}
