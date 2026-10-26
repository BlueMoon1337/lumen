import { beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from './frame';
import { useStore } from './store';
import type { MediaItem } from './types';

const s = () => useStore.getState();
const media = (id: string, kind: MediaItem['kind'] = 'image'): MediaItem => ({
  id,
  name: id,
  kind,
  mime: kind === 'audio' ? 'audio/mpeg' : 'image/png',
});

beforeEach(() => {
  s().clearAll();
  useStore.setState({ media: [media('a'), media('song', 'audio'), media('b'), media('c')], mediaPlaylists: [], mediaFilter: 'all' });
  s().updateSettings({ logoMediaId: undefined });
});

describe('Clear to Logo', () => {
  it('clears every layer and shows the logo, when there is one', () => {
    const id = s().createPresentation({ title: 'Song' }, 'a\n\nb');
    s().goLive(id, 0);
    s().setLiveMedia('a');
    s().playAudio('song');
    s().clearToLogo();
    expect(s().live).toMatchObject({ slide: null, mediaId: null, audioId: null, logo: false });
    s().updateSettings({ logoMediaId: 'c' });
    s().goLive(id, 1);
    s().clearToLogo();
    expect(s().live).toMatchObject({ slide: null, logo: true });
  });
});

describe('Next and Previous Background', () => {
  it('step through the media bin, skipping audio, and stop at the ends', () => {
    s().stepMedia(1);
    expect(s().live.mediaId).toBe('a');
    s().stepMedia(1);
    expect(s().live.mediaId).toBe('b');
    s().stepMedia(1);
    s().stepMedia(1);
    expect(s().live.mediaId).toBe('c');
    s().stepMedia(-1);
    expect(s().live.mediaId).toBe('b');
  });

  it('stay in the media playlist the media was started from', () => {
    const pl = s().createMediaPlaylist('Loops');
    s().addToMediaPlaylist(pl, ['c', 'a']);
    s().setLiveMedia('c', pl);
    s().stepMedia(1);
    expect(s().live).toMatchObject({ mediaId: 'a', mediaFrom: pl });
    s().stepMedia(-1);
    expect(s().live.mediaId).toBe('c');
  });
});

describe('Show Slide on Stage Screens Only', () => {
  it('puts a slide on the stage screens alone, until the next slide goes live', () => {
    const id = s().createPresentation({ title: 'Song' }, '[Verse]\none\n\ntwo\n\nthree');
    s().goLive(id, 0);
    s().showOnStage(id, 1);
    const frame = buildFrame(s());
    expect(frame.slide?.text).toBe('one');
    expect(frame.stage).toMatchObject({ current: 'two', next: 'three' });
    s().goLive(id, 2);
    expect(buildFrame(s()).stage.current).toBe('three');
    s().showOnStage(id, 0);
    s().clearSlide();
    expect(buildFrame(s()).stage.current).toBeNull();
  });
});
