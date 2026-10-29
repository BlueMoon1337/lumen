import { beforeEach, describe, expect, it } from 'vitest';
import { adjustInset, centerInset } from './components/EditView';
import { buildFrame } from './frame';
import { getSequence, presentationToText } from './lyrics';
import { useStore } from './store';
import { applyStyles, copyrightLine, resolveTheme } from './theme';
import { defaultThemes } from './seed';

const make = (text: string) => {
  const s = useStore.getState();
  const id = s.createPresentation({ title: 'Test' }, text);
  return () => useStore.getState().presentations[id];
};

describe('slide editing', () => {
  beforeEach(() => useStore.getState().clearAll());

  it('keeps per-slide formatting, backgrounds and ids through a reflow', () => {
    const get = make('[Verse 1]\na\n\nb\n\n[Chorus]\nc');
    const s = useStore.getState();
    const target = get().groups[0].slides[1];
    s.updateSlide(get().id, target.id, {
      style: { color: '#ff0000' },
      background: { type: 'color', color: '#123456', color2: '#123456' },
    });
    s.updateGroup(get().id, get().groups[1].id, { color: '#00ff00' });

    s.setPresentationText(get().id, presentationToText(get()).replace('b', 'b changed'));
    const after = get().groups[0].slides[1];
    expect(after.text).toBe('b changed');
    expect(after.id).toBe(target.id);
    expect(after.style).toEqual({ color: '#ff0000' });
    expect(after.background?.color).toBe('#123456');
    expect(get().groups[1].color).toBe('#00ff00');
  });

  it('adds, duplicates and deletes slides', () => {
    const get = make('[Verse 1]\na\n\n[Chorus]\nc');
    const s = useStore.getState();
    const first = get().groups[0].slides[0];
    const added = s.addSlide(get().id, first.id)!;
    expect(get().groups[0].slides.map((sl) => sl.id)).toEqual([first.id, added]);
    // A new slide opens with its text box selected (its eight handles showing); one with words doesn't.
    s.openEditor(added);
    expect(useStore.getState().editTextSelected).toBe(true);
    s.openEditor(first.id);
    expect(useStore.getState().editTextSelected).toBe(false);
    const copy = s.duplicateSlide(get().id, first.id)!;
    expect(get().groups[0].slides[1]).toMatchObject({ id: copy, text: 'a' });

    // Deleting a group's last slide removes the group from the arrangement too.
    s.deleteSlide(get().id, get().groups[1].slides[0].id);
    expect(get().groups.map((g) => g.name)).toEqual(['Verse 1']);
    expect(get().arrangement).toHaveLength(1);
  });

  it('gives a new slide the Text Style of the slide it follows', () => {
    const get = make('[Verse 1]\na\n\nb\n\n[Chorus]\nc');
    const s = useStore.getState();
    const [a, b] = get().groups[0].slides;
    const chorus = get().groups[1].slides[0];
    s.updateSlide(get().id, a.id, { style: { fontFamily: 'Impact', fontSize: 120 } });
    s.updateSlide(get().id, chorus.id, { style: { fontFamily: 'Copperplate', color: '#ffcc00' } });
    const afterA = s.addSlide(get().id, a.id)!;
    const afterB = s.addSlide(get().id, b.id)!;
    // The bottom + adds after the last slide.
    const atEnd = s.addSlide(get().id, chorus.id)!;
    const styleOf = (id: string) =>
      get()
        .groups.flatMap((g) => g.slides)
        .find((sl) => sl.id === id)?.style;
    expect(styleOf(afterA)).toEqual({ fontFamily: 'Impact', fontSize: 120 });
    expect(styleOf(afterB)).toBeUndefined();
    expect(styleOf(atEnd)).toEqual({ fontFamily: 'Copperplate', color: '#ffcc00' });
    // Its own copy: changing one doesn't change the other.
    expect(styleOf(atEnd)).not.toBe(styleOf(chorus.id));
  });

  it('applies the active slide’s Text Style to all slides, and resets a slide to the theme', () => {
    const get = make('[Verse 1]\na\n\nb\n\n[Chorus]\nc');
    const s = useStore.getState();
    const [a, b] = get().groups[0].slides;
    const c = get().groups[1].slides[0];
    s.updatePresentation(get().id, { style: { fontFamily: 'Impact', color: '#ff0000' } });
    s.updateSlide(get().id, a.id, { style: { fontSize: 140 } });
    s.updateSlide(get().id, c.id, { style: { fontFamily: 'Copperplate', color: '#ffffff' } });
    // From the chorus: every slide now looks like it.
    s.applyStyleToAll(get().id, c.id);
    expect(get().style).toEqual({ fontFamily: 'Copperplate', color: '#ffffff' });
    expect(
      get()
        .groups.flatMap((g) => g.slides)
        .map((sl) => sl.style),
    ).toEqual([undefined, undefined, undefined]);
    // A slide with no style of its own applies the presentation's (still clickable, nothing lost).
    s.applyStyleToAll(get().id, b.id);
    expect(get().style).toEqual({ fontFamily: 'Copperplate', color: '#ffffff' });
    // Reset to Theme: this slide looks as the theme does, the others keep the presentation's style.
    const theme = resolveTheme(useStore.getState(), get());
    s.resetSlideStyle(get().id, b.id, theme);
    const look = applyStyles(theme, get().style, get().groups[0].slides[1].style);
    expect([look.fontFamily, look.color]).toEqual([theme.fontFamily, theme.color]);
    expect(applyStyles(theme, get().style, get().groups[0].slides[0].style).fontFamily).toBe('Copperplate');
    // With no presentation style, it just drops the slide's own.
    s.updatePresentation(get().id, { style: undefined });
    s.resetSlideStyle(get().id, b.id, theme);
    expect(get().groups[0].slides[1].style).toBeUndefined();
  });

  it('starts a group when adding to an empty presentation', () => {
    const get = make('');
    const id = useStore.getState().addSlide(get().id);
    expect(get().groups[0].slides[0].id).toBe(id);
    expect(getSequence(get())).toHaveLength(1);
  });
});

describe('output frame', () => {
  beforeEach(() => useStore.getState().clearAll());

  it('applies presentation then slide formatting, and slide backgrounds', () => {
    const get = make('[V]\na\n\nb');
    const s = useStore.getState();
    s.updatePresentation(get().id, { style: { color: '#111111', fontSize: 50 }, transition: { kind: 'cut', ms: 0 } });
    s.updateSlide(get().id, get().groups[0].slides[1].id, {
      style: { color: '#222222' },
      background: { type: 'color', color: '#333333', color2: '#333333' },
    });
    s.goLive(get().id, 1);
    const frame = buildFrame(useStore.getState());
    expect(frame.slide?.theme).toMatchObject({ color: '#222222', fontSize: 50 });
    expect(frame.background).toMatchObject({ kind: 'color', color: '#333333' });
    expect(frame.transition).toEqual({ kind: 'cut', ms: 0 });
  });

  it('shows the copyright line on the first and last slides only', () => {
    const get = make('[V]\na\n\nb\n\nc');
    const s = useStore.getState();
    s.updatePresentation(get().id, { showCopyright: true, author: 'Writer', ccli: '123' });
    s.goLive(get().id, 0);
    expect(buildFrame(useStore.getState()).slide?.footer).toContain('CCLI Song # 123');
    s.goLive(get().id, 1);
    expect(buildFrame(useStore.getState()).slide?.footer).toBeUndefined();
    s.goLive(get().id, 2);
    expect(buildFrame(useStore.getState()).slide?.footer).toBeDefined();
  });

  it('restarts and pauses live video through the frame', () => {
    const s = useStore.getState();
    s.setLiveMedia('vid');
    const before = buildFrame(useStore.getState()).background!;
    s.setMediaPaused(true);
    expect(buildFrame(useStore.getState()).background).toMatchObject({ paused: true, key: before.key });
    s.restartMedia();
    const after = buildFrame(useStore.getState()).background!;
    expect(after.key).not.toBe(before.key);
    expect(after).toMatchObject({ paused: false });
  });
});

describe('helpers', () => {
  it('leaves the theme object alone when nothing overrides it', () => {
    const t = defaultThemes[0];
    expect(applyStyles(t, undefined, {})).toBe(t);
    expect(applyStyles(t, { color: '#000000' })).not.toBe(t);
  });

  it('builds a copyright line', () => {
    const line = copyrightLine(
      {
        id: 'p',
        title: 'Song',
        author: 'A',
        year: '2020',
        publisher: 'Pub',
        ccli: '9',
        category: 'song',
        groups: [],
        arrangement: [],
        updatedAt: 0,
      },
      {
        transition: { kind: 'cut', ms: 0 },
        advanceAcrossItems: true,
        defaultThemeId: '',
        gridSize: 0,
        slideView: 'grid',
        ccliLicense: '42',
      },
    );
    expect(line).toBe('Song — A · © 2020 Pub · CCLI Song # 9 · CCLI License # 42');
  });

  it('moves and resizes text boxes within the canvas', () => {
    const start = { top: 10, right: 10, bottom: 10, left: 10 };
    expect(adjustInset(start, 'move', 5, -20)).toEqual({ top: 0, right: 5, bottom: 20, left: 15 });
    expect(adjustInset(start, 'se', -30, 200)).toEqual({ top: 10, right: 40, bottom: 0, left: 10 });
    // Center: the same size, in the middle of the slide.
    expect(centerInset({ top: 10, right: 30, bottom: 50, left: 10 })).toEqual({ top: 30, right: 20, bottom: 30, left: 20 });
    expect(centerInset({ top: 10, right: 30, bottom: 50, left: 10 }, 'x')).toEqual({ top: 10, right: 20, bottom: 50, left: 20 });
    // Never collapses below the minimum size.
    expect(adjustInset(start, 'w', 500, 0).left).toBe(87);
  });
});
