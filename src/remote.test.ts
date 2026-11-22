import { beforeEach, describe, expect, it } from 'vitest';
import { playForRemote, remoteStatus, startPlayerRemote } from './remote';
import { useStore } from './store';
import type { MediaItem } from './types';
import type { DesktopBridge } from './outputs';

const s = () => useStore.getState();
const video = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: id, kind: 'video', mime: 'video/mp4', ...extra });

beforeEach(() => {
  s().clearAll();
  useStore.setState({
    media: [
      video('c1', { countdown: true }),
      video('c2', { countdown: true }),
      video('end', { name: 'Church Outro' }),
      { id: 'tune', name: 'Walk-in Song', kind: 'audio', mime: 'audio/mpeg' },
    ],
  });
  s().updateSettings({ outroMediaId: undefined, playerRemote: undefined });
});

describe('Lumen Remote (Player)', () => {
  it('tells Player what it can do, and why not', () => {
    expect(remoteStatus(s())).toEqual({
      allowed: true,
      countdowns: 2,
      outro: null,
      music: null,
      can: { 'random-countdown': null, outro: 'Lumen has no outro (Media ▸ Outro).', 'fade-music': 'No music is playing in Lumen.' },
    });
    s().markMedia('outro', 'end', true);
    s().playAudio('tune');
    expect(remoteStatus(s())).toMatchObject({ outro: 'Church Outro', music: 'Walk-in Song', can: { outro: null, 'fade-music': null } });
    s().updateSettings({ playerRemote: false });
    expect(remoteStatus(s()).allowed).toBe(false);
  });

  it('fades out the music when Player asks', () => {
    s().playAudio('tune');
    expect(s().live.audioId).toBe('tune');
    playForRemote({ what: 'fade-music', seconds: 3 });
    expect(s().live.audioId).toBeNull();
  });

  it('plays a random countdown or the outro when Player asks, unless turned off', () => {
    playForRemote({ what: 'random-countdown' });
    expect(['c1', 'c2']).toContain(s().live.mediaId);
    s().markMedia('outro', 'end', true);
    playForRemote({ what: 'outro' });
    expect(s().live.mediaId).toBe('end');
    s().clearAll();
    s().updateSettings({ playerRemote: false });
    playForRemote({ what: 'random-countdown' });
    expect(s().live.mediaId).toBeNull();
    playForRemote({ what: 'something else' });
    expect(s().live.mediaId).toBeNull();
  });

  it('keeps the desktop app told as things change, and plays what it passes on', () => {
    const sent: unknown[] = [];
    let play: ((r: { what: string }) => void) | null = null;
    // Tests run in Node: a window with only what this uses.
    const g = globalThis as { window?: { lumenDesktop?: DesktopBridge } };
    const hadWindow = 'window' in g;
    g.window ??= {};
    g.window.lumenDesktop = {
      setRemoteStatus: (status: unknown) => sent.push(status),
      onRemotePlay: (cb: (r: { what: string }) => void) => ((play = cb), () => (play = null)),
    } as unknown as DesktopBridge;
    try {
      const stop = startPlayerRemote();
      expect(sent).toHaveLength(1);
      s().markMedia('outro', 'end', true);
      s().setLiveMedia('c1'); // nothing Player is told about changes: no message
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({ outro: 'Church Outro', can: { outro: null } });
      play!({ what: 'outro' });
      expect(s().live.mediaId).toBe('end');
      stop();
      expect(play).toBeNull();
    } finally {
      if (hadWindow) delete g.window!.lumenDesktop;
      else delete g.window;
    }
  });
});
