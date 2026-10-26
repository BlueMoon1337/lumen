import { timerRemaining, useNow } from '../clock';
import { defaultThemes } from '../seed';
import type { OutputFrame, Theme } from '../types';
import { formatClock, formatDuration } from '../util';
import { ScaledCanvas, SlideText } from './Canvas';

const stageText = (overrides: Partial<Theme>): Theme => ({
  ...defaultThemes[0],
  fontWeight: 600,
  shadow: false,
  textAlign: 'left',
  verticalAlign: 'top',
  inset: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: 'none', color: '', color2: '' },
  ...overrides,
});

const currentTheme = stageText({ fontSize: 110, color: '#ffffff' });
const nextTheme = stageText({ fontSize: 64, color: '#fcd34d' });
const notesTheme = stageText({ fontSize: 40, fontWeight: 400, color: '#93c5fd' });

/** The confidence monitor layout, on the same 1920x1080 canvas as the audience output. */
export function StageView({ frame }: { frame: OutputFrame | null }) {
  const now = useNow(500);
  const s = frame?.stage;
  const remaining = frame ? timerRemaining(frame.timer, now) : 0;
  const timerActive = !!frame && (frame.timer.running || frame.timer.remainingMs !== frame.timer.durationMs);
  return (
    <ScaledCanvas className="stage-view">
      <div className="stage">
        <header className="stage-header">
          <span className="stage-label">{s?.currentLabel ?? 'Nothing live'}</span>
          <span className="stage-clock">{formatClock(new Date(now))}</span>
        </header>
        {s?.message && <div className="stage-message">{s.message}</div>}
        <section className="stage-current">{s?.current && <SlideText text={s.current} theme={currentTheme} />}</section>
        <section className="stage-next">
          <div className="stage-section-label">Next{s?.nextLabel ? ` · ${s.nextLabel}` : ''}</div>
          <div className="stage-next-text">{s?.next && <SlideText text={s.next} theme={nextTheme} />}</div>
        </section>
        <footer className="stage-footer">
          <div className="stage-notes">{s?.notes && <SlideText text={s.notes} theme={notesTheme} />}</div>
          {timerActive && <div className={`stage-timer ${remaining < 0 ? 'over' : ''}`}>{formatDuration(remaining)}</div>}
        </footer>
      </div>
    </ScaledCanvas>
  );
}
