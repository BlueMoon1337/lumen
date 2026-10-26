import { beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from './frame';
import { ALL_LAYERS, clearGroupsOf, clearLive, DEFAULT_CLEAR_GROUPS, isLayerLive, LAYERS } from './layers';
import { useStore } from './store';

const s = () => useStore.getState();
const make = (text: string, extra = {}) => {
  const id = s().createPresentation({ title: 'P', themeId: 'theme-classic', ...extra }, text);
  return () => s().presentations[id];
};

describe('layers', () => {
  beforeEach(() => s().clearAll());

  it("are in ProPresenter's clear-column order, with the logo where Props would be", () => {
    expect(LAYERS.map((l) => l.label)).toEqual(['Audio', 'Messages', 'Logo', 'Announcements', 'Slide', 'Media', 'Video Input']);
  });

  it('clear one at a time, in groups, or all together', () => {
    const song = make('[V]\na\n\nb');
    const loop = make('[A]\nWelcome\n\nCoffee', { destination: 'announcements' });
    useStore.setState({ media: [{ id: 'm1', name: 'Song', kind: 'audio', mime: 'audio/mpeg' }] });
    s().goLive(song().id, 1);
    s().goLive(loop().id, 0);
    s().playAudio('m1');
    s().setLiveMedia('bg');
    s().setVideoInput({ deviceId: 'cam', label: 'Camera' });
    s().showMessage(s().messages[0].id);
    expect(ALL_LAYERS.filter((l) => isLayerLive(s().live, l))).toEqual([
      'audio',
      'messages',
      'announcements',
      'slide',
      'media',
      'videoInput',
    ]);

    s().clearLayers(DEFAULT_CLEAR_GROUPS[0].layers);
    expect(ALL_LAYERS.filter((l) => isLayerLive(s().live, l))).toEqual(['audio', 'media', 'videoInput']);
    s().clearLayers(['videoInput']);
    expect(s().live.videoInput).toBeNull();
    s().clearAll();
    expect(ALL_LAYERS.some((l) => isLayerLive(s().live, l))).toBe(false);
    expect(clearLive(s().live, ['audio'])).toEqual(s().live);
  });

  it('has clear groups the operator can replace', () => {
    expect(clearGroupsOf({}).map((g) => g.name)).toEqual(['Clear Text', 'Clear All but Audio', 'Clear Media & Audio']);
    expect(clearGroupsOf({}).find((g) => g.name === 'Clear All but Audio')?.layers).not.toContain('audio');
    const mine = [{ id: 'x', name: 'Mine', icon: 'close', color: '#fff', layers: ['slide' as const] }];
    expect(clearGroupsOf({ clearGroups: mine })).toBe(mine);
  });
});

describe('announcements', () => {
  beforeEach(() => s().clearAll());

  it('go to their own layer, over the slides, with their own background', () => {
    const song = make('[V]\na\n\nb');
    const loop = make('[A]\nWelcome\n\nCoffee', { destination: 'announcements' });
    s().goLive(song().id, 0);
    s().goLive(loop().id, 1);
    expect(s().live.slide).toMatchObject({ presentationId: song().id, index: 0 });
    expect(s().live.announcement).toMatchObject({ presentationId: loop().id, index: 1 });
    const frame = buildFrame(s());
    expect(frame.slide?.text).toBe('a');
    expect(frame.announcement).toMatchObject({ text: 'Coffee', key: `${loop().id}:1` });
    expect(frame.announcement?.background).toBeTruthy();
  });

  it('step with the arrow keys when their presentation is selected', () => {
    const song = make('[V]\na\n\nb');
    const loop = make('[A]\nWelcome\n\nCoffee\n\nKids', { destination: 'announcements' });
    s().goLive(song().id, 0);
    s().select(loop().id);
    s().next();
    s().next();
    expect(s().live.announcement?.index).toBe(1);
    expect(s().live.slide?.index).toBe(0);
    s().prev();
    expect(s().live.announcement?.index).toBe(0);
  });

  it('advance by themselves, looping after the last', () => {
    const loop = make('[A]\none\n\ntwo', { destination: 'announcements', autoAdvance: { seconds: 5, loop: true } });
    const once = make('[A]\none\n\ntwo', { autoAdvance: { seconds: 5, loop: false } });
    s().goLive(loop().id, 0);
    s().advanceLayer('announcement');
    expect(s().live.announcement?.index).toBe(1);
    s().advanceLayer('announcement');
    expect(s().live.announcement?.index).toBe(0);
    s().goLive(once().id, 1);
    s().advanceLayer('slide');
    expect(s().live.slide?.index).toBe(1);
  });
});

describe('audio and video input', () => {
  beforeEach(() => s().clearAll());

  it('plays audio, restarts it, and clears it when the file is deleted', () => {
    useStore.setState({ media: [{ id: 'a1', name: 'Hymn', kind: 'audio', mime: 'audio/mpeg' }] });
    s().playAudio('a1');
    const first = s().live.audioRestart;
    s().playAudio('a1');
    expect(s().live.audioRestart).toBe(first + 1);
    s().setAudioPaused(true);
    expect(s().live.audioPaused).toBe(true);
    s().deleteMedia('a1');
    expect(s().live.audioId).toBeNull();
  });

  it('puts a camera under everything, in place of slide backgrounds', () => {
    const song = make('[V]\na');
    s().goLive(song().id, 0);
    expect(buildFrame(s()).background).not.toBeNull();
    s().setVideoInput({ deviceId: 'cam-1', label: 'Camera' });
    const frame = buildFrame(s());
    expect(frame.videoInput).toEqual({ deviceId: 'cam-1' });
    expect(frame.background).toBeNull();
    // Media from the media bin still covers it.
    s().setLiveMedia('bg');
    expect(buildFrame(s()).background).toMatchObject({ kind: 'media', live: true });
  });
});
