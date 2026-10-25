import { useEffect, useState } from 'react';
import { useRemoteFrame } from '../frame';
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

export default function OutputApp() {
  const frame = useRemoteFrame();
  const idle = useOutputWindowChrome('Lumen · Audience');
  return (
    <div className={`output-window ${idle ? 'idle' : ''}`}>
      <OutputView frame={frame} muted={!window.lumenDesktop} />
      {!idle && !window.lumenDesktop && <div className="output-hint">Double-click for fullscreen</div>}
      {!frame && <div className="output-waiting">Waiting for the Lumen control window…</div>}
    </div>
  );
}
