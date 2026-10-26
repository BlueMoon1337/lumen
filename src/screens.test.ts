import { describe, expect, it } from 'vitest';
import {
  activeOutputs,
  blendAlpha,
  blendMask,
  colorFilter,
  cornerPinHomography,
  cornerPinTransform,
  DEFAULT_COLOR,
  DEFAULT_PIN,
  defaultScreenSetup,
  hostRoute,
  newOutput,
  newScreen,
  normalizeScreens,
  planHosts,
  planOutputs,
  screenLayout,
  targetRect,
  type DetectedDisplay,
} from './screens';
import { useStore } from './store';
import type { ScreenSetup } from './types';

const laptop: DetectedDisplay = {
  id: 1,
  label: 'Built-in Retina Display',
  width: 1512,
  height: 982,
  internal: true,
  primary: true,
  current: true,
};
const tv: DetectedDisplay = {
  id: 7,
  label: 'E65-E0',
  width: 1920,
  height: 1080,
  internal: false,
  primary: false,
  current: false,
  refresh: 60,
};
const projector: DetectedDisplay = { id: 9, label: 'EPSON PJ', width: 1280, height: 800, internal: false, primary: false, current: false };

function setup(): ScreenSetup {
  return { ...defaultScreenSetup(), audienceEnabled: true, stageEnabled: true };
}

describe('planning outputs', () => {
  it('sends Automatic outputs to spare external displays, audience first', () => {
    const plan = planOutputs(setup(), [laptop, tv, projector]);
    expect(plan.map((p) => [p.screen.name, p.status, p.display?.label])).toEqual([
      ['Screen 1', 'display', 'E65-E0'],
      ['Stage Screen 1', 'display', 'EPSON PJ'],
    ]);
  });

  it('never takes over the operator’s screen; falls back to a window', () => {
    const plan = planOutputs(setup(), [laptop]);
    expect(plan.map((p) => p.status)).toEqual(['window', 'window']);
  });

  it('keeps an assigned display and reports it disconnected when unplugged', () => {
    const s = setup();
    s.screens[0].outputs[0].display = { id: 7, label: 'E65-E0', width: 1920, height: 1080 };
    expect(planOutputs(s, [laptop, projector])[0]).toMatchObject({ status: 'disconnected' });
    // Plugged back in (even with a new id), it is found by name and size.
    expect(planOutputs(s, [laptop, { ...tv, id: 42 }])[0]).toMatchObject({ status: 'display', display: { id: 42 } });
    // An assigned display is not handed to an Automatic output.
    expect(planOutputs(s, [laptop, tv])[1]).toMatchObject({ status: 'window' });
  });

  it('only opens outputs for enabled screens and connected displays', () => {
    const s = setup();
    s.stageEnabled = false;
    s.screens[0].outputs.push({ ...newOutput(), display: { label: 'Gone', width: 1, height: 1 } });
    expect(activeOutputs(s, [laptop, tv]).map((p) => `${p.screen.name}#${p.index}`)).toEqual(['Screen 1#0']);
  });

  it('mirrors a screen to several outputs', () => {
    const s = setup();
    s.screens[0].outputs.push(newOutput());
    const plan = planOutputs(s, [laptop, tv, projector]).filter((p) => p.kind === 'audience');
    expect(plan.map((p) => p.display?.label)).toEqual(['E65-E0', 'EPSON PJ']);
  });

  it('uses only the first output in Single mode, and keeps the others', () => {
    const s = setup();
    s.screens[0].outputs.push(newOutput());
    s.screens[0].mode = 'single';
    expect(planOutputs(s, [laptop, tv, projector]).filter((p) => p.kind === 'audience')).toHaveLength(1);
    expect(s.screens[0].outputs).toHaveLength(2);
  });

  it('shows placeholders nowhere', () => {
    const s = setup();
    s.screens[0].outputs[0].placeholder = { width: 1920, height: 1080 };
    expect(planOutputs(s, [laptop, tv])[0]).toMatchObject({ status: 'placeholder' });
    expect(activeOutputs(s, [laptop, tv]).map((p) => p.kind)).toEqual(['stage']);
  });

  it('puts outputs that split one signal on the same display, in one window', () => {
    const s = setup();
    s.stageEnabled = false;
    const [a] = s.screens[0].outputs;
    a.target = { type: 'grid', cols: 2, rows: 1, cell: 0 };
    s.screens[0].outputs.push({ ...newOutput(), target: { type: 'grid', cols: 2, rows: 1, cell: 1 } });
    const hosts = planHosts(activeOutputs(s, [laptop, tv, projector]));
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ key: 'display:7', width: 1920, height: 1080 });
    expect(hosts[0].outputs.map((p) => p.output.target)).toEqual([
      { type: 'grid', cols: 2, rows: 1, cell: 0 },
      { type: 'grid', cols: 2, rows: 1, cell: 1 },
    ]);
    const screen = s.screens[0];
    expect(hostRoute(hosts[0])).toBe(`screen?size=1920x1080&o=${screen.id}:${screen.outputs[0].id}&o=${screen.id}:${screen.outputs[1].id}`);
  });

  it('opens a window per output when there is no spare display', () => {
    const hosts = planHosts(activeOutputs(setup(), [laptop]));
    expect(hosts.map((h) => h.key.split(':')[0])).toEqual(['window', 'window']);
  });
});

describe('screen layouts and targets', () => {
  it('tiles grouped outputs into one wide screen', () => {
    const screen = { ...newScreen('audience', 'Wide'), mode: 'grouped' as const, columns: 2 };
    screen.outputs.push(newOutput(), newOutput());
    const layout = screenLayout(screen);
    expect([layout.width, layout.height, layout.cols, layout.rows]).toEqual([3840, 2160, 2, 2]);
    expect(layout.rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [1920, 0],
      [0, 1080],
    ]);
  });

  it('overlaps blended outputs and fades only the inner edges', () => {
    const screen = { ...newScreen('audience', 'Blend'), mode: 'blend' as const, columns: 2, blend: { overlap: 240, gamma: 2.2 } };
    screen.outputs.push(newOutput());
    const layout = screenLayout(screen);
    expect([layout.width, layout.rects[1].x]).toEqual([3600, 1680]);
    expect(blendMask(screen, 0)).toHaveLength(1);
    expect(blendMask(screen, 0)[0]).toMatch(/^linear-gradient\(to left/);
    expect(blendMask(screen, 1)[0]).toMatch(/^linear-gradient\(to right/);
    expect(blendMask({ ...screen, mode: 'grouped' }, 0)).toEqual([]);
  });

  it('blends two projectors to even light across the overlap', () => {
    for (const gamma of [1, 2.2]) {
      for (let t = 0; t <= 1; t += 0.125) {
        expect(blendAlpha(t, gamma) ** gamma + blendAlpha(1 - t, gamma) ** gamma).toBeCloseTo(1, 6);
      }
    }
    expect(blendAlpha(0, 2.2)).toBe(0);
    expect(blendAlpha(1, 2.2)).toBe(1);
  });

  it('measures grid and custom targets as fractions of the signal', () => {
    expect(targetRect({ type: 'full' }, { width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(targetRect({ type: 'grid', cols: 2, rows: 2, cell: 3 }, { width: 3840, height: 2160 })).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
    expect(targetRect({ type: 'custom', x: 960, y: 0, width: 960, height: 540 }, { width: 1920, height: 1080 })).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  it('fills in settings missing from older saved setups', () => {
    const old = {
      audienceEnabled: true,
      stageEnabled: false,
      screens: [{ id: 's', kind: 'audience', name: 'Screen 1', width: 1920, height: 1080, outputs: [{ id: 'o' }] }],
    };
    const s = normalizeScreens(old as unknown as ScreenSetup);
    expect(s.screens[0]).toMatchObject({ id: 's', mode: 'mirror', columns: 2, blend: { overlap: 240 } });
    expect(s.screens[0].outputs[0]).toMatchObject({ id: 'o', target: { type: 'full' }, alphaKey: 'off' });
  });
});

describe('picture adjustments', () => {
  it('builds CSS filters only for changed values', () => {
    expect(colorFilter(DEFAULT_COLOR)).toBeUndefined();
    expect(colorFilter({ brightness: 1.2, contrast: 1, saturation: 0, hue: 30 })).toBe('brightness(1.2) saturate(0) hue-rotate(30deg)');
  });

  it('leaves an unpinned output untransformed', () => {
    expect(cornerPinTransform(DEFAULT_PIN, 1920, 1080)).toBeUndefined();
  });

  it('maps each corner of the picture onto its pinned point', () => {
    const pin = { tl: { x: 0.1, y: 0.05 }, tr: { x: 0.95, y: 0 }, br: { x: 1, y: 0.9 }, bl: { x: 0, y: 1 } };
    const [w, h] = [1920, 1080];
    const H = cornerPinHomography(pin, w, h);
    const project = (x: number, y: number) => {
      const d = H[6] * x + H[7] * y + H[8];
      return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
    };
    const corners: [number, number, { x: number; y: number }][] = [
      [0, 0, pin.tl],
      [w, 0, pin.tr],
      [w, h, pin.br],
      [0, h, pin.bl],
    ];
    for (const [x, y, target] of corners) {
      const [px, py] = project(x, y);
      expect(px).toBeCloseTo(target.x * w, 6);
      expect(py).toBeCloseTo(target.y * h, 6);
    }
    expect(cornerPinTransform(pin, w, h)).toMatch(/^matrix3d\(/);
  });
});

describe('screen setup in the store', () => {
  it('adds screens with numbered names, mirrors outputs, and toggles screens', () => {
    const s = useStore.getState();
    const id = s.addScreen('audience');
    expect(useStore.getState().screens.screens.find((x) => x.id === id)?.name).toBe('Screen 2');
    s.setOutputCount(id, 3);
    expect(useStore.getState().screens.screens.find((x) => x.id === id)?.outputs).toHaveLength(3);
    s.setOutputCount(id, 0);
    expect(useStore.getState().screens.screens.find((x) => x.id === id)?.outputs).toHaveLength(1);
    // A new output next to a 2 x 1 region takes the other half of the same signal.
    const [first] = useStore.getState().screens.screens.find((x) => x.id === id)!.outputs;
    s.updateOutput(id, first.id, { target: { type: 'grid', cols: 2, rows: 1, cell: 0 } });
    s.setOutputCount(id, 2);
    expect(useStore.getState().screens.screens.find((x) => x.id === id)?.outputs[1].target).toEqual({
      type: 'grid',
      cols: 2,
      rows: 1,
      cell: 1,
    });
    s.setScreensEnabled('stage', true);
    expect(useStore.getState().screens.stageEnabled).toBe(true);
    s.removeScreen(id);
    expect(useStore.getState().screens.screens.some((x) => x.id === id)).toBe(false);
  });
});
