import { beforeEach, describe, expect, it } from 'vitest';
import { captureFileName, captureSource, CAPTURE_ENCODINGS, encodingLabel, sameEncoding } from './capture';
import { elapsed } from './components/CaptureDialog';
import { runScreensCommand, screensCommandFor } from './components/screensCommands';
import { buildFrame } from './frame';
import { DEFAULT_LOOK, lookScreen, maskClip, sameLook, screenLook } from './looks';
import { adjustBox, copyLayout, DEFAULT_STAGE_LAYOUTS, layoutFor, newStageObject } from './stageLayouts';
import { useStore } from './store';

const s = () => useStore.getState();
const audienceId = () => s().screens.screens.find((sc) => sc.kind === 'audience')!.id;
const stageId = () => s().screens.screens.find((sc) => sc.kind === 'stage')!.id;

beforeEach(() => {
  s().clearAll();
  useStore.setState({ looks: [DEFAULT_LOOK], liveLook: DEFAULT_LOOK, stageLayouts: DEFAULT_STAGE_LAYOUTS, dialog: null, mode: 'show' });
});

describe('Looks', () => {
  it('show everything on a screen they don’t mention', () => {
    expect(lookScreen(DEFAULT_LOOK, 'any')).toMatchObject({ messages: true, logo: true, slide: true, media: true, videoInput: true });
    expect(maskClip(undefined)).toBe('inset(0% 0% 0% 0%)');
    expect(maskClip('fourThree')).toBe('inset(0% 12.5% 0% 12.5%)');
  });

  it('change the live look on the screens straight away', () => {
    const id = audienceId();
    s().updateLiveLook(id, { media: false, mask: 'lowerThird' });
    const frame = buildFrame(s());
    expect(frame.looks?.[id]).toMatchObject({ show: { media: false, slide: true }, mask: 'lowerThird' });
    // Stage screens aren't audience screens: no look for them.
    expect(frame.looks?.[stageId()]).toBeUndefined();
  });

  it('dress the slides in a look’s own theme', () => {
    const theme = s().themes[1] ?? s().themes[0];
    expect(
      screenLook({ ...DEFAULT_LOOK, screens: { a: { ...lookScreen(DEFAULT_LOOK, 'a'), themeId: theme.id } } }, 'a', s().themes, 500),
    ).toMatchObject({
      theme: { id: theme.id },
      fadeMs: 500,
    });
  });

  it('save as presets, and go live from Screens ▸ Live', () => {
    const id = audienceId();
    s().updateLiveLook(id, { slide: false });
    const saved = s().saveLook({ ...s().liveLook, id: '', name: 'Stream' });
    expect(s().looks.map((l) => l.name)).toEqual(['Default', 'Stream']);
    runScreensCommand(`look:${DEFAULT_LOOK.id}`);
    expect(s().liveLook.name).toBe('Default');
    expect(lookScreen(s().liveLook, id).slide).toBe(true);
    runScreensCommand(`look:${saved}`);
    expect(s().liveLook).toMatchObject({ id: saved, name: 'Stream' });
    expect(lookScreen(s().liveLook, id).slide).toBe(false);
    expect(sameLook(s().liveLook, s().looks[1], [id])).toBe(true);
  });

  it('keep the last one', () => {
    s().deleteLook(DEFAULT_LOOK.id);
    expect(s().looks).toHaveLength(1);
  });
});

describe('Stage layouts', () => {
  it('give each stage screen its layout, or the first', () => {
    const second = DEFAULT_STAGE_LAYOUTS[1];
    expect(layoutFor({}, DEFAULT_STAGE_LAYOUTS).id).toBe(DEFAULT_STAGE_LAYOUTS[0].id);
    expect(layoutFor({ stageLayoutId: second.id }, DEFAULT_STAGE_LAYOUTS).id).toBe(second.id);
    expect(layoutFor({ stageLayoutId: 'gone' }, DEFAULT_STAGE_LAYOUTS).id).toBe(DEFAULT_STAGE_LAYOUTS[0].id);
    const frame = buildFrame(s());
    expect(frame.stageLayouts?.[stageId()]?.id).toBe(DEFAULT_STAGE_LAYOUTS[0].id);
  });

  it('move and resize objects, kept on the layout', () => {
    const box = { x: 100, y: 100, width: 400, height: 200 };
    const layout = { width: 1920, height: 1080 };
    expect(adjustBox(box, 'move', 10.4, -20, layout)).toEqual({ x: 110, y: 80, width: 400, height: 200 });
    expect(adjustBox(box, 'move', 5000, 5000, layout)).toEqual({ x: 1520, y: 880, width: 400, height: 200 });
    expect(adjustBox(box, 'se', 50, 30, layout)).toEqual({ x: 100, y: 100, width: 450, height: 230 });
    expect(adjustBox(box, 'nw', -500, -500, layout)).toEqual({ x: 0, y: 0, width: 500, height: 300 });
    // Never smaller than 20 pixels.
    expect(adjustBox(box, 'e', -1000, 0, layout).width).toBe(20);
  });

  it('are edited with undo, and deleting one leaves its screens on the first', () => {
    const id = s().addStageLayout(copyLayout(DEFAULT_STAGE_LAYOUTS[0]));
    const layout = s().stageLayouts.find((l) => l.id === id)!;
    expect(layout.name).toBe('Current + Next Text copy');
    expect(layout.objects.map((o) => o.id)).not.toEqual(DEFAULT_STAGE_LAYOUTS[0].objects.map((o) => o.id));
    const clock = newStageObject('clock', layout);
    s().addStageObject(id, clock);
    expect(s().stageObjectId).toBe(clock.id);
    s().updateStageObject(id, clock.id, { x: 5 });
    s().restackStageObject(id, clock.id, -100);
    expect(s().stageLayouts.find((l) => l.id === id)!.objects[0]).toMatchObject({ id: clock.id, x: 5 });
    s().updateScreen(stageId(), { stageLayoutId: id });
    s().deleteStageLayout(id);
    expect(s().screens.screens.find((sc) => sc.id === stageId())!.stageLayoutId).toBeUndefined();
    expect(s().stageLayouts.some((l) => l.id === id)).toBe(false);
  });
});

describe('The Screens menu', () => {
  const key = (code: string, mods: { shift?: boolean; alt?: boolean } = {}) =>
    screensCommandFor({ code, metaKey: true, ctrlKey: false, altKey: !!mods.alt, shiftKey: !!mods.shift });

  it('has ProPresenter’s keys', () => {
    expect(key('Digit1')).toBe('toggle-audience');
    expect(key('Digit2')).toBe('toggle-stage');
    expect(key('Digit1', { shift: true })).toBe('edit-looks');
    expect(key('Digit4')).toBe('edit-layouts');
    expect(key('Digit1', { alt: true })).toBe('configure-screens');
    expect(key('Digit3')).toBeNull();
    expect(screensCommandFor({ code: 'Digit1', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBeNull();
  });

  it('opens the looks, the layout editor, the screens and capture settings', () => {
    runScreensCommand('edit-looks');
    expect(s().dialog).toBe('looks');
    runScreensCommand('edit-layouts');
    expect(s()).toMatchObject({ mode: 'layouts', dialog: null });
    runScreensCommand('configure-screens');
    expect(s().dialog).toBe('screens');
    runScreensCommand('capture-settings');
    expect(s().dialog).toBe('capture');
  });
});

describe('Capture', () => {
  it('names its files by the time, and its encodings as ProPresenter does', () => {
    expect(captureFileName(new Date(2026, 9, 27, 9, 5, 3), 'mp4')).toBe('Lumen Capture 2026-10-27 at 09.05.03.mp4');
    expect(CAPTURE_ENCODINGS.map(encodingLabel)).toEqual([
      '360p30 (4 Mbps)',
      '480p30 (4 Mbps)',
      '720p30 (6 Mbps)',
      '720p30 (10 Mbps)',
      '720p30 (14 Mbps)',
      '720p60 (16 Mbps)',
      '1080p30 (20 Mbps)',
      '1080p60 (24 Mbps)',
    ]);
    expect(sameEncoding({ ...CAPTURE_ENCODINGS[7] }, CAPTURE_ENCODINGS[7])).toBe(true);
  });

  it('records the chosen audience screen, else the first', () => {
    const screens = s().screens.screens;
    expect(captureSource(screens)?.id).toBe(audienceId());
    expect(captureSource(screens, stageId())?.id).toBe(audienceId());
    expect(captureSource(screens.filter((sc) => sc.kind === 'stage'))).toBeUndefined();
  });

  it('shows how long it has been recording', () => {
    expect(elapsed(0, 3_723_000)).toBe('1:02:03');
    expect(elapsed(1000, 500)).toBe('0:00:00');
  });
});
