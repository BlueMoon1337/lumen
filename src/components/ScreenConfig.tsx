import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { requestScreenAccess, setScreensEnabled, syncBrowserWindows, useDisplays } from '../outputs';
import {
  DEFAULT_COLOR,
  DEFAULT_PIN,
  describeDisplay,
  findDisplay,
  planOutputs,
  toDisplayRef,
  type DetectedDisplay,
  type PlannedOutput,
} from '../screens';
import { useStore } from '../store';
import type { CornerPin, OutputColor, ScreenConfig, ScreenKind, ScreenOutput, TestPattern } from '../types';
import { Dialog, IconButton, Popover } from './ui';

const desktop = () => !!window.lumenDesktop;
/** In a browser, windows only open during a click, so changes that move outputs re-sync right away. */
const resync = () => {
  if (!desktop()) syncBrowserWindows();
};

const refKey = (d: { label: string; width: number; height: number }) => `${d.label}|${d.width}x${d.height}`;

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

function statusOf(p: PlannedOutput | undefined, openKeys: string[], enabled: boolean): { text: string; tone: 'ok' | 'warn' | 'idle' } {
  if (!p) return { text: '', tone: 'idle' };
  if (p.status === 'disconnected') return { text: 'Disconnected', tone: 'warn' };
  if (openKeys.includes(p.key)) return { text: p.status === 'window' ? 'Showing in a window' : 'Showing', tone: 'ok' };
  if (!enabled) return { text: 'Screen off', tone: 'idle' };
  return { text: desktop() ? 'Opening…' : 'Click the screen switch to show', tone: 'idle' };
}

function tileLabel(output: ScreenOutput, p: PlannedOutput | undefined) {
  if (output.display) return output.display.label;
  return p?.display ? `Automatic · ${p.display.label}` : 'Automatic';
}

export function ScreenConfigDialog({ onClose }: { onClose: () => void }) {
  const setup = useStore((s) => s.screens);
  const tools = useStore((s) => s.screenTools);
  const displays = useDisplays((s) => s.displays);
  const access = useDisplays((s) => s.access);
  const openKeys = useDisplays((s) => s.openKeys);
  const s = useStore.getState();
  const [selectedId, setSelectedId] = useState<string | undefined>(setup.screens[0]?.id);
  const [outputId, setOutputId] = useState<string | undefined>();
  const [testOpen, setTestOpen] = useState(false);

  const screen = setup.screens.find((x) => x.id === selectedId) ?? setup.screens[0];
  const output = screen?.outputs.find((o) => o.id === outputId) ?? screen?.outputs[0];
  const plan = planOutputs(setup, displays);
  const planFor = (o: ScreenOutput) => plan.find((p) => p.output.id === o.id);
  const enabledFor = (kind: ScreenKind) => (kind === 'audience' ? setup.audienceEnabled : setup.stageEnabled);

  const group = (kind: ScreenKind, title: string) => (
    <section className="sc-group">
      <div className="sc-group-head">
        <Switch checked={enabledFor(kind)} onChange={(v) => setScreensEnabled(kind, v)} label={`${title} screens on`} />
        <span className="sc-group-title">{title}</span>
        <IconButton
          icon="plus"
          title={`Add ${title.toLowerCase()} screen`}
          onClick={() => {
            const id = s.addScreen(kind);
            setSelectedId(id);
            setOutputId(undefined);
            resync();
          }}
        />
      </div>
      {setup.screens
        .filter((x) => x.kind === kind)
        .map((x) => {
          const states = x.outputs.map((o) => statusOf(planFor(o), openKeys, enabledFor(kind)).tone);
          const tone = states.includes('warn') ? 'warn' : states.includes('ok') ? 'ok' : 'idle';
          return (
            <button
              key={x.id}
              className={`sc-screen ${x.id === screen?.id ? 'selected' : ''}`}
              onClick={() => {
                setSelectedId(x.id);
                setOutputId(undefined);
              }}
            >
              <span className={`sc-dot ${tone}`} />
              <span className="sc-screen-text">
                <span className="sc-screen-name">{x.name}</span>
                <span className="sc-screen-size">
                  {x.width} x {x.height}
                </span>
              </span>
            </button>
          );
        })}
    </section>
  );

  return (
    <Dialog title="Screen Configuration" onClose={onClose} className="screen-config-dialog">
      <div className="screen-config">
        <aside className="sc-side">
          {group('audience', 'Audience')}
          {group('stage', 'Stage')}
          <div className="sc-side-foot">
            <label className="sc-identify">
              Identify Screens
              <Switch checked={tools.identify} onChange={(identify) => s.setScreenTools({ identify })} label="Identify screens" />
            </label>
            <div className="popover-anchor">
              <button className={`btn sc-wide ${tools.testPattern ? 'on' : ''}`} onClick={() => setTestOpen(!testOpen)}>
                {tools.testPattern ? 'Test Pattern On…' : 'Test Patterns…'}
              </button>
              <Popover open={testOpen} onClose={() => setTestOpen(false)} className="test-pop">
                <TestPatterns screens={setup.screens} />
              </Popover>
            </div>
          </div>
        </aside>

        {screen && output ? (
          <section className="sc-main">
            <ScreenHeader
              screen={screen}
              canRemove={setup.screens.filter((x) => x.kind === screen.kind).length > 1 || screen.kind === 'stage'}
              onRemoved={() => setSelectedId(undefined)}
            />
            <div className="sc-row">
              <select value="mirror" disabled aria-label="Output mode" title="Every output shows the same picture">
                <option value="mirror">Mirror</option>
              </select>
              <span className="sc-spacer" />
              <span className="sc-outputs">
                Outputs
                <span className="sc-stepper">
                  <button
                    onClick={() => (s.setOutputCount(screen.id, screen.outputs.length - 1), resync())}
                    disabled={screen.outputs.length <= 1}
                    aria-label="Fewer outputs"
                  >
                    −
                  </button>
                  <span>{screen.outputs.length}</span>
                  <button
                    onClick={() => (s.setOutputCount(screen.id, screen.outputs.length + 1), resync())}
                    disabled={screen.outputs.length >= 8}
                    aria-label="More outputs"
                  >
                    +
                  </button>
                </span>
              </span>
            </div>
            <div className="sc-tiles">
              {screen.outputs.map((o) => {
                const p = planFor(o);
                const st = statusOf(p, openKeys, enabledFor(screen.kind));
                return (
                  <button
                    key={o.id}
                    className={`sc-tile ${o.id === output.id ? 'selected' : ''} ${p?.status ?? ''}`}
                    onClick={() => setOutputId(o.id)}
                  >
                    <span className="sc-tile-name">{o.display || p?.display ? tileLabel(o, p) : 'Unconfigured'}</span>
                    <span className={`sc-tile-status ${st.tone}`}>{st.text}</span>
                  </button>
                );
              })}
            </div>
            <OutputSettings
              screen={screen}
              output={output}
              planned={planFor(output)}
              displays={displays}
              access={access}
              status={statusOf(planFor(output), openKeys, enabledFor(screen.kind))}
            />
          </section>
        ) : (
          <section className="sc-main sc-empty">Add a screen with the + buttons.</section>
        )}
      </div>
      <div className="dialog-actions">
        <span className="muted small-print sc-foot-note">
          {desktop()
            ? 'Outputs open on their screens automatically and come back when a disconnected screen is plugged in again.'
            : 'Browsers only open output windows when you click. For automatic HDMI outputs, use the Lumen desktop app.'}
        </span>
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function ScreenHeader({ screen, canRemove, onRemoved }: { screen: ScreenConfig; canRemove: boolean; onRemoved: () => void }) {
  const s = useStore.getState();
  return (
    <header className="sc-head">
      <div className="sc-head-text">
        <input
          className="sc-name"
          value={screen.name}
          onChange={(e) => s.updateScreen(screen.id, { name: e.target.value })}
          aria-label="Screen name"
        />
        <span className="muted">
          {screen.width} x {screen.height}
        </span>
      </div>
      <label className="sc-color">
        <input
          type="checkbox"
          checked={!!screen.screenColor}
          onChange={(e) => s.updateScreen(screen.id, { screenColor: e.target.checked ? '#000000' : undefined })}
        />
        Screen Color
        <input
          type="color"
          value={screen.screenColor ?? '#000000'}
          disabled={!screen.screenColor}
          onChange={(e) => s.updateScreen(screen.id, { screenColor: e.target.value })}
          aria-label="Screen color"
        />
      </label>
      {canRemove && (
        <IconButton
          icon="trash"
          title="Remove this screen"
          danger
          onClick={() => {
            if (!confirm(`Remove ${screen.name}?`)) return;
            s.removeScreen(screen.id);
            onRemoved();
            resync();
          }}
        />
      )}
    </header>
  );
}

type Tab = 'hardware' | 'color' | 'pin' | 'key';

function OutputSettings({
  screen,
  output,
  planned,
  displays,
  access,
  status,
}: {
  screen: ScreenConfig;
  output: ScreenOutput;
  planned?: PlannedOutput;
  displays: DetectedDisplay[];
  access: ReturnType<typeof useDisplays.getState>['access'];
  status: { text: string; tone: string };
}) {
  const [tab, setTab] = useState<Tab>('hardware');
  const s = useStore.getState();
  const update = (patch: Partial<ScreenOutput>) => s.updateOutput(screen.id, output.id, patch);
  const tabs: [Tab, string][] = [
    ['hardware', 'Hardware'],
    ['color', 'Color'],
    ['pin', 'Corner Pin'],
    ...(screen.kind === 'audience' ? [['key', 'Alpha Key'] as [Tab, string]] : []),
  ];
  const current = tabs.some(([t]) => t === tab) ? tab : 'hardware';

  return (
    <div className="sc-output">
      <div className="sc-output-name">{tileLabel(output, planned)}</div>
      <div className="seg sc-tabs">
        {tabs.map(([t, label]) => (
          <button key={t} className={current === t ? 'on' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sc-tab-body">
        {current === 'hardware' && (
          <HardwareTab output={output} planned={planned} displays={displays} access={access} status={status} update={update} />
        )}
        {current === 'color' && <ColorTab color={output.color} update={(color) => update({ color })} />}
        {current === 'pin' && (
          <CornerPinTab pin={output.cornerPin} width={screen.width} height={screen.height} update={(cornerPin) => update({ cornerPin })} />
        )}
        {current === 'key' && <AlphaKeyTab value={output.alphaKey} update={(alphaKey) => update({ alphaKey })} />}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sc-info-row">
      <span>{label}:</span>
      <span>{children}</span>
    </div>
  );
}

function HardwareTab({
  output,
  planned,
  displays,
  access,
  status,
  update,
}: {
  output: ScreenOutput;
  planned?: PlannedOutput;
  displays: DetectedDisplay[];
  access: string;
  status: { text: string; tone: string };
  update: (patch: Partial<ScreenOutput>) => void;
}) {
  const connected = output.display ? findDisplay(output.display, displays) : undefined;
  const shownOn = planned?.display;
  const value = output.display ? refKey(output.display) : 'auto';

  return (
    <div className="sc-hardware">
      <div className="sc-hw-grid">
        <label className="field">
          Output
          <select
            value={value}
            onChange={(e) => {
              const d = displays.find((x) => refKey(x) === e.target.value);
              update({ display: d ? toDisplayRef(d) : e.target.value === 'auto' ? undefined : output.display });
              resync();
            }}
          >
            <option value="auto">Automatic{!output.display && shownOn ? ` (${shownOn.label})` : ''}</option>
            <optgroup label="Connected screens">
              {displays.map((d) => (
                <option key={refKey(d)} value={refKey(d)}>
                  {d.label} — {describeDisplay(d)}
                  {d.current ? ' (this screen)' : ''}
                </option>
              ))}
            </optgroup>
            {output.display && !connected && <option value={value}>Disconnected: {output.display.label}</option>}
          </select>
        </label>
        <label className="field">
          Output Target
          <select value="full" disabled>
            <option value="full">Full</option>
          </select>
        </label>
      </div>
      <div className="sc-hw-grid">
        <div className="sc-info">
          {shownOn ? (
            <>
              <Info label="Name">{shownOn.label}</Info>
              <Info label="Size">
                {shownOn.width} x {shownOn.height}
                {shownOn.refresh ? ` @ ${Math.round(shownOn.refresh)} Hz` : ''}
              </Info>
              {shownOn.internal !== undefined && (
                <Info label="Connection">{shownOn.internal ? 'Built-in display' : 'External (HDMI, DisplayPort, USB-C…)'}</Info>
              )}
            </>
          ) : output.display ? (
            <>
              <Info label="Name">{output.display.label}</Info>
              <Info label="Size">
                {output.display.width} x {output.display.height}
              </Info>
              <Info label="Connection">Not connected</Info>
            </>
          ) : (
            <Info label="Screen">No spare screen; shows in a window</Info>
          )}
          <Info label="Status">
            <span className={`sc-status ${status.tone}`}>{status.text}</span>
          </Info>
        </div>
        <label className="sc-delay">
          Video Delay
          <input
            type="number"
            min={0}
            max={120}
            value={output.delayFrames}
            onChange={(e) => update({ delayFrames: Math.max(0, Math.min(120, Math.round(Number(e.target.value) || 0))) })}
          />
          frames
        </label>
      </div>
      <ScreenAccessNote access={access} count={displays.length} />
    </div>
  );
}

function ScreenAccessNote({ access, count }: { access: string; count: number }) {
  if (access === 'prompt')
    return (
      <div className="sc-note">
        <span>Let Lumen see the screens connected to this computer (HDMI, DisplayPort, USB-C, AirPlay) so outputs can go to them.</span>
        <button className="btn primary small" onClick={() => void requestScreenAccess()}>
          Detect Screens
        </button>
      </div>
    );
  if (access === 'denied')
    return (
      <div className="sc-note warn">
        Screen access is blocked. Allow “Window management” for this site in the browser’s site settings, or use the Lumen desktop app.
      </div>
    );
  if (access === 'unsupported')
    return (
      <div className="sc-note warn">
        This browser can’t list connected screens. Use Chrome or Edge, or the Lumen desktop app, to send outputs to HDMI screens. You can
        still drag an output window to the projector and double-click it for fullscreen.
      </div>
    );
  return (
    <div className="sc-note ok">
      {count} screen{count === 1 ? '' : 's'} detected. Plug in a TV or projector and it appears here
      {access === 'desktop' ? ' straight away' : ''}.
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="sc-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="sc-slider-value">{format(value)}</span>
    </label>
  );
}

function ColorTab({ color, update }: { color: OutputColor; update: (c: OutputColor) => void }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="sc-color-tab">
      <Slider
        label="Brightness"
        value={color.brightness}
        min={0}
        max={2}
        step={0.01}
        format={pct}
        onChange={(brightness) => update({ ...color, brightness })}
      />
      <Slider
        label="Contrast"
        value={color.contrast}
        min={0}
        max={2}
        step={0.01}
        format={pct}
        onChange={(contrast) => update({ ...color, contrast })}
      />
      <Slider
        label="Saturation"
        value={color.saturation}
        min={0}
        max={2}
        step={0.01}
        format={pct}
        onChange={(saturation) => update({ ...color, saturation })}
      />
      <Slider
        label="Hue"
        value={color.hue}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${v}°`}
        onChange={(hue) => update({ ...color, hue })}
      />
      <div className="button-row sc-reset">
        <button className="btn small" onClick={() => update({ ...DEFAULT_COLOR })}>
          Reset
        </button>
        <span className="muted small-print">Adjusts only this output, e.g. to match a projector to the TVs.</span>
      </div>
    </div>
  );
}

const CORNERS: [keyof CornerPin, string][] = [
  ['tl', 'Top Left'],
  ['tr', 'Top Right'],
  ['bl', 'Bottom Left'],
  ['br', 'Bottom Right'],
];

function CornerPinTab({ pin, width, height, update }: { pin: CornerPin; width: number; height: number; update: (p: CornerPin) => void }) {
  const W = 360;
  const H = (W * height) / width;
  const pad = 40;
  const clamp = (v: number) => Math.max(-0.5, Math.min(1.5, v));
  const drag = (corner: keyof CornerPin) => (e: ReactPointerEvent) => {
    e.preventDefault();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const move = (ev: PointerEvent) => {
      // Screen to SVG coordinates, which stay right however the preview is scaled.
      const m = svg.getScreenCTM()?.inverse();
      if (!m) return;
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
      const x = clamp((p.x - pad) / W);
      const y = clamp((p.y - pad) / H);
      update({ ...pin, [corner]: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pt = (k: keyof CornerPin) => `${pad + pin[k].x * W},${pad + pin[k].y * H}`;

  return (
    <div className="sc-pin">
      <svg className="sc-pin-preview" viewBox={`0 0 ${W + pad * 2} ${H + pad * 2}`}>
        <rect x={pad} y={pad} width={W} height={H} className="sc-pin-frame" />
        <polygon points={[pt('tl'), pt('tr'), pt('br'), pt('bl')].join(' ')} className="sc-pin-quad" />
        {CORNERS.map(([k]) => (
          <circle key={k} cx={pad + pin[k].x * W} cy={pad + pin[k].y * H} r={9} className="sc-pin-handle" onPointerDown={drag(k)} />
        ))}
      </svg>
      <div className="sc-pin-fields">
        {CORNERS.map(([k, label]) => (
          <div key={k} className="sc-pin-corner">
            <span>{label}</span>
            <input
              type="number"
              value={Math.round(pin[k].x * width)}
              onChange={(e) => update({ ...pin, [k]: { ...pin[k], x: (Number(e.target.value) || 0) / width } })}
              aria-label={`${label} X`}
            />
            <input
              type="number"
              value={Math.round(pin[k].y * height)}
              onChange={(e) => update({ ...pin, [k]: { ...pin[k], y: (Number(e.target.value) || 0) / height } })}
              aria-label={`${label} Y`}
            />
          </div>
        ))}
        <div className="button-row sc-reset">
          <button className="btn small" onClick={() => update(structuredClone(DEFAULT_PIN))}>
            Reset
          </button>
          <span className="muted small-print">Drag the corners to straighten a projector that hits the screen at an angle.</span>
        </div>
      </div>
    </div>
  );
}

function AlphaKeyTab({ value, update }: { value: ScreenOutput['alphaKey']; update: (v: ScreenOutput['alphaKey']) => void }) {
  const options: [ScreenOutput['alphaKey'], string, string][] = [
    ['off', 'Off', 'The full picture, backgrounds included.'],
    ['fill', 'Fill', 'Lyrics, messages and logo without backgrounds, on black. Pair with a Key output.'],
    ['key', 'Key', 'A white silhouette of the lyrics on black, for a video switcher’s luma or alpha key.'],
  ];
  return (
    <div className="sc-key">
      {options.map(([v, label, help]) => (
        <label key={v} className={`sc-key-option ${value === v ? 'on' : ''}`}>
          <input type="radio" name="alpha-key" checked={value === v} onChange={() => update(v)} />
          <span>
            <b>{label}</b>
            <span className="muted">{help}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const PATTERNS: [TestPattern, string][] = [
  ['bars', 'Color Bars'],
  ['grid', 'Grid'],
  ['checker', 'Checkerboard'],
  ['gradient', 'Gradient'],
  ['white', 'White'],
  ['black', 'Black'],
];

function TestPatterns({ screens }: { screens: ScreenConfig[] }) {
  const test = useStore((s) => s.screenTools.testPattern);
  const s = useStore.getState();
  const [target, setTarget] = useState<string>(test?.screenId ?? '');
  return (
    <div className="test-patterns">
      <div className="pop-title">Test Patterns</div>
      <div className="test-grid">
        {PATTERNS.map(([p, label]) => (
          <button
            key={p}
            className={`btn small ${test?.pattern === p ? 'on' : ''}`}
            onClick={() => s.setScreenTools({ testPattern: { pattern: p, screenId: target || null } })}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="pop-row">
        Show on
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            if (test) s.setScreenTools({ testPattern: { ...test, screenId: e.target.value || null } });
          }}
        >
          <option value="">All screens</option>
          {screens.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="pop-foot">
        <span className="muted">Test patterns cover everything until turned off.</span>
        <button className="btn small" disabled={!test} onClick={() => s.setScreenTools({ testPattern: null })}>
          Off
        </button>
      </div>
    </div>
  );
}
