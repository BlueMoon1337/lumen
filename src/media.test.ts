import { beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from './frame';
import { removeFromTab } from './components/deleting';
import { isBackgroundName, isLogoName, isOutroName } from './countdowns';
import { mimeFromName, moveBefore, nextMedia, useStore } from './store';
import type { MediaItem } from './types';

const s = () => useStore.getState();
const video = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: id, kind: 'video', mime: 'video/mp4', ...extra });

beforeEach(() => {
  s().clearAll();
  useStore.setState({
    media: [video('v1'), video('v2', { playback: 'stop' }), { id: 'i1', name: 'i1', kind: 'image', mime: 'image/png' }, video('v3')],
    mediaPlaylists: [],
  });
});

describe('importing', () => {
  it('knows video files by their name when the system gives no type', () => {
    expect(mimeFromName('Countdown.MP4')).toBe('video/mp4');
    expect(mimeFromName('intro.mov')).toBe('video/quicktime');
    expect(mimeFromName('notes.txt')).toBe('');
  });
});

describe('the live video', () => {
  it('loops unless told otherwise, and the outputs follow seeks', () => {
    s().setLiveMedia('v1');
    expect(buildFrame(s()).background).toMatchObject({ kind: 'media', live: true, loop: true, seek: { n: 0 } });
    s().seekMedia(42);
    expect(buildFrame(s()).background).toMatchObject({ seek: { to: 42, n: 1 } });
    s().setLiveMedia('v2');
    expect(buildFrame(s()).background).toMatchObject({ mediaId: 'v2', loop: false });
  });

  it('stops, clears or plays the next one when it ends', () => {
    s().setLiveMedia('v2');
    s().mediaEnded();
    expect(s().live.mediaId).toBe('v2');

    s().updateMedia('v1', { playback: 'clear' });
    s().setLiveMedia('v1');
    s().mediaEnded();
    expect(s().live.mediaId).toBeNull();

    // "Next" goes through the media bin, skipping audio, and clears after the last.
    s().updateMedia('v1', { playback: 'next' });
    s().setLiveMedia('v1');
    s().mediaEnded();
    expect(s().live.mediaId).toBe('v2');
    s().updateMedia('v3', { playback: 'next' });
    s().setLiveMedia('v3');
    s().mediaEnded();
    expect(s().live.mediaId).toBeNull();
  });

  it('plays the next one in the media playlist it was started from', () => {
    const pl = s().createMediaPlaylist('Pre-service');
    s().addToMediaPlaylist(pl, ['v3', 'v1']);
    expect(nextMedia(s(), 'v3', pl)).toBe('v1');
    expect(nextMedia(s(), 'v3', null)).toBeNull();
    s().updateMedia('v3', { playback: 'next' });
    s().setLiveMedia('v3', pl);
    s().mediaEnded();
    expect(s().live).toMatchObject({ mediaId: 'v1', mediaFrom: pl });
  });
});

describe('media playlists', () => {
  it('hold media in order once each, and lose deleted media', () => {
    const pl = s().createMediaPlaylist('Loops');
    s().addToMediaPlaylist(pl, ['v1', 'i1']);
    s().addToMediaPlaylist(pl, ['v1', 'v3']);
    expect(s().mediaPlaylists[0].items).toEqual(['v1', 'i1', 'v3']);
    s().removeFromMediaPlaylist(pl, 'i1');
    s().deleteMedia('v3');
    expect(s().mediaPlaylists[0].items).toEqual(['v1']);
    s().renameMediaPlaylist(pl, 'Backgrounds');
    s().deleteMediaPlaylist(pl);
    expect(s().mediaPlaylists).toEqual([]);
  });
});

describe('media cues on slides', () => {
  const make = () => {
    const id = s().createPresentation({ title: 'Video song' }, '[V]\na\n\nb\n\nc');
    return () => s().presentations[id];
  };

  it('start their media when the slide is shown, without restarting it', () => {
    const get = make();
    const [a, b] = get().groups[0].slides;
    s().updateSlide(get().id, a.id, { media: 'v1' });
    s().updateSlide(get().id, b.id, { media: 'v1' });
    s().goLive(get().id, 0);
    expect(s().live.mediaId).toBe('v1');
    s().seekMedia(30);
    const seek = s().live.mediaSeek;
    s().goLive(get().id, 1);
    // Still the same play-through: no new seek, no restart.
    expect(s().live.mediaSeek).toBe(seek);
    // A slide without a cue leaves the media playing.
    s().goLive(get().id, 2);
    expect(s().live.mediaId).toBe('v1');
  });

  it('survive reflowing the words, and go when their media is deleted', () => {
    const get = make();
    const a = get().groups[0].slides[0];
    s().updateSlide(get().id, a.id, { media: 'v1', label: { name: 'Prayer', color: '#7c5cd6' }, transition: { kind: 'cut', ms: 0 } });
    s().setPresentationText(get().id, '[V]\nA changed\n\nb\n\nc');
    expect(get().groups[0].slides[0]).toMatchObject({
      text: 'A changed',
      media: 'v1',
      label: { name: 'Prayer' },
      transition: { kind: 'cut' },
    });
    s().deleteMedia('v1');
    expect(get().groups[0].slides[0].media).toBeUndefined();
  });
});

describe('reordering', () => {
  it('moves media in the bin, and in a playlist, by dragging one onto another', () => {
    const ids = () => s().media.map((m) => m.id);
    s().moveMedia(['v3'], 'v1');
    expect(ids()).toEqual(['v3', 'v1', 'v2', 'i1']);
    s().moveMedia(['v3'], null);
    expect(ids()).toEqual(['v1', 'v2', 'i1', 'v3']);
    // Onto itself: nothing changes.
    s().moveMedia(['v1'], 'v1');
    expect(ids()).toEqual(['v1', 'v2', 'i1', 'v3']);
    const pl = s().createMediaPlaylist('Walk-in');
    s().addToMediaPlaylist(pl, ['v1', 'v2', 'v3']);
    s().moveInMediaPlaylist(pl, ['v3'], 'v1');
    expect(s().mediaPlaylists[0].items).toEqual(['v3', 'v1', 'v2']);
    expect(ids()).toEqual(['v1', 'v2', 'i1', 'v3']);
    expect(moveBefore(['a', 'b', 'c'], (x) => x, ['a', 'b'], null)).toEqual(['c', 'a', 'b']);
    expect(moveBefore(['a', 'b', 'c'], (x) => x, ['z'], 'a')).toEqual(['a', 'b', 'c']);
  });
});

describe('outros', () => {
  it('have one active outro, which Play Outro puts on the Media layer', () => {
    s().updateSettings({ outroMediaId: undefined });
    s().playOutro();
    expect(s().live.mediaId).toBeNull();
    // The first video made an outro becomes the active one; it holds its last frame.
    s().markMedia('outro', 'v1', true);
    expect(s().media.find((m) => m.id === 'v1')).toMatchObject({ outro: true, playback: 'stop' });
    expect(s().settings.outroMediaId).toBe('v1');
    s().markMedia('outro', 'v3', true);
    expect(s().settings.outroMediaId).toBe('v1');
    // Choosing another as the active one.
    s().setActiveMedia('outro', 'v3');
    expect(s().settings.outroMediaId).toBe('v3');
    s().playOutro();
    expect(s().live.mediaId).toBe('v3');
    // Again while it plays: from the start.
    const restarts = s().live.mediaRestart;
    s().playOutro();
    expect(s().live.mediaRestart).toBe(restarts + 1);
    // No longer an outro, or deleted: no active outro.
    s().markMedia('outro', 'v3', false);
    expect(s().settings.outroMediaId).toBeUndefined();
    s().setActiveMedia('outro', 'v1');
    s().deleteMedia('v1');
    expect(s().settings.outroMediaId).toBeUndefined();
  });

  it('leave the media bin alone when removed from the Countdowns or Outro tab', () => {
    s().setActiveMedia('outro', 'v1');
    s().updateMedia('v2', { countdown: true });
    removeFromTab(
      s().media.find((m) => m.id === 'v1')!,
      'outro',
    );
    removeFromTab(
      s().media.find((m) => m.id === 'v2')!,
      'countdown',
    );
    expect(s().media.map((m) => m.id)).toEqual(['v1', 'v2', 'i1', 'v3']);
    expect(s().media.find((m) => m.id === 'v1')?.outro).toBeFalsy();
    expect(s().media.find((m) => m.id === 'v2')?.countdown).toBe(false);
    expect(s().settings.outroMediaId).toBeUndefined();
  });

  it('are known by their names', () => {
    expect(isOutroName('Church Outro 4K')).toBe(true);
    expect(isOutroName('Despedida')).toBe(true);
    expect(isOutroName('Paint Sweeps Gold')).toBe(false);
  });
});

describe('logos', () => {
  it('work as outros do: a Logo tab, one active logo, and the Logo button shows it', () => {
    s().updateSettings({ logoMediaId: undefined });
    // An image becomes a logo; the first is the active one, on the Logo layer when it's turned on.
    s().markMedia('logo', 'i1', true);
    expect(s().media.find((m) => m.id === 'i1')?.logo).toBe(true);
    expect(s().settings.logoMediaId).toBe('i1');
    s().toggleLogo();
    expect(buildFrame(s()).logoMediaId).toBe('i1');
    // Another as the active one (a video can be a logo too; it keeps looping).
    s().setActiveMedia('logo', 'v2');
    expect(s().media.find((m) => m.id === 'v2')).toMatchObject({ logo: true, playback: 'stop' });
    expect(buildFrame(s()).logoMediaId).toBe('v2');
    // Out of the Logo tab: it stays in the media bin, and isn't the logo any more.
    removeFromTab(
      s().media.find((m) => m.id === 'v2')!,
      'logo',
    );
    expect(s().media.some((m) => m.id === 'v2')).toBe(true);
    expect(s().settings.logoMediaId).toBeUndefined();
    expect(isLogoName('Church Logo White')).toBe(true);
    // The Logo button clears the words and the background as it shows the logo; music and messages stay.
    s().setActiveMedia('logo', 'i1');
    if (s().live.logo) s().toggleLogo();
    const song = s().createPresentation({ title: 'Song' }, 'Amazing grace');
    s().goLive(song, 0);
    s().setLiveMedia('v1');
    s().showMessage(s().messages[0].id);
    s().pressLogo();
    expect(s().live).toMatchObject({ logo: true, slide: null, mediaId: null, messageId: s().messages[0].id });
    s().pressLogo();
    expect(s().live.logo).toBe(false);
    // Showing a slide, or putting media up, takes the logo down too.
    s().pressLogo();
    s().goLive(song, 0);
    expect(s().live.logo).toBe(false);
    s().pressLogo();
    s().setLiveMedia('v3');
    expect(s().live).toMatchObject({ logo: false, mediaId: 'v3' });
  });
});

describe('a theme that keeps its background', () => {
  it('stays over media from the Media bin, which plays on underneath', () => {
    const id = s().createPresentation({ title: 'Scripture' }, 'For God so loved the world');
    const p = s().presentations[id];
    const theme = s().themes.find((t) => t.id === p.themeId) ?? s().themes[0];
    s().updateTheme(theme.id, { background: { type: 'color', color: '#000000', color2: '#000000' } });
    s().select(id);
    s().goLive(id, 0);
    s().setLiveMedia('v1');
    // By default the media replaces it.
    expect(buildFrame(s()).background).toMatchObject({ kind: 'media', mediaId: 'v1' });
    expect(buildFrame(s()).cover).toBeNull();
    s().updateTheme(theme.id, { keepBackground: true });
    expect(buildFrame(s()).background).toMatchObject({ kind: 'media', mediaId: 'v1' });
    expect(buildFrame(s()).cover).toMatchObject({ kind: 'color', color: '#000000' });
    // No media: just the background, as ever.
    s().setLiveMedia(null);
    expect(buildFrame(s()).cover).toBeNull();
    expect(buildFrame(s()).background).toMatchObject({ kind: 'color' });
  });
});

describe('after the outro', () => {
  it('shows the logo and plays the chosen audio playlist when Settings say so', () => {
    useStore.setState({ media: [...s().media, { id: 'song', name: 'Song', kind: 'audio', mime: 'audio/mpeg' }], audioPlaylists: [] });
    s().setActiveMedia('outro', 'v1');
    s().setActiveMedia('logo', 'i1');
    const pl = s().createAudioPlaylist('After service');
    s().addToAudioPlaylist(pl, ['song']);
    const song = s().createPresentation({ title: 'Song' }, 'Amazing grace');
    // Off (the default): the outro just holds its last frame.
    s().goLive(song, 0);
    s().setLiveMedia('v1');
    s().mediaEnded();
    expect(s().live).toMatchObject({ mediaId: 'v1', logo: false, audioId: null });
    // On: the logo comes up, the words and background go, and the playlist plays.
    s().updateSettings({ logoAfterOutro: true, outroPlaylistId: pl });
    s().mediaEnded();
    expect(s().live).toMatchObject({ mediaId: null, slide: null, logo: true, audioId: 'song', audioFrom: pl });
    // Another video ending doesn't.
    s().pressLogo();
    s().clearLayers(['audio']);
    s().setLiveMedia('v3');
    s().mediaEnded();
    expect(s().live).toMatchObject({ logo: false, audioId: null });
  });
});

describe('backgrounds', () => {
  it('have their own tab, which removing from leaves the media bin alone', () => {
    s().updateMedia('i1', { background: true });
    s().updateMedia('v2', { background: true });
    expect(
      s()
        .media.filter((m) => m.background)
        .map((m) => m.id),
    ).toEqual(['v2', 'i1']);
    removeFromTab(
      s().media.find((m) => m.id === 'v2')!,
      'background',
    );
    expect(s().media.find((m) => m.id === 'v2')?.background).toBe(false);
    expect(s().media.some((m) => m.id === 'v2')).toBe(true);
    expect(isBackgroundName('Worship Background 4K')).toBe(true);
    expect(isBackgroundName('Fondo Azul')).toBe(true);
    expect(isBackgroundName('Paint Sweeps')).toBe(false);
  });
});

describe('the media bin’s own tabs, by hand', () => {
  it('take items in and out, whatever their names', () => {
    s().updateSettings({ outroMediaId: undefined, logoMediaId: undefined });
    s().setInTab('background', ['i1', 'v1'], true);
    s().setInTab('countdown', ['v2'], true);
    s().setInTab('outro', ['v3'], true);
    s().setInTab('logo', ['i1'], true);
    const inTab = (k: 'background' | 'countdown' | 'outro' | 'logo') =>
      s()
        .media.filter((m) => m[k])
        .map((m) => m.id);
    expect(inTab('background')).toEqual(['v1', 'i1']);
    expect(inTab('countdown')).toEqual(['v2']);
    expect(inTab('outro')).toEqual(['v3']);
    expect(inTab('logo')).toEqual(['i1']);
    // The first outro and logo become the active ones.
    expect(s().settings).toMatchObject({ outroMediaId: 'v3', logoMediaId: 'i1' });
    // Countdowns and outros are videos: an image isn't added.
    s().setInTab('countdown', ['i1'], true);
    expect(inTab('countdown')).toEqual(['v2']);
    // Out again: they stay in the media bin.
    s().setInTab('background', ['v1'], false);
    s().setInTab('outro', ['v3'], false);
    expect(inTab('background')).toEqual(['i1']);
    expect(inTab('outro')).toEqual([]);
    expect(s().settings.outroMediaId).toBeUndefined();
    expect(s().media).toHaveLength(4);
  });
});

describe('an outro starting', () => {
  it('stops the music; other videos leave it playing', () => {
    useStore.setState({ media: [...s().media, { id: 'song', name: 'Song', kind: 'audio', mime: 'audio/mpeg' }] });
    s().markMedia('outro', 'v1', true);
    s().playAudio('song');
    s().setLiveMedia('v3');
    expect(s().live.audioId).toBe('song');
    s().setLiveMedia('v1');
    expect(s().live).toMatchObject({ mediaId: 'v1', audioId: null });
    // Play Outro does the same.
    s().setLiveMedia(null);
    s().playAudio('song');
    s().setActiveMedia('outro', 'v1');
    s().playOutro();
    expect(s().live).toMatchObject({ mediaId: 'v1', audioId: null });
  });
});
