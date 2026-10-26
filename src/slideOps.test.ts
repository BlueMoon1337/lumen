import { beforeEach, describe, expect, it } from 'vitest';
import { buildFrame } from './frame';
import { DEFAULT_GROUPS, groupPresets } from './labels';
import { getSequence, parseLyrics } from './lyrics';
import { assignGroup, clearTextStyle, deleteGroup, duplicateGroup, insertSlides, pasteTextStyle, setTransition } from './slideOps';
import { upgradeTransitions, useStore, type LibraryData } from './store';
import {
  easingOf,
  effectiveTransition,
  fromMs,
  sameTransition,
  TRANSITION_KINDS,
  transitionFromPro,
  transitionLabel,
  withChanges,
} from './transitions';
import type { Presentation } from './types';

const pres = (text: string, extra: Partial<Presentation> = {}): Presentation => ({
  id: 'p',
  title: 'Song',
  category: 'song',
  updatedAt: 0,
  ...parseLyrics(text),
  ...extra,
});

const names = (p: Pick<Presentation, 'groups' | 'arrangement'>) =>
  getSequence({ ...pres(''), ...p }).map((e) => `${e.group.name}:${e.slide.text}`);

describe('assigning groups', () => {
  const chorus = { name: 'Chorus', color: '#d9485f' };

  it('splits a group at the slide, taking the slides after it along', () => {
    const p = pres('[Verse 1]\na\n\nb\n\nc\n\n[Bridge]\nd');
    const b = p.groups[0].slides[1].id;
    const next = assignGroup(p, b, chorus);
    expect(next.groups.map((g) => [g.name, g.color, g.slides.map((s) => s.text).join('')])).toEqual([
      ['Verse 1', '#3b82f6', 'a'],
      ['Chorus', '#d9485f', 'bc'],
      ['Bridge', '#9b5de5', 'd'],
    ]);
    expect(names(next)).toEqual(['Verse 1:a', 'Chorus:b', 'Chorus:c', 'Bridge:d']);
    // The slides keep their ids (and so their formatting).
    expect(next.groups[1].slides[0].id).toBe(b);
  });

  it('follows the old group wherever the arrangement repeats it', () => {
    const p = pres('[Verse 1]\na\n\nb\n\n[Bridge]\nd\n\n[Verse 1]');
    expect(names(p)).toEqual(['Verse 1:a', 'Verse 1:b', 'Bridge:d', 'Verse 1:a', 'Verse 1:b']);
    const next = assignGroup(p, p.groups[0].slides[1].id, chorus);
    expect(names(next)).toEqual(['Verse 1:a', 'Chorus:b', 'Bridge:d', 'Verse 1:a', 'Chorus:b']);
  });

  it('renames and recolors a group when given its first slide', () => {
    const p = pres('[Verse 1]\na\n\nb');
    const next = assignGroup(p, p.groups[0].slides[0].id, chorus);
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0]).toMatchObject({ id: p.groups[0].id, name: 'Chorus', color: '#d9485f' });
  });

  it('deletes and duplicates groups with the arrangement', () => {
    const p = pres('[Verse 1]\na\n\n[Chorus]\nc\n\n[Verse 1]');
    expect(names(deleteGroup(p, p.groups[0].id))).toEqual(['Chorus:c']);
    const dup = duplicateGroup(p, p.groups[1].id);
    expect(names(dup)).toEqual(['Verse 1:a', 'Chorus:c', 'Chorus:c', 'Verse 1:a']);
    expect(dup.groups[2].slides[0].id).not.toBe(p.groups[1].slides[0].id);
  });

  it('pastes copies of slides after a slide', () => {
    const p = pres('[V]\na\n\nb');
    const next = insertSlides(p, p.groups[0].slides[0].id, [p.groups[0].slides[1]]);
    expect(next.groups[0].slides.map((s) => s.text)).toEqual(['a', 'b', 'b']);
    expect(new Set(next.groups[0].slides.map((s) => s.id)).size).toBe(3);
  });

  it('offers ProPresenter-style group presets unless the operator changed them', () => {
    expect(groupPresets({}).map((g) => g.name)).toContain('Pre-Chorus');
    expect(groupPresets({}).find((g) => g.name === 'Chorus')?.color).toBe('#d9485f');
    expect(groupPresets({ groupPresets: [chorus] })).toEqual([chorus]);
    expect(DEFAULT_GROUPS.length).toBeGreaterThan(10);
  });
});

describe('text styles', () => {
  const style = { fontFamily: 'Copperplate', fontSize: 90, color: '#ff0000' };

  it('pastes onto a slide, a group, or the whole presentation', () => {
    const p = pres('[A]\na\n\nb\n\n[B]\nc');
    const [a, b] = p.groups[0].slides;
    const one = pasteTextStyle(p, { slideId: b.id }, style);
    expect(one.groups[0].slides.map((s) => s.style)).toEqual([undefined, style]);

    const group = pasteTextStyle(p, { groupId: p.groups[0].id }, style);
    expect(group.groups.map((g) => g.slides.map((s) => !!s.style))).toEqual([[true, true], [false]]);

    // Pasting on every slide moves the formatting to the presentation; slides stop overriding it.
    const withOwn = { ...p, groups: [{ ...p.groups[0], slides: [{ ...a, style: { color: '#00ff00', italic: true } }, b] }, p.groups[1]] };
    const all = pasteTextStyle(withOwn, 'presentation', style);
    expect(all.style).toEqual(style);
    expect(all.groups[0].slides[0].style).toEqual({ italic: true });
  });

  it('clears formatting', () => {
    const p = pres('[A]\na', { style });
    const styled = { ...p, groups: [{ ...p.groups[0], slides: [{ ...p.groups[0].slides[0], style }] }] };
    expect(clearTextStyle(styled, { slideId: styled.groups[0].slides[0].id })).toMatchObject({ style });
    expect(clearTextStyle(styled, 'presentation')).toMatchObject({ style: undefined });
  });
});

describe('transitions', () => {
  const push = { kind: 'push', ms: 600, direction: 'up' } as const;

  it('uses the slide, then the presentation, then the global transition', () => {
    const settings = { transition: { kind: 'dissolve', ms: 400 } as const };
    const p = pres('[A]\na\n\nb', { transition: { kind: 'zoom', ms: 800 } });
    const withSlide = { ...p, ...setTransition(p, { slideId: p.groups[0].slides[1].id }, push) };
    expect(effectiveTransition(settings, withSlide, withSlide.groups[0].slides[1])).toEqual(push);
    expect(effectiveTransition(settings, withSlide, withSlide.groups[0].slides[0])).toEqual({ kind: 'zoom', ms: 800 });
    expect(effectiveTransition(settings, pres('[A]\na'))).toEqual(settings.transition);
  });

  it('reads like ProPresenter', () => {
    expect(transitionLabel(push)).toBe('Push Up · 0.6s');
    expect(transitionLabel({ kind: 'cut', ms: 300 })).toBe('Cut');
    expect(transitionLabel({ kind: 'dissolve', ms: 1000 })).toBe('Dissolve · 1s');
    expect(sameTransition({ kind: 'cut', ms: 0 }, { kind: 'cut', ms: 500 })).toBe(true);
    expect(sameTransition(push, { ...push, direction: 'down' })).toBe(false);
  });

  it("maps ProPresenter's effects", () => {
    expect(transitionFromPro('Wipe', 0.7777, 8)).toEqual({ kind: 'wipe', ms: 778, direction: 'down' });
    expect(transitionFromPro('Push', 1, 4)).toEqual({ kind: 'push', ms: 1000, direction: 'left' });
    expect(transitionFromPro('Dissolve', 0.5)).toEqual({ kind: 'dissolve', ms: 500 });
    expect(transitionFromPro('Some Plugin Effect', 0.5)).toEqual({ kind: 'dissolve', ms: 500 });
    expect(transitionFromPro(undefined, 0)).toEqual({ kind: 'cut', ms: 0 });
  });

  it('keeps directions and easing sensible for each kind', () => {
    const push = { kind: 'push', ms: 500, direction: 'down' } as const;
    // Kinds that don't move drop the direction; a split only opens sideways or up and down.
    expect(withChanges(push, { kind: 'iris' })).toEqual({ kind: 'iris', ms: 500 });
    expect(withChanges(push, { kind: 'split' })).toEqual({ kind: 'split', ms: 500, direction: 'up' });
    expect(withChanges({ kind: 'cut', ms: 0 }, { kind: 'cube' })).toEqual({ kind: 'cube', ms: 400, direction: 'left' });
    expect(transitionLabel({ kind: 'split', ms: 500, direction: 'left' })).toBe('Split Sideways · 0.5s');
    expect(transitionLabel({ kind: 'flip', ms: 700, direction: 'up' })).toBe('Flip Up · 0.7s');
    // Each kind has an easing that suits it, until one is chosen.
    expect(easingOf({ kind: 'wipe' })).toBe('linear');
    expect(easingOf({ kind: 'slide', easing: 'ease-in' })).toBe('ease-in');
    expect(withChanges({ kind: 'push', ms: 500, easing: 'linear' }, { kind: 'zoom' })).toEqual({ kind: 'zoom', ms: 500 });
    expect(withChanges({ kind: 'push', ms: 500, easing: 'linear' }, { ms: 900 }).easing).toBe('linear');
    expect(sameTransition({ kind: 'zoom', ms: 500 }, { kind: 'zoom', ms: 500, easing: 'ease-out' })).toBe(true);
    expect(sameTransition({ kind: 'zoom', ms: 500 }, { kind: 'zoom', ms: 500, easing: 'linear' })).toBe(false);
    expect(TRANSITION_KINDS.map((k) => k.label)).toEqual([
      'Cut',
      'Dissolve',
      'Fade',
      'Push',
      'Slide',
      'Reveal',
      'Wipe',
      'Split',
      'Iris',
      'Zoom',
      'Blur',
      'Flip',
      'Cube',
    ]);
  });

  it('maps more of ProPresenter’s effects', () => {
    expect(transitionFromPro('Cube', 1, 6)).toEqual({ kind: 'cube', ms: 1000, direction: 'right' });
    expect(transitionFromPro('Flip', 1, 2)).toEqual({ kind: 'flip', ms: 1000, direction: 'up' });
    expect(transitionFromPro('Iris', 0.5)).toEqual({ kind: 'iris', ms: 500 });
    expect(transitionFromPro('Barn Door', 0.5, 2)).toEqual({ kind: 'split', ms: 500, direction: 'up' });
    expect(transitionFromPro('Slide', 0.5, 4)).toEqual({ kind: 'slide', ms: 500, direction: 'left' });
  });

  it('upgrades libraries saved with a length only', () => {
    const old = {
      settings: { transitionMs: 0, advanceAcrossItems: true },
      presentations: { a: { ...pres('[A]\na'), transitionMs: 750 }, b: pres('[A]\na') },
    } as unknown as Partial<LibraryData>;
    const up = upgradeTransitions(old);
    expect(up.settings).toEqual({ transition: { kind: 'cut', ms: 0 }, advanceAcrossItems: true });
    expect(up.presentations!.a.transition).toEqual(fromMs(750));
    expect('transitionMs' in up.presentations!.a).toBe(false);
    expect(up.presentations!.b.transition).toBeUndefined();
  });
});

describe('store', () => {
  beforeEach(() => useStore.getState().clearAll());

  const make = (text: string) => {
    const s = useStore.getState();
    const id = s.createPresentation({ title: 'Test', themeId: 'theme-classic' }, text);
    return () => useStore.getState().presentations[id];
  };

  it('copies a slide’s text style as it looks and pastes it elsewhere', () => {
    const get = make('[A]\na\n\nb');
    const s = useStore.getState();
    const [a, b] = get().groups[0].slides;
    s.updateSlide(get().id, a.id, { style: { color: '#123456', textAlign: 'left' } });
    s.copyTextStyle(get().id, a.id);
    const clip = useStore.getState().styleClipboard!;
    // The whole look, theme values included, but not where the box sits.
    expect(clip).toMatchObject({ color: '#123456', textAlign: 'left' });
    expect(clip.fontFamily).toBeTruthy();
    expect(clip).not.toHaveProperty('inset');
    useStore.getState().pasteTextStyle(get().id, { slideId: b.id });
    expect(get().groups[0].slides[1].style).toEqual(clip);
  });

  it('cuts, copies and pastes slides between presentations', () => {
    const from = make('[A]\none\n\ntwo');
    const to = make('[B]\nx');
    const s = useStore.getState();
    s.copySlides(from().id, [from().groups[0].slides[1].id]);
    const pasted = useStore.getState().pasteSlides(to().id, to().groups[0].slides[0].id);
    expect(to().groups[0].slides.map((sl) => sl.text)).toEqual(['x', 'two']);
    expect(pasted).toBe(to().groups[0].slides[1].id);
  });

  it('gives the frame the incoming slide’s transition', () => {
    const get = make('[A]\na\n\nb');
    const s = useStore.getState();
    s.setTransition(get().id, { slideId: get().groups[0].slides[1].id }, { kind: 'wipe', ms: 900, direction: 'right' });
    s.goLive(get().id, 0);
    expect(buildFrame(useStore.getState()).transition).toEqual(useStore.getState().settings.transition);
    s.goLive(get().id, 1);
    expect(buildFrame(useStore.getState()).transition).toEqual({ kind: 'wipe', ms: 900, direction: 'right' });
  });

  it('clears slide and presentation transitions so the wider one applies', () => {
    const get = make('[A]\na\n\nb');
    const s = useStore.getState();
    const t = { kind: 'cube', ms: 800, direction: 'left' } as const;
    s.setTransition(get().id, { slideId: get().groups[0].slides[0].id }, t);
    s.setTransition(get().id, 'presentation', t);
    useStore.getState().clearSlideTransitions(get().id);
    expect(get().groups[0].slides[0].transition).toBeUndefined();
    expect(get().transition).toEqual(t);
    useStore.getState().clearPresentationTransitions();
    expect(get().transition).toBeUndefined();
  });

  it('sends the media transition, and marks media-bin backgrounds', () => {
    const s = useStore.getState();
    s.updateSettings({ mediaTransition: { kind: 'iris', ms: 700 } });
    s.setLiveMedia('clip');
    const frame = buildFrame(useStore.getState());
    expect(frame.mediaTransition).toEqual({ kind: 'iris', ms: 700 });
    expect(frame.background).toMatchObject({ kind: 'media', live: true });
    s.clearMedia();
  });

  it('labels slides', () => {
    const get = make('[A]\na');
    useStore.getState().setSlideLabel(get().id, get().groups[0].slides[0].id, { name: 'Prayer', color: '#7c5cd6' });
    expect(get().groups[0].slides[0].label).toEqual({ name: 'Prayer', color: '#7c5cd6' });
  });
});
