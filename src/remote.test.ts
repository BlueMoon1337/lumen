import { beforeEach, describe, expect, it } from 'vitest';
import { playForRemote, remoteStatus, startPlayerRemote } from './remote';
import { useStore } from './store';
import type { MediaItem } from './types';
import type { DesktopBridge } from './outputs';

const s = () => useStore.getState();
const video = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: id, kind: 'video', mime: 'video/mp4', ...extra });

beforeEach(() => {
  s().clearAll();
  useStore.setState({ media: [video('c1', { countdown: true }), video('c2', { countdown: true }), video('end', { name: 'Church Outro' })] });
  s().updateSettings({ outroMediaId: undefined, playerRemote: undefined });
});

describe('Lumen Remote (Player)', () => {
  it('tells Player what it can play', () => {
    expect(remoteStatus(s())).toEqual({ allowed: true, countdowns: 2, outro: null });
    s().markMedia('outro', 'end', true);
    expect(remoteStatus(s())).toEqual({ allowed: true, countdowns: 2, outro: 'Church Outro' });
    s().updateSettings({ playerRemote: false });
    expect(remoteStatus(s()).allowed).toBe(false);
  });

  it('plays a random countdown or the outro when Player asks, unless turned off', () => {
    playForRemote('random-countdown');
    expect(['c1', 'c2']).toContain(s().live.mediaId);
    s().markMedia('outro', 'end', true);
    playForRemote('outro');
    expect(s().live.mediaId).toBe('end');
    s().clearAll();
    s().updateSettings({ playerRemote: false });
    playForRemote('random-countdown');
    expect(s().live.mediaId).toBeNull();
    playForRemote('something else');
    expect(s().live.mediaId).toBeNull();
  });

  it('keeps the desktop app told as things change, and plays what it passes on', () => {
    const sent: unknown[] = [];
    let play: ((what: string) => void) | null = null;
    // Tests run in Node: a window with only what this uses.
    const g = globalThis as { window?: { lumenDesktop?: DesktopBridge } };
    const hadWindow = 'window' in g;
    g.window ??= {};
    g.window.lumenDesktop = {
      setRemoteStatus: (status: unknown) => sent.push(status),
      onRemotePlay: (cb: (what: string) => void) => ((play = cb), () => (play = null)),
    } as unknown as DesktopBridge;
    try {
      const stop = startPlayerRemote();
      expect(sent).toEqual([{ allowed: true, countdowns: 2, outro: null }]);
      s().markMedia('outro', 'end', true);
      s().setLiveMedia('c1'); // nothing Player is told about changes: no message
      expect(sent).toEqual([
        { allowed: true, countdowns: 2, outro: null },
        { allowed: true, countdowns: 2, outro: 'Church Outro' },
      ]);
      play!('outro');
      expect(s().live.mediaId).toBe('end');
      stop();
      expect(play).toBeNull();
    } finally {
      if (hadWindow) delete g.window!.lumenDesktop;
      else delete g.window;
    }
  });
});
