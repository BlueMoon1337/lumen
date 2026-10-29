import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shownTimer, shownVideoClock, timerRemaining } from './clock';
import { buildFrame } from './frame';
import { useStore } from './store';
import { formatDuration, parseDuration } from './util';

const titled = (title: string) => Object.values(useStore.getState().presentations).find((p) => p.title === title)!;

const playlistItem = (title: string) => {
  const s = useStore.getState();
  const id = titled(title).id;
  return s.playlists[0].items.find((it) => it.type === 'presentation' && it.presentationId === id)!;
};

describe('live control', () => {
  beforeEach(() => {
    const s = useStore.getState();
    s.clearAll();
    s.updateSettings({ advanceAcrossItems: true });
  });

  it('starts the selected presentation from the top', () => {
    const s = useStore.getState();
    s.select(titled('Amazing Grace').id);
    s.next();
    expect(useStore.getState().live.slide).toMatchObject({ presentationId: titled('Amazing Grace').id, index: 0 });
  });

  it('continues into the next playlist item after the last slide', () => {
    const s = useStore.getState();
    const holy = playlistItem('Holy, Holy, Holy');
    s.select(titled('Holy, Holy, Holy').id, holy.id);
    s.goLive(titled('Holy, Holy, Holy').id, 7, holy.id);
    s.next();
    const live = useStore.getState().live.slide!;
    expect(live.presentationId).toBe(titled('Amazing Grace').id);
    expect(live.index).toBe(0);
    expect(useStore.getState().selectedPresentationId).toBe(titled('Amazing Grace').id);

    useStore.getState().prev();
    expect(useStore.getState().live.slide).toMatchObject({ presentationId: titled('Holy, Holy, Holy').id, index: 7 });
  });

  it('stops at the end when continuing is turned off', () => {
    const s = useStore.getState();
    s.updateSettings({ advanceAcrossItems: false });
    const holy = playlistItem('Holy, Holy, Holy');
    s.select(titled('Holy, Holy, Holy').id, holy.id);
    s.goLive(titled('Holy, Holy, Holy').id, 7, holy.id);
    s.next();
    expect(useStore.getState().live.slide?.index).toBe(7);
  });

  it('jumps to groups by first letter', () => {
    const s = useStore.getState();
    const doxology = titled('Doxology');
    s.select(doxology.id);
    s.jumpToGroup('t');
    const frame = buildFrame(useStore.getState());
    expect(frame.stage.currentLabel).toBe('Doxology · Tag');
  });

  it('shows the next slide on the stage display, across items', () => {
    const s = useStore.getState();
    const holy = playlistItem('Holy, Holy, Holy');
    s.goLive(titled('Holy, Holy, Holy').id, 7, holy.id);
    const frame = buildFrame(useStore.getState());
    expect(frame.stage.nextLabel).toBe('Amazing Grace · Verse 1');
  });

  it('keeps the theme background under the slide unless media is live', () => {
    const s = useStore.getState();
    s.goLive(titled('Amazing Grace').id, 0);
    expect(buildFrame(useStore.getState()).background?.kind).toBe('gradient');
    s.setLiveMedia('m1');
    expect(buildFrame(useStore.getState()).background).toMatchObject({ kind: 'media', mediaId: 'm1' });
    s.clearSlide();
    s.clearMedia();
    expect(buildFrame(useStore.getState()).background).toBeNull();
  });

  it('clear all keeps the stage message', () => {
    const s = useStore.getState();
    s.setStageMessage('hi');
    s.goLive(titled('Amazing Grace').id, 0);
    s.clearAll();
    expect(useStore.getState().live).toMatchObject({ slide: null, stageMessage: 'hi' });
  });
});

describe('timer', () => {
  it('counts down and pauses', () => {
    const s = useStore.getState();
    s.setTimer({ mode: 'duration', durationMs: 60_000 });
    s.startTimer();
    const { endsAt, running } = useStore.getState().timer;
    expect(running).toBe(true);
    expect(endsAt! - Date.now()).toBeGreaterThan(59_000);
    s.pauseTimer();
    expect(useStore.getState().timer.remainingMs).toBeLessThanOrEqual(60_000);
    s.resetTimer();
    expect(useStore.getState().timer.remainingMs).toBe(60_000);
  });

  it('stops at 0:00, with no overtime, back at its length (and takes the music it was fading with it)', () => {
    vi.useFakeTimers();
    try {
      const s = useStore.getState();
      useStore.setState({ media: [{ id: 'song', name: 'Song', kind: 'audio', mime: 'audio/mpeg' }] });
      s.setTimer({ mode: 'duration', durationMs: 30_000 });
      s.startTimer();
      s.playAudio('song');
      vi.advanceTimersByTime(29_000);
      expect(timerRemaining(useStore.getState().timer, Date.now())).toBe(1_000);
      expect(timerRemaining(useStore.getState().timer, Date.now() + 5_000)).toBe(0);
      vi.advanceTimersByTime(1_000);
      expect(useStore.getState().timer).toMatchObject({ running: false, endsAt: null, remainingMs: 30_000 });
      expect(useStore.getState().live.audioId).toBeNull();
      // The stage shows 0:00 for five seconds, then no timer, until it's started or reset.
      expect(shownTimer(useStore.getState().timer, Date.now() + 4_900)).toBe(0);
      expect(shownTimer(useStore.getState().timer, Date.now() + 5_000)).toBeNull();
      s.resetTimer();
      expect(shownTimer(useStore.getState().timer, Date.now() + 5_000)).toBe(30_000);
      // Paused before the end, it doesn't stop by itself.
      s.startTimer();
      vi.advanceTimersByTime(10_000);
      s.pauseTimer();
      vi.advanceTimersByTime(60_000);
      expect(useStore.getState().timer).toMatchObject({ running: false, remainingMs: 20_000 });
      // Without Countdown Fade's Timer switch, the music plays on.
      s.updateSettings({ countdownFadeTimer: false });
      s.resetTimer();
      s.startTimer();
      s.playAudio('song');
      vi.advanceTimersByTime(30_000);
      expect(useStore.getState().timer.running).toBe(false);
      expect(useStore.getState().live.audioId).toBe('song');
    } finally {
      vi.useRealTimers();
    }
  });

  it('show a countdown video’s 0:00 on the stage for five seconds after it ends, then nothing', () => {
    const t = 1_000_000;
    expect(shownVideoClock({ endsAt: t + 4_200, remainingMs: null }, t)).toBe(4_200);
    expect(shownVideoClock({ endsAt: null, remainingMs: 9_000 }, t)).toBe(9_000);
    expect(shownVideoClock({ endsAt: null, remainingMs: 0, endedAt: t }, t + 4_900)).toBe(0);
    expect(shownVideoClock({ endsAt: null, remainingMs: 0, endedAt: t }, t + 5_000)).toBeNull();
    // Played again, it counts down again.
    expect(shownVideoClock({ endsAt: t + 60_000, remainingMs: null, endedAt: null }, t)).toBe(60_000);
    expect(shownVideoClock(undefined, t)).toBeNull();
  });

  it('formats and parses durations', () => {
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5_000)).toBe('-0:05');
    expect(parseDuration('5')).toBe(300_000);
    expect(parseDuration('2:30')).toBe(150_000);
    expect(parseDuration('abc')).toBeNull();
  });
});
