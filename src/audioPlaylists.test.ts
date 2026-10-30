import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installHistory, redo, undo } from './history';
import { AUDIO_LIBRARY, nextAudio, useStore } from './store';
import type { MediaItem } from './types';

const s = () => useStore.getState();
const track = (id: string): MediaItem => ({ id, name: `Track ${id}`, kind: 'audio', mime: 'audio/mpeg' });
const items = (id: string) => s().audioPlaylists.find((pl) => pl.id === id)?.items;

beforeEach(() => {
  s().clearAll();
  useStore.setState({
    media: [track('a'), track('b'), track('c'), { id: 'v', name: 'v', kind: 'video', mime: 'video/mp4' }],
    audioPlaylists: [],
  });
});

describe('audio playlists', () => {
  it('hold audio tracks in an order; adding one already there moves it', () => {
    const pl = s().createAudioPlaylist('Walk-in');
    s().addToAudioPlaylist(pl, ['a', 'b', 'v', 'a']);
    expect(items(pl)).toEqual(['a', 'b']);
    s().addToAudioPlaylist(pl, ['c'], 'a');
    expect(items(pl)).toEqual(['c', 'a', 'b']);
    s().addToAudioPlaylist(pl, ['b'], 'c');
    expect(items(pl)).toEqual(['b', 'c', 'a']);
    s().removeFromAudioPlaylist(pl, 'c');
    expect(items(pl)).toEqual(['b', 'a']);
    s().renameAudioPlaylist(pl, 'Offering');
    expect(s().audioPlaylists[0].name).toBe('Offering');
  });

  it('move up and down the list', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((n) => s().createAudioPlaylist(n));
    s().moveAudioPlaylists([c], a);
    expect(s().audioPlaylists.map((pl) => pl.name)).toEqual(['C', 'A', 'B']);
    s().moveAudioPlaylists([c], null);
    expect(s().audioPlaylists.map((pl) => pl.name)).toEqual(['A', 'B', 'C']);
    s().moveAudioPlaylists([a], c);
    expect(s().audioPlaylists.map((pl) => pl.id)).toEqual([b, a, c]);
  });

  it('loop only the track playing, until it stops or another plays', () => {
    s().loopAudio(true);
    expect(s().live.audioLoop).toBe(false);
    s().playAudio('a');
    s().loopAudio(true);
    expect(s().live.audioLoop).toBe(true);
    s().playAudio('b');
    expect(s().live.audioLoop).toBe(false);
    s().loopAudio(true);
    s().clearLayers(['audio']);
    expect(s().live.audioLoop).toBe(false);
  });

  it('play their tracks one after another, and start over if they loop', () => {
    const pl = s().createAudioPlaylist('Walk-in');
    s().addToAudioPlaylist(pl, ['a', 'b']);
    s().playAudio('a', pl);
    expect(s().live).toMatchObject({ audioId: 'a', audioFrom: pl });
    s().audioEnded();
    expect(s().live).toMatchObject({ audioId: 'b', audioFrom: pl });
    s().audioEnded();
    expect(s().live).toMatchObject({ audioId: null, audioFrom: null });
    s().updateAudioPlaylist(pl, { loop: true });
    expect(nextAudio(s(), 'b', pl)).toBe('a');
    s().playAudio('b', pl);
    s().audioEnded();
    expect(s().live.audioId).toBe('a');
  });

  it('don’t go on to another track when one was played on its own', () => {
    const pl = s().createAudioPlaylist('Walk-in');
    s().addToAudioPlaylist(pl, ['a', 'b']);
    s().playAudio('a');
    s().audioEnded();
    expect(s().live.audioId).toBeNull();
  });

  it('lose deleted tracks, and undo', () => {
    installHistory();
    const pl = s().createAudioPlaylist('Walk-in');
    s().addToAudioPlaylist(pl, ['a', 'b']);
    s().deleteMedia('a');
    expect(items(pl)).toEqual(['b']);
    undo();
    expect(items(pl)).toEqual(['a', 'b']);
    s().deleteAudioPlaylist(pl);
    expect(s().audioPlaylists).toEqual([]);
    undo();
    expect(items(pl)).toEqual(['a', 'b']);
    redo();
    expect(s().audioPlaylists).toEqual([]);
  });
});

describe('shuffle', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Plays from `from` until the Audio layer clears; the tracks it played. */
  const playThrough = (limit = 10) => {
    const out: string[] = [];
    while (s().live.audioId && out.length < limit) {
      out.push(s().live.audioId!);
      s().audioEnded();
    }
    return out;
  };

  it('plays a playlist’s tracks in a random order, each once, then stops (or goes round again if it loops)', () => {
    const pl = s().createAudioPlaylist('Walk-in');
    s().addToAudioPlaylist(pl, ['a', 'b', 'c']);
    s().updateAudioPlaylist(pl, { shuffle: true });
    for (let i = 0; i < 5; i++) {
      s().shuffleAudio(pl);
      expect(playThrough().sort()).toEqual(['a', 'b', 'c']);
    }
    s().updateAudioPlaylist(pl, { loop: true });
    s().shuffleAudio(pl);
    const many = playThrough(9);
    expect(many).toHaveLength(9);
    // No track twice in a row.
    expect(many.every((id, i) => i === 0 || id !== many[i - 1])).toBe(true);
    s().clearLayers(['audio']);
  });

  it('follows the random choice', () => {
    const pl = s().createAudioPlaylist('Walk-in');
    s().addToAudioPlaylist(pl, ['a', 'b', 'c']);
    s().updateAudioPlaylist(pl, { shuffle: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    s().shuffleAudio(pl);
    expect(s().live.audioId).toBe('c');
    expect(nextAudio(s(), 'c', pl, ['c'])).toBe('b');
  });

  it('shuffles the whole Audio Library', () => {
    s().shuffleAudio(AUDIO_LIBRARY);
    expect(s().live.audioFrom).toBe(AUDIO_LIBRARY);
    expect(playThrough().sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('a random countdown', () => {
  it('puts one of the countdown videos up, not the one already up', () => {
    useStore.setState({
      media: [
        { id: 'cd1', name: 'Countdown 1', kind: 'video', mime: 'video/mp4', countdown: true },
        { id: 'cd2', name: 'Countdown 2', kind: 'video', mime: 'video/mp4', countdown: true },
        { id: 'v', name: 'v', kind: 'video', mime: 'video/mp4' },
      ],
    });
    for (let i = 0; i < 6; i++) {
      const before = s().live.mediaId;
      s().playRandomCountdown();
      expect(['cd1', 'cd2']).toContain(s().live.mediaId);
      if (before) expect(s().live.mediaId).not.toBe(before);
    }
  });
});
