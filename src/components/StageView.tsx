import { timerRemaining, useNow } from '../clock';
import { defaultThemes } from '../seed';
import { DEFAULT_STAGE_LAYOUTS, STAGE_KINDS } from '../stageLayouts';
import type { OutputFrame, StageLayout, StageObject, Theme } from '../types';
import { formatClock, formatDuration } from '../util';
import { ScaledCanvas, SlidePreview, SlideText } from './Canvas';

/** The theme a stage object's words draw in: its own size, color and alignment, filling its box. */
const objectTheme = (o: StageObject): Theme => ({
  ...defaultThemes[0],
  fontFamily: o.fontFamily ?? defaultThemes[0].fontFamily,
  fontSize: o.fontSize,
  fontWeight: o.fontWeight ?? 600,
  color: o.color,
  textAlign: o.textAlign,
  verticalAlign: o.verticalAlign,
  uppercase: !!o.uppercase,
  shadow: false,
  outline: 0,
  boxColor: '',
  inset: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: 'none', color: '', color2: '' },
  captionBox: undefined,
});

/** What a stage object says now, or null for nothing (an empty slot). */
function objectText(o: StageObject, frame: OutputFrame | null, now: number): { text: string | null; over?: boolean } {
  const s = frame?.stage;
  switch (o.kind) {
    case 'currentText':
      return { text: s?.current ?? null };
    case 'nextText':
      return { text: s?.next ?? null };
    case 'currentNotes':
      return { text: s?.notes ?? null };
    case 'nextNotes':
      return { text: s?.nextNotes ?? null };
    case 'groupName':
      return { text: s?.currentLabel ?? null };
    case 'title':
      return { text: s?.title ?? null };
    case 'message':
      return { text: s?.message ?? null };
    case 'text':
      return { text: o.text ?? '' };
    case 'clock':
      return { text: formatClock(new Date(now)) };
    case 'timer': {
      if (!frame) return { text: null };
      const left = timerRemaining(frame.timer, now);
      return { text: formatDuration(left), over: left < 0 };
    }
    case 'videoCountdown': {
      const clock = frame?.videoClock;
      const left = clock?.endsAt != null ? clock.endsAt - now : clock?.remainingMs;
      return { text: left == null ? null : formatDuration(Math.max(0, left)) };
    }
    default:
      return { text: null };
  }
}

function StageObjectView({ o, frame, now, samples }: { o: StageObject; frame: OutputFrame | null; now: number; samples: boolean }) {
  const kind = STAGE_KINDS[o.kind];
  const box = { left: o.x, top: o.y, width: o.width, height: o.height, background: o.fill || undefined };
  if (o.kind === 'shape') return <div className="stage-obj" style={box} />;
  if (o.kind === 'currentSlide' || o.kind === 'nextSlide') {
    const picture = o.kind === 'currentSlide' ? frame?.stage.currentSlide : frame?.stage.nextSlide;
    return (
      <div className="stage-obj stage-obj-picture" style={box}>
        {picture ? (
          <SlidePreview
            text={picture.text}
            caption={picture.caption}
            theme={picture.theme}
            background={picture.background}
            media={picture.media}
          />
        ) : (
          samples && <div className="stage-obj-sample">{kind.sample}</div>
        )}
        {o.showLabel && <div className="stage-obj-label">{kind.caption}</div>}
      </div>
    );
  }
  const { text, over } = objectText(o, frame, now);
  // The message shows only while there is one; other slots show a sample in the editor.
  if (o.kind === 'message' && !text && !samples) return null;
  const shown = text ?? (samples ? kind.sample : null);
  const theme = objectTheme(over ? { ...o, color: '#ff5a5a' } : o);
  return (
    <div className={`stage-obj ${!text && samples ? 'sample' : ''}`} style={box}>
      {shown && <SlideText text={shown} theme={theme} />}
      {o.showLabel && <div className="stage-obj-label">{kind.caption}</div>}
    </div>
  );
}

/**
 * A stage screen: its layout's objects (the slides' words, notes, clock, timers, the stage
 * message…) on the layout's canvas. `samples` fills empty objects with their names, for the
 * layout editor and its thumbnails.
 */
export function StageView({ frame, layout, samples = false }: { frame: OutputFrame | null; layout?: StageLayout; samples?: boolean }) {
  const now = useNow(500);
  const l = layout ?? DEFAULT_STAGE_LAYOUTS[0];
  return (
    <ScaledCanvas className="stage-view" width={l.width} height={l.height}>
      <div className="stage-layout" style={{ background: l.background ?? '#000' }}>
        {l.objects.map((o) => (
          <StageObjectView key={o.id} o={o} frame={frame} now={now} samples={samples} />
        ))}
      </div>
    </ScaledCanvas>
  );
}
