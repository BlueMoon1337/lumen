import { useEffect, useRef, useState } from 'react';
import { showIconInPage } from '../appIcons';
import { registerFonts } from '../fonts';
import { blendMask, colorFilter, cornerPinTransform, screenLayout, targetRect, usedOutputs } from '../screens';
import { useRemoteFrame } from '../sync';
import type { FontMeta, OutputFrame, ScreenConfig, ScreenKind, ScreenOutput, TestPattern } from '../types';
import { OutputView } from './Canvas';
import { StageView } from './StageView';

/** Shared behaviour for output windows: hide the cursor when idle, double-click for fullscreen. */
function useOutputWindowChrome(title: string) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    document.title = title;
  }, [title]);
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 2500);
    const onMove = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 2500);
    };
    const onDbl = () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('dblclick', onDbl);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('dblclick', onDbl);
    };
  }, []);
  return idle;
}

/** Loads the fonts the operator added, so slides render in them here too. */
function useFrameFonts(frame: { fonts: FontMeta[] } | null) {
  const latest = useRef(frame?.fonts);
  latest.current = frame?.fonts;
  // Frames arrive constantly; only react when the set of fonts changes.
  const ids = frame?.fonts.map((f) => f.id).join(',');
  useEffect(() => {
    if (latest.current) void registerFonts(latest.current);
  }, [ids]);
}

/** Holds each frame back by `ms`, in order; for lining the picture up with delayed video. */
function useDelayed<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (ms <= 0) return;
    const t = setTimeout(() => {
      timers.current.delete(t);
      setShown(value);
    }, ms);
    timers.current.add(t);
  }, [value, ms]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  return ms > 0 ? shown : value;
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

// ---- Which outputs this window shows ---------------------------------------------------

interface RouteEntry {
  screenId: string | null;
  outputId: string | null;
  kind?: ScreenKind;
}

interface HostRoute {
  /** Pixel size of the display's signal; unset for a plain full-window output. */
  size?: { width: number; height: number };
  entries: RouteEntry[];
  /** This window plays the audience output's sound. */
  audio: boolean;
}

/**
 * "#/screen?size=1920x1080&o=screen:output&o=…" lists the outputs on one display.
 * "#/output" and "#/stage" show the first audience or stage screen across the
 * whole window, for example as a browser source in streaming software.
 */
function readRoute(): HostRoute {
  const [route, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(query);
  const m = q.get('size')?.match(/^(\d+)x(\d+)$/);
  const entries: RouteEntry[] = q.getAll('o').map((v) => {
    const [screenId = null, outputId = null] = v.split(':');
    return { screenId, outputId };
  });
  if (!entries.length)
    entries.push({ screenId: q.get('screen'), outputId: q.get('output'), kind: route === 'stage' ? 'stage' : 'audience' });
  return { size: m ? { width: Number(m[1]), height: Number(m[2]) } : undefined, entries, audio: q.has('audio') || route === 'output' };
}

function useHostRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    // The operator window re-points this window when outputs move between displays.
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

interface Resolved {
  screen: ScreenConfig;
  output: ScreenOutput;
  index: number;
}

function resolve(frame: OutputFrame | null, entry: RouteEntry): Resolved | null {
  const screens = frame?.screens.screens ?? [];
  const screen = screens.find((s) => s.id === entry.screenId) ?? (entry.kind ? screens.find((s) => s.kind === entry.kind) : undefined);
  if (!screen) return null;
  const used = usedOutputs(screen);
  const index = Math.max(
    0,
    used.findIndex((o) => o.id === entry.outputId),
  );
  return used[index] ? { screen, output: used[index], index } : null;
}

// ---- Test patterns ----------------------------------------------------------------------

const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];

export function TestPatternView({
  pattern,
  label,
  width,
  height,
}: {
  pattern: TestPattern;
  label?: string;
  width?: number;
  height?: number;
}) {
  if (pattern === 'white' || pattern === 'black')
    return <div className="test-pattern" style={{ background: pattern === 'white' ? '#fff' : '#000' }} />;
  if (pattern === 'checker') return <div className="test-pattern checker-pattern" />;
  if (pattern === 'gradient')
    return (
      <div className="test-pattern" style={{ display: 'grid', gridTemplateRows: '1fr 1fr' }}>
        <div style={{ background: 'linear-gradient(90deg, #000, #fff)' }} />
        <div style={{ display: 'flex' }}>
          {Array.from({ length: 11 }, (_, i) => (
            <div key={i} style={{ flex: 1, background: `hsl(0 0% ${i * 10}%)` }} />
          ))}
        </div>
      </div>
    );
  if (pattern === 'bars')
    return (
      <div className="test-pattern" style={{ display: 'grid', gridTemplateRows: '67% 8% 25%' }}>
        <div style={{ display: 'flex' }}>
          {BARS.map((c) => (
            <div key={c} style={{ flex: 1, background: c }} />
          ))}
        </div>
        <div style={{ display: 'flex' }}>
          {['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'].map((c, i) => (
            <div key={i} style={{ flex: 1, background: c }} />
          ))}
        </div>
        <div style={{ display: 'flex' }}>
          {['#00214c', '#fff', '#32006a', '#131313', '#090909', '#131313', '#1d1d1d', '#131313'].map((c, i) => (
            <div key={i} style={{ flex: i === 0 || i === 1 || i === 2 ? 1.25 : 1, background: c }} />
          ))}
        </div>
      </div>
    );
  // Alignment grid with square cells, a round centre circle and crosshair at the screen's real proportions, for lining up projectors.
  const [W, H] = [width ?? 1920, height ?? 1080];
  const step = H / 9;
  const cols = Array.from({ length: Math.floor(W / step) }, (_, i) => W / 2 + (i - Math.floor(W / step / 2)) * step).filter(
    (x) => x > 0 && x < W,
  );
  const rows = Array.from({ length: 8 }, (_, i) => (i + 1) * step);
  const u = H / 1080;
  return (
    <svg className="test-pattern" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <rect width={W} height={H} fill="#000" />
      <g stroke="#555" strokeWidth={2 * u}>
        {cols.map((x) => (
          <line key={`x${x}`} x1={x} x2={x} y1={0} y2={H} />
        ))}
        {rows.map((y) => (
          <line key={`y${y}`} y1={y} y2={y} x1={0} x2={W} />
        ))}
      </g>
      <rect x={2 * u} y={2 * u} width={W - 4 * u} height={H - 4 * u} fill="none" stroke="#fff" strokeWidth={4 * u} />
      <g stroke="#f5c518" strokeWidth={3 * u} fill="none">
        <circle cx={W / 2} cy={H / 2} r={H * 0.39} />
        <line x1={W / 2} x2={W / 2} y1={0} y2={H} />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} />
        <line x1={0} y1={0} x2={W} y2={H} />
        <line x1={W} y1={0} x2={0} y2={H} />
      </g>
      <text x={W / 2} y={H / 2 - 20 * u} fill="#fff" fontSize={56 * u} fontFamily="system-ui, sans-serif" textAnchor="middle">
        {label ?? 'Lumen'}
      </text>
      <text x={W / 2} y={H / 2 + 60 * u} fill="#aaa" fontSize={36 * u} fontFamily="system-ui, sans-serif" textAnchor="middle">
        {W} × {H}
      </text>
    </svg>
  );
}

// ---- One output -------------------------------------------------------------------------

/**
 * One output in its part of the window, with its settings applied: its share
 * of a grouped screen, edge-blend fades, video delay, color and corner pin,
 * plus the Identify overlay and test patterns.
 */
function OutputRegion({
  frame,
  screen,
  output,
  index,
  signal,
  playsSound,
}: Resolved & { frame: OutputFrame | null; signal?: { width: number; height: number }; playsSound: boolean }) {
  const { w, h } = useWindowSize();
  const r = signal ? targetRect(output.target, signal) : { x: 0, y: 0, width: 1, height: 1 };
  const region = { left: r.x * w, top: r.y * h, width: r.width * w, height: r.height * h };
  // Settings and tools apply at once; only the picture is delayed.
  const shown = useDelayed(frame, (output.delayFrames * 1000) / 60);
  const layout = screenLayout(screen);
  const part = layout.rects[index] ?? layout.rects[0];
  const mask = blendMask(screen, index);
  const alphaKey = screen.kind === 'audience' ? output.alphaKey : 'off';
  const tools = frame?.screenTools;
  const test = tools?.testPattern;
  const pattern = test && (!test.screenId || test.screenId === screen.id) ? test.pattern : null;
  const outputs = usedOutputs(screen).length;

  return (
    <div className="output-region" style={region}>
      <div
        className="output-surface"
        style={{
          filter: colorFilter(output.color),
          transform: cornerPinTransform(output.cornerPin, region.width, region.height),
          transformOrigin: '0 0',
          maskImage: mask.length ? mask.join(', ') : undefined,
          maskComposite: mask.length > 1 ? 'intersect' : undefined,
        }}
      >
        {/* The whole screen, shifted so this output shows its part of it. */}
        <div
          className="screen-crop"
          style={{
            left: `${(-part.x / part.width) * 100}%`,
            top: `${(-part.y / part.height) * 100}%`,
            width: `${(layout.width / part.width) * 100}%`,
            height: `${(layout.height / part.height) * 100}%`,
            background: alphaKey === 'off' ? (screen.screenColor ?? '#000') : '#000',
          }}
        >
          {screen.kind === 'stage' ? (
            <StageView frame={shown} layout={shown?.stageLayouts?.[screen.id]} />
          ) : (
            <OutputView
              frame={shown}
              muted={!playsSound}
              screenColor={screen.screenColor}
              alphaKey={alphaKey}
              look={shown?.looks?.[screen.id]}
            />
          )}
          {pattern && <TestPatternView pattern={pattern} label={screen.name} width={layout.width} height={layout.height} />}
        </div>
        {tools?.identify && (
          <div className="identify-overlay">
            <div className="identify-card">
              <div className="identify-name">{screen.name}</div>
              <div className="identify-detail">
                {screen.kind === 'audience' ? 'Audience' : 'Stage'}
                {outputs > 1 ? ` · Output ${index + 1} of ${outputs}` : ''}
                {output.display ? ` · ${output.display.label}` : ''}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScreenHostApp() {
  const frame = useRemoteFrame();
  useFrameFonts(frame);
  const route = useHostRoute();
  const icon = frame?.appIcon;
  useEffect(() => {
    if (icon) showIconInPage(icon);
  }, [icon]);
  const shown = route.entries.map((e) => resolve(frame, e)).filter((r): r is Resolved => !!r);
  const title = shown.length ? `Lumen · ${[...new Set(shown.map((r) => r.screen.name))].join(' + ')}` : 'Lumen';
  const idle = useOutputWindowChrome(title);
  // Only one window, and in it one output, plays video sound (the desktop app's first audience output).
  const sounding = route.audio && window.lumenDesktop ? shown.find((r) => r.screen.kind === 'audience') : undefined;

  return (
    <div className={`output-window ${idle ? 'idle' : ''}`}>
      {shown.map((r) => (
        <OutputRegion key={`${r.screen.id}:${r.output.id}`} {...r} frame={frame} signal={route.size} playsSound={r === sounding} />
      ))}
      {!idle && !window.lumenDesktop && <div className="output-hint">Double-click for fullscreen</div>}
      {!frame && <div className="output-waiting">Waiting for the Lumen control window…</div>}
    </div>
  );
}
