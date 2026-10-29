import { beforeEach, describe, expect, it } from 'vitest';
import { countdownFade, countdownVolume, isCountdownName } from './countdowns';
import { buildFrame } from './frame';
import { useStore } from './store';

const s = () => useStore.getState();

beforeEach(() => {
  s().clearAll();
  useStore.setState({
    media: [
      { id: 'cd', name: 'Bloom_Countdown_4K', kind: 'video', mime: 'video/mp4', countdown: true, playback: 'stop' },
      { id: 'v', name: 'Waves', kind: 'video', mime: 'video/mp4' },
    ],
  });
});

describe('countdowns', () => {
  it('are recognised by their names, in English and Spanish', () => {
    expect(isCountdownName('Bloom_Countdown_4K')).toBe(true);
    expect(isCountdownName('5 Min Count-Down')).toBe(true);
    expect(isCountdownName('Cuenta Regresiva 10')).toBe(true);
    expect(isCountdownName('Worship Loop')).toBe(false);
  });

  it('take the sound down over their last seconds, to nothing at the end', () => {
    expect(countdownVolume(60, 10)).toBe(1);
    // Halfway, it's 10 dB down: it sounds half as loud. A quarter left, 20 dB: a quarter as loud.
    const db = (v: number) => 20 * Math.log10(v);
    expect(db(countdownVolume(5, 10))).toBeCloseTo(-10, 5);
    expect(db(countdownVolume(2.5, 10))).toBeCloseTo(-20, 5);
    expect(countdownVolume(9, 10)).toBeLessThan(0.9);
    expect(countdownVolume(0, 10)).toBe(0);
    expect(countdownVolume(-1, 10)).toBe(0);
    // No fade set: full volume.
    expect(countdownVolume(1, 0)).toBe(1);
  });

  it('fade their own sound on the screens, by the fade set in Settings', () => {
    s().setLiveMedia('cd', null);
    expect(buildFrame(s()).background).toMatchObject({ kind: 'media', mediaId: 'cd', fadeOut: 10 });
    s().updateSettings({ countdownFadeSeconds: 20 });
    expect(buildFrame(s()).background).toMatchObject({ fadeOut: 20 });
    // Other videos don't.
    s().setLiveMedia('v', null);
    expect(buildFrame(s()).background).not.toHaveProperty('fadeOut');
  });

  it('follow countdown videos and the timer unless turned off, from 10 seconds before the end', () => {
    expect(countdownFade({})).toEqual({ seconds: 10, videos: true, timer: true });
    expect(countdownFade({ countdownFadeSeconds: 30, countdownFadeTimer: false })).toEqual({ seconds: 30, videos: true, timer: false });
    s().updateSettings({ countdownFadeVideos: false });
    s().setLiveMedia('cd', null);
    expect(buildFrame(s()).background).not.toHaveProperty('fadeOut');
  });

  it('can be made (or unmade) from any video', () => {
    s().updateMedia('v', { countdown: true, playback: 'stop' });
    expect(s().media.find((m) => m.id === 'v')).toMatchObject({ countdown: true, playback: 'stop' });
  });
});
