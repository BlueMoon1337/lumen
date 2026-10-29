import { beforeEach, describe, expect, it } from 'vitest';
import { installHistory, redo, undo } from './history';
import { nextAudio, useStore } from './store';
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
