import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { requestScreenAccess, setScreensEnabled, syncBrowserWindows, useDisplays } from '../outputs';
import {
  DEFAULT_COLOR,
  DEFAULT_PIN,
  describeTarget,
  findDisplay,
  hostKey,
  isGrouped,
  planOutputs,
  screenLayout,
  signalSize,
  TARGET_GRIDS,
  targetRect,
  toDisplayRef,
  usedOutputs,
  type DetectedDisplay,
  type PlannedOutput,
} from '../screens';
import { useStore } from '../store';
import type { CornerPin, OutputColor, OutputTarget, ScreenConfig, ScreenKind, ScreenMode, ScreenOutput, TestPattern } from '../types';
import { MenuSelect, type MenuEntry } from './MenuSelect';
import { Dialog, IconButton, Popover } from './ui';

const desktop = () => !!window.lumenDesktop;
const IS_MAC = window.lumenDesktop ? window.lumenDesktop.platform === 'darwin' : /Mac/.test(navigator.platform);
/** In a browser, windows only open during a click, so changes that move outputs re-sync right away. */
const resync = () => {
  if (!desktop()) syncBrowserWindows();
};

const refKey = (d: { label: string; width: number; height: number }) => `${d.label}|${d.width}x${d.height}`;

const MODES: [ScreenMode, string][] = [
  ['single', 'Single'],
  ['mirror', 'Mirror'],
  ['grouped', 'Grouped'],
  ['blend', 'Edge Blend'],
];

const PLACEHOLDER_SIZES: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [3840, 2160],
  [1024, 768],
];

type Status = { text: string; tone: 'ok' | 'warn' | 'idle' };

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="sc-outputs">
      {label}
      <span className="sc-stepper">
        <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
          −
        </button>
        <span>{value}</span>
        <button onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
          +
        </button>
      </span>
    </span>
  );
}

function statusOf(p: PlannedOutput | undefined, openHosts: string[], enabled: boolean): Status {
  if (!p) return { text: '', tone: 'idle' };
  if (p.status === 'placeholder') return { text: 'Placeholder · not shown', tone: 'idle' };
  if (p.status === 'disconnected') return { text: 'Disconnected', tone: 'warn' };
  if (openHosts.includes(hostKey(p))) return { text: p.status === 'window' ? 'Showing in a window' : 'Showing', tone: 'ok' };
  if (!enabled) return { text: 'Screen off', tone: 'idle' };
  return { text: desktop() ? 'Opening…' : 'Click the screen switch to show', tone: 'idle' };
}

function tileLabel(output: ScreenOutput, p: PlannedOutput | undefined) {
  if (output.placeholder) return 'Placeholder';
  if (output.display) return output.display.label;
  return p?.display ? `Automatic · ${p.display.label}` : 'Automatic';
}

/** A small map of how the displays are arranged, with one highlighted, like the thumbnails in ProPresenter's Output menu. */
function DisplayMap({ displays, highlight }: { displays: DetectedDisplay[]; highlight: DetectedDisplay }) {
  const placed = displays.map((d) => ({ d, x: d.left ?? 0, y: d.top ?? 0, w: d.width / (d.scale ?? 1), h: d.height / (d.scale ?? 1) }));
  const known = displays.every((d) => d.left !== undefined);
  const shown = known ? placed : placed.filter((p) => p.d === highlight);
  const minX = Math.min(...shown.map((p) => p.x));
  const minY = Math.min(...shown.map((p) => p.y));
  const W = Math.max(...shown.map((p) => p.x + p.w)) - minX;
  const H = Math.max(...shown.map((p) => p.y + p.h)) - minY;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  // Fit the arrangement inside the 16:9 thumbnail.
  const wide = W / H > 16 / 9;
  return (
    <span
      className="display-map"
      aria-hidden="true"
      style={{ aspectRatio: `${W} / ${H}`, width: wide ? '92%' : undefined, height: wide ? undefined : '88%' }}
    >
      {shown.map((p, i) => (
        <span
          key={i}
          className={p.d === highlight ? 'on' : ''}
          style={{ left: pct(p.x - minX, W), top: pct(p.y - minY, H), width: pct(p.w, W), height: pct(p.h, H) }}
        />
      ))}
    </span>
  );
}

export function ScreenConfigDialog({ onClose }: { onClose: () => void }) {
  const setup = useStore((s) => s.screens);
  const tools = useStore((s) => s.screenTools);
  const displays = useDisplays((s) => s.displays);
  const access = useDisplays((s) => s.access);
  const openHosts = useDisplays((s) => s.openHosts);
  const s = useStore.getState();
  const [selectedId, setSelectedId] = useState<string | undefined>(setup.screens[0]?.id);
  const [outputId, setOutputId] = useState<string | undefined>();
  const [testOpen, setTestOpen] = useState(false);

  const screen = setup.screens.find((x) => x.id === selectedId) ?? setup.screens[0];
  const used = screen ? usedOutputs(screen) : [];
  const output = used.find((o) => o.id === outputId) ?? used[0];
  const plan = planOutputs(setup, displays);
  const planFor = (o: ScreenOutput) => plan.find((p) => p.output.id === o.id);
  const enabledFor = (kind: ScreenKind) => (kind === 'audience' ? setup.audienceEnabled : setup.stageEnabled);

  const setMode = (sc: ScreenConfig, mode: ScreenMode) => {
    s.updateScreen(sc.id, { mode });
    // Grouping takes at least two outputs.
    if ((mode === 'grouped' || mode === 'blend') && sc.outputs.length < 2) s.setOutputCount(sc.id, 2);
    resync();
  };

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
          const states = usedOutputs(x).map((o) => statusOf(planFor(o), openHosts, enabledFor(kind)).tone);
          const tone = states.includes('warn') ? 'warn' : states.includes('ok') ? 'ok' : 'idle';
          const size = screenLayout(x);
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
                  {size.width} x {size.height}
                </span>
              </span>
            </button>
          );
        })}
    </section>
  );

  const tile = (o: ScreenOutput, style?: CSSProperties) => {
    const p = planFor(o);
    const st = statusOf(p, openHosts, enabledFor(screen.kind));
    return (
      <button
        key={o.id}
        className={`sc-tile ${o.id === output?.id ? 'selected' : ''} ${p?.status ?? ''}`}
        style={style}
        onClick={() => setOutputId(o.id)}
      >
        <span className="sc-tile-name">{o.display || o.placeholder || p?.display ? tileLabel(o, p) : 'Unconfigured'}</span>
        <span className={`sc-tile-status ${st.tone}`}>{st.text}</span>
      </button>
    );
  };

  const layout = screen ? screenLayout(screen) : undefined;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

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

        {screen && output && layout ? (
          <section className="sc-main">
            <ScreenHeader
              screen={screen}
              canRemove={setup.screens.filter((x) => x.kind === screen.kind).length > 1 || screen.kind === 'stage'}
              onRemoved={() => setSelectedId(undefined)}
            />
            <div className="sc-row">
              <MenuSelect
                label="Screen mode"
                className="sc-mode"
                value={screen.mode}
                entries={MODES.map(([value, label]) => ({ type: 'item', value, label }))}
                onChange={(v) => setMode(screen, v as ScreenMode)}
              />
              {isGrouped(screen) && (
                <Stepper
                  label="Columns"
                  value={layout.cols}
                  min={1}
                  max={used.length}
                  onChange={(columns) => (s.updateScreen(screen.id, { columns }), resync())}
                />
              )}
              {screen.mode === 'blend' && (
                <>
                  <label className="sc-inline">
                    Overlap
                    <input
                      type="number"
                      min={0}
                      max={Math.floor(Math.min(screen.width, screen.height) / 2)}
                      value={screen.blend.overlap}
                      onChange={(e) =>
                        s.updateScreen(screen.id, {
                          blend: { ...screen.blend, overlap: Math.max(0, Math.round(Number(e.target.value) || 0)) },
                        })
                      }
                      aria-label="Overlap in pixels"
                    />
                    px
                  </label>
                  <label className="sc-inline" title="Your projectors' gamma; 2.2 suits most">
                    Gamma
                    <input
                      type="number"
                      min={1}
                      max={3}
                      step={0.1}
                      value={screen.blend.gamma}
                      onChange={(e) =>
                        s.updateScreen(screen.id, {
                          blend: { ...screen.blend, gamma: Math.max(1, Math.min(3, Number(e.target.value) || 2.2)) },
                        })
                      }
                      aria-label="Gamma"
                    />
                  </label>
                </>
              )}
              <span className="sc-spacer" />
              {screen.mode !== 'single' && (
                <Stepper
                  label="Outputs"
                  value={screen.outputs.length}
                  min={1}
                  max={8}
                  onChange={(n) => (s.setOutputCount(screen.id, n), resync())}
                />
              )}
            </div>
            {isGrouped(screen) ? (
              <div className="sc-tiles grouped">
                {/* The outputs where they sit in the combined picture; blended ones overlap. */}
                <div
                  className={`sc-layout ${screen.mode}`}
                  style={{
                    width: `min(100%, ${(150 * layout.width) / layout.height}px)`,
                    aspectRatio: `${layout.width} / ${layout.height}`,
                  }}
                >
                  {used.map((o, i) => {
                    const r = layout.rects[i];
                    return tile(o, {
                      left: pct(r.x, layout.width),
                      top: pct(r.y, layout.height),
                      width: pct(r.width, layout.width),
                      height: pct(r.height, layout.height),
                    });
                  })}
                </div>
              </div>
            ) : (
              <div className="sc-tiles">{used.map((o) => tile(o))}</div>
            )}
            <OutputSettings
              screen={screen}
              output={output}
              planned={planFor(output)}
              plan={plan}
              displays={displays}
              access={access}
              status={statusOf(planFor(output), openHosts, enabledFor(screen.kind))}
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
  const size = screenLayout(screen);
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
          {size.width} x {size.height}
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
  plan,
  displays,
  access,
  status,
}: {
  screen: ScreenConfig;
  output: ScreenOutput;
  planned?: PlannedOutput;
  plan: PlannedOutput[];
  displays: DetectedDisplay[];
  access: ReturnType<typeof useDisplays.getState>['access'];
  status: Status;
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
          <HardwareTab
            screen={screen}
            output={output}
            planned={planned}
            plan={plan}
            displays={displays}
            access={access}
            status={status}
            update={update}
          />
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

const unavailable = (text: string): MenuEntry[] => [{ type: 'note', text }];

function HardwareTab({
  screen,
  output,
  planned,
  plan,
  displays,
  access,
  status,
  update,
}: {
  screen: ScreenConfig;
  output: ScreenOutput;
  planned?: PlannedOutput;
  plan: PlannedOutput[];
  displays: DetectedDisplay[];
  access: string;
  status: Status;
  update: (patch: Partial<ScreenOutput>) => void;
}) {
  const connected = output.display ? findDisplay(output.display, displays) : undefined;
  const shownOn = planned?.display;
  const signal = signalSize({ screen, output, display: shownOn });
  // Other outputs on the same display, e.g. the other half of a 2 x 1 signal.
  const sharing =
    planned?.status === 'display' ? plan.filter((p) => p !== planned && p.status === 'display' && hostKey(p) === hostKey(planned)) : [];
  const t = output.target;

  const outputValue = output.placeholder
    ? 'placeholder'
    : output.display
      ? connected
        ? `display:${refKey(connected)}`
        : 'disconnected'
      : 'auto';
  const outputEntries: MenuEntry[] = [
    {
      type: 'item',
      value: 'auto',
      label: 'Automatic',
      detail: !output.display && !output.placeholder && shownOn ? shownOn.label : undefined,
    },
    { type: 'header', label: 'System' },
    ...displays.map((d): MenuEntry => ({
      type: 'item',
      value: `display:${refKey(d)}`,
      label: d.label,
      detail: `(${d.width} x ${d.height})${d.current ? ' · Lumen is on this screen' : ''}`,
      thumbnail: <DisplayMap displays={displays} highlight={d} />,
    })),
    { type: 'header', label: 'NDI' },
    {
      type: 'submenu',
      label: 'New NDI',
      entries: unavailable(
        'NDI output isn’t in Lumen yet. To send Lumen over NDI today, capture an output window with NDI Tools’ Screen Capture or OBS.',
      ),
    },
    ...(IS_MAC
      ? ([
          { type: 'header', label: 'Syphon' },
          {
            type: 'submenu',
            label: 'New Syphon',
            entries: unavailable('Syphon output isn’t in Lumen yet. OBS and other apps can capture an output window in the meantime.'),
          },
        ] satisfies MenuEntry[])
      : []),
    { type: 'header', label: 'Placeholder' },
    ...(output.placeholder
      ? [
          {
            type: 'item',
            value: 'placeholder',
            label: 'Placeholder',
            detail: `(${output.placeholder.width} x ${output.placeholder.height})`,
          } satisfies MenuEntry,
        ]
      : []),
    {
      type: 'submenu',
      label: 'New Placeholder',
      entries: PLACEHOLDER_SIZES.map(([w, h]): MenuEntry => ({ type: 'item', value: `placeholder:${w}x${h}`, label: `${w} x ${h}` })),
    },
    ...(output.display && !connected
      ? [{ type: 'item', value: 'disconnected', label: `Disconnected: ${output.display.label}` } satisfies MenuEntry]
      : []),
  ];

  const pickOutput = (v: string) => {
    if (v === 'auto') update({ display: undefined, placeholder: undefined });
    else if (v.startsWith('display:')) {
      const d = displays.find((x) => `display:${refKey(x)}` === v);
      if (d) update({ display: toDisplayRef(d), placeholder: undefined });
    } else if (v.startsWith('placeholder:')) {
      const [width, height] = v.slice('placeholder:'.length).split('x').map(Number);
      update({ placeholder: { width, height }, display: undefined });
    } else return;
    resync();
  };

  const targetValue = t.type === 'grid' ? `${t.cols}x${t.rows}` : t.type;
  const targetEntries: MenuEntry[] = [
    { type: 'item', value: 'full', label: 'Full' },
    { type: 'separator' },
    ...TARGET_GRIDS.map(([c, r]): MenuEntry => ({ type: 'item', value: `${c}x${r}`, label: `${c} x ${r}` })),
    { type: 'separator' },
    { type: 'item', value: 'custom', label: 'Custom' },
  ];
  /** Regions of a cols x rows split that other outputs on this display already fill. */
  const takenCells = (cols: number, rows: number) =>
    new Map(
      sharing.flatMap((p) => {
        const o = p.output.target;
        return o.type === 'grid' && o.cols === cols && o.rows === rows ? [[o.cell, p.screen.name] as [number, string]] : [];
      }),
    );
  const pickTarget = (v: string) => {
    const r = targetRect(t, signal);
    let target: OutputTarget;
    if (v === 'full') target = { type: 'full' };
    else if (v === 'custom')
      target = {
        type: 'custom',
        x: Math.round(r.x * signal.width),
        y: Math.round(r.y * signal.height),
        width: Math.round(r.width * signal.width),
        height: Math.round(r.height * signal.height),
      };
    else {
      const [cols, rows] = v.split('x').map(Number);
      const taken = takenCells(cols, rows);
      const cell = Array.from({ length: cols * rows }, (_, i) => i).find((i) => !taken.has(i)) ?? 0;
      target = { type: 'grid', cols, rows, cell };
    }
    update({ target });
    resync();
  };
  const setCustom = (patch: Partial<Extract<OutputTarget, { type: 'custom' }>>) => {
    if (t.type === 'custom') update({ target: { ...t, ...patch } });
  };

  return (
    <div className="sc-hardware">
      <div className="sc-hw-grid">
        <div className="sc-hw-col">
          <div className="field">
            Output
            <MenuSelect
              label="Output"
              className="sc-output-menu"
              value={outputValue}
              entries={outputEntries}
              onChange={pickOutput}
              display={output.placeholder ? `Placeholder (${output.placeholder.width} x ${output.placeholder.height})` : undefined}
            />
          </div>
          <div className="sc-info">
            {output.placeholder ? (
              <>
                <Info label="Name">Placeholder</Info>
                <Info label="Size">
                  {output.placeholder.width} x {output.placeholder.height}
                </Info>
              </>
            ) : shownOn ? (
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
            {sharing.length > 0 && <Info label="Shared with">{[...new Set(sharing.map((p) => p.screen.name))].join(', ')}</Info>}
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
        <div className="sc-hw-col">
          <div className="field">
            Output Target
            <MenuSelect
              label="Output Target"
              className="sc-target-menu"
              value={targetValue}
              entries={targetEntries}
              onChange={pickTarget}
            />
          </div>
          {t.type === 'grid' && (
            <div className="sc-target-detail">
              <span className="muted small-print">The part of the {describeTarget(t)} signal this output fills:</span>
              <div
                className="sc-cells"
                style={{ gridTemplateColumns: `repeat(${t.cols}, 1fr)`, aspectRatio: `${signal.width} / ${signal.height}` }}
              >
                {Array.from({ length: t.cols * t.rows }, (_, i) => {
                  const other = takenCells(t.cols, t.rows).get(i);
                  return (
                    <button
                      key={i}
                      className={`sc-cell ${t.cell === i ? 'on' : ''} ${other ? 'taken' : ''}`}
                      onClick={() => (update({ target: { ...t, cell: i } }), resync())}
                      aria-pressed={t.cell === i}
                      title={other ? `Also used by ${other}` : undefined}
                    >
                      <b>{i + 1}</b>
                      {other && t.cell !== i && <span>{other}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {t.type === 'custom' && (
            <div className="sc-target-detail">
              <span className="muted small-print">
                Region of the {signal.width} x {signal.height} signal, in pixels:
              </span>
              <div className="sc-custom">
                {(['x', 'y', 'width', 'height'] as const).map((k) => (
                  <label key={k}>
                    {k === 'x' ? 'X' : k === 'y' ? 'Y' : k === 'width' ? 'Width' : 'Height'}
                    <input
                      type="number"
                      min={k === 'width' || k === 'height' ? 1 : 0}
                      value={t[k]}
                      onChange={(e) =>
                        setCustom({ [k]: Math.max(k === 'width' || k === 'height' ? 1 : 0, Math.round(Number(e.target.value) || 0)) })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
          {t.type === 'full' && (
            <span className="muted small-print">
              Fills the whole signal. Split it with 2 x 1, 2 x 2 or 3 x 1 when a multi-display adapter (TripleHead2Go, Datapath) feeds
              several projectors from one output.
            </span>
          )}
        </div>
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
