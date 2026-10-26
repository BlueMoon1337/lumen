import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { colorFilter, cornerPinTransform } from '../screens';
import type { OutputFrame, ScreenConfig, ScreenKind, ScreenOutput, TestPattern } from '../types';

/** Which screen and output this window is, from its address ("#/output?screen=…&output=…"). */
function outputParams() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  return { screenId: q.get('screen'), outputId: q.get('output') };
}

export function useOutputConfig(
  frame: OutputFrame | null,
  kind: ScreenKind,
): { screen?: ScreenConfig; output?: ScreenOutput; index: number } {
  const { screenId, outputId } = useMemo(outputParams, []);
  const screens = frame?.screens.screens ?? [];
  const screen = screens.find((s) => s.id === screenId) ?? screens.find((s) => s.kind === kind);
  const index = Math.max(0, screen?.outputs.findIndex((o) => o.id === outputId) ?? 0);
  return { screen, output: screen?.outputs[index], index };
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

const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];

export function TestPatternView({ pattern, label }: { pattern: TestPattern; label?: string }) {
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
  // Alignment grid: edges, thirds, a centre circle and crosshair, for lining up projectors.
  const cols = Array.from({ length: 15 }, (_, i) => ((i + 1) * 1920) / 16);
  const rows = Array.from({ length: 8 }, (_, i) => ((i + 1) * 1080) / 9);
  return (
    <svg className="test-pattern" viewBox="0 0 1920 1080" preserveAspectRatio="none">
      <rect width="1920" height="1080" fill="#000" />
      <g stroke="#555" strokeWidth="2">
        {cols.map((x) => (
          <line key={`x${x}`} x1={x} x2={x} y1={0} y2={1080} />
        ))}
        {rows.map((y) => (
          <line key={`y${y}`} y1={y} y2={y} x1={0} x2={1920} />
        ))}
      </g>
      <rect x="2" y="2" width="1916" height="1076" fill="none" stroke="#fff" strokeWidth="4" />
      <g stroke="#f5c518" strokeWidth="3" fill="none">
        <circle cx="960" cy="540" r="420" />
        <line x1="960" x2="960" y1="0" y2="1080" />
        <line x1="0" x2="1920" y1="540" y2="540" />
        <line x1="0" y1="0" x2="1920" y2="1080" />
        <line x1="1920" y1="0" x2="0" y2="1080" />
      </g>
      <text x="960" y="520" fill="#fff" fontSize="56" fontFamily="system-ui, sans-serif" textAnchor="middle">
        {label ?? 'Lumen'}
      </text>
      <text x="960" y="600" fill="#aaa" fontSize="36" fontFamily="system-ui, sans-serif" textAnchor="middle">
        {window.innerWidth * devicePixelRatio} × {window.innerHeight * devicePixelRatio}
      </text>
    </svg>
  );
}

/**
 * Wraps an output window's picture with that output's settings: video delay,
 * color, corner pin, and the Identify overlay and test patterns.
 */
export function OutputSurface({
  frame,
  kind,
  render,
}: {
  frame: OutputFrame | null;
  kind: ScreenKind;
  render: (frame: OutputFrame | null, options: { screenColor?: string; alphaKey: ScreenOutput['alphaKey'] }) => ReactNode;
}) {
  const { screen, output, index } = useOutputConfig(frame, kind);
  // Settings and tools apply at once; only the picture is delayed.
  const shown = useDelayed(frame, ((output?.delayFrames ?? 0) * 1000) / 60);
  const { w, h } = useWindowSize();
  const transform = output ? cornerPinTransform(output.cornerPin, w, h) : undefined;
  const filter = output ? colorFilter(output.color) : undefined;
  const tools = frame?.screenTools;
  const test = tools?.testPattern;
  const pattern = test && (!test.screenId || test.screenId === screen?.id) ? test.pattern : null;

  useEffect(() => {
    if (screen) document.title = `Lumen · ${screen.name}${screen.outputs.length > 1 ? ` (${index + 1})` : ''}`;
  }, [screen, index]);

  return (
    <div className="output-surface" style={{ filter, transform, transformOrigin: '0 0' }}>
      {render(shown, { screenColor: screen?.screenColor, alphaKey: kind === 'audience' ? (output?.alphaKey ?? 'off') : 'off' })}
      {pattern && <TestPatternView pattern={pattern} label={screen?.name} />}
      {tools?.identify && screen && (
        <div className="identify-overlay">
          <div className="identify-card">
            <div className="identify-name">{screen.name}</div>
            <div className="identify-detail">
              {kind === 'audience' ? 'Audience' : 'Stage'}
              {screen.outputs.length > 1 ? ` · Output ${index + 1} of ${screen.outputs.length}` : ''}
              {output?.display ? ` · ${output.display.label}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
