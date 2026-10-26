import { useEffect, useRef, useState } from 'react';
import { registerFonts } from '../fonts';
import { useRemoteFrame } from '../sync';
import type { FontMeta } from '../types';
import { OutputView } from './Canvas';

/** Shared behaviour for output windows: hide the cursor when idle, double-click for fullscreen. */
export function useOutputWindowChrome(title: string) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    document.title = title;
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
  }, [title]);
  return idle;
}

/** Loads the fonts the operator added, so slides render in them here too. */
export function useFrameFonts(frame: { fonts: FontMeta[] } | null) {
  const latest = useRef(frame?.fonts);
  latest.current = frame?.fonts;
  // Frames arrive constantly; only react when the set of fonts changes.
  const ids = frame?.fonts.map((f) => f.id).join(',');
  useEffect(() => {
    if (latest.current) void registerFonts(latest.current);
  }, [ids]);
}

export default function OutputApp() {
  const frame = useRemoteFrame();
  useFrameFonts(frame);
  const idle = useOutputWindowChrome('Lumen · Audience');
  return (
    <div className={`output-window ${idle ? 'idle' : ''}`}>
      <OutputView frame={frame} muted={!window.lumenDesktop} />
      {!idle && !window.lumenDesktop && <div className="output-hint">Double-click for fullscreen</div>}
      {!frame && <div className="output-waiting">Waiting for the Lumen control window…</div>}
    </div>
  );
}
