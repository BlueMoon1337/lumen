import { describe, expect, it } from 'vitest';
import {
  activeOutputs,
  colorFilter,
  cornerPinHomography,
  cornerPinTransform,
  DEFAULT_COLOR,
  DEFAULT_PIN,
  defaultScreenSetup,
  newOutput,
  newScreen,
  outputRoute,
  planOutputs,
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

  it('builds output window addresses', () => {
    const screen = newScreen('stage', 'Stage Screen 1');
    expect(outputRoute({ kind: 'stage', screen, output: screen.outputs[0] })).toBe(
      `stage?screen=${screen.id}&output=${screen.outputs[0].id}`,
    );
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
    s.setScreensEnabled('stage', true);
    expect(useStore.getState().screens.stageEnabled).toBe(true);
    s.removeScreen(id);
    expect(useStore.getState().screens.screens.some((x) => x.id === id)).toBe(false);
  });
});
