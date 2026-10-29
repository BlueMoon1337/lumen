import type { Settings } from './types';

/**
 * Countdown videos: the walk-in timers played before a service. They have their own tab in the
 * media bin, and as one runs out, any music on the Audio layer (and the countdown's own sound)
 * fades away with it, so the service starts in silence. The Timers tab's countdown can take the
 * music down the same way (Countdown Fade, in the Audio tab).
 */

/** Seconds over which the sound fades at a countdown's end, unless Settings say otherwise. */
export const COUNTDOWN_FADE_SECONDS = 10;

/** A video named like a countdown ("Bloom_Countdown_4K", "Cuenta regresiva 5 min"). */
export const isCountdownName = (name: string) => /count[\s_-]*down|cuenta[\s_-]*regresiva|compte[\s_-]*(à|a)[\s_-]*rebours/i.test(name);

/** Countdown Fade, as set in the Audio tab. */
export function countdownFade(settings: Pick<Settings, 'countdownFadeSeconds' | 'countdownFadeVideos' | 'countdownFadeTimer'>) {
  return {
    seconds: settings.countdownFadeSeconds ?? COUNTDOWN_FADE_SECONDS,
    videos: settings.countdownFadeVideos !== false,
    timer: settings.countdownFadeTimer !== false,
  };
}

/**
 * The fade's curve. Sound seems half as loud for every 10 dB it drops, so a volume of t^1.66
 * (t: the share of the fade left) sounds like it goes down evenly. Volume going down in a
 * straight line would sound like it hardly fades at first, then drops away at the end.
 */
const EVEN_LOUDNESS = 1 / (2 * Math.log10(2));

/** How loud sound is with `remaining` seconds of a countdown left: full until the fade, then down to nothing at the end. */
export function countdownVolume(remaining: number, fadeSeconds: number): number {
  if (!Number.isFinite(remaining) || fadeSeconds <= 0) return 1;
  return Math.max(0, Math.min(1, remaining / fadeSeconds)) ** EVEN_LOUDNESS;
}
