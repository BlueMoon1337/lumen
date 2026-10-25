import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { timerRemaining, useNow } from '../frame';
import { useMedia } from '../media';
import type { FrameBackground, OutputFrame, Theme } from '../types';
import { formatClock, formatDuration } from '../util';

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

/**
 * Lays out children on a 1920x1080 canvas and scales it to fit the parent,
 * so thumbnails, monitors and outputs all wrap text identically.
 */
export function ScaledCanvas({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(el.clientWidth / CANVAS_W, el.clientHeight / CANVAS_H));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`scaled-canvas ${className}`}>
      <div className="canvas" style={{ width: CANVAS_W, height: CANVAS_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {scale > 0 && children}
      </div>
    </div>
  );
}

const fitCache = new Map<string, number>();

function fitKey(text: string, caption: string | undefined, t: Theme) {
  return JSON.stringify([
    text,
    caption,
    t.fontFamily,
    t.fontSize,
    t.fontWeight,
    t.italic,
    t.uppercase,
    t.lineHeight,
    t.outline,
    t.inset,
    !!t.boxColor,
    t.captionScale,
  ]);
}

/** Slide text in a theme, shrunk from the theme's font size until it fits its box. */
export function SlideText({ text, caption, theme }: { text: string; caption?: string; theme: Theme }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const key = box && `${fitKey(text, caption, theme)}|${box.w}x${box.h}`;
  const [size, setSize] = useState(theme.fontSize);

  // The box is sized by the theme's insets on the fixed canvas, so it only
  // changes when the surrounding layout does (e.g. the stage message row).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () =>
      setBox((prev) => (prev?.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!key) return;
    const cached = fitCache.get(key);
    if (cached != null) return setSize(cached);
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const cs = getComputedStyle(box);
    const maxH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const maxW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const fits = (px: number) => {
      content.style.fontSize = `${px}px`;
      return content.scrollHeight <= maxH + 1 && content.scrollWidth <= maxW + 1;
    };
    let best = theme.fontSize;
    if (!fits(best)) {
      let lo = 8;
      let hi = theme.fontSize;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      best = lo;
    }
    content.style.fontSize = `${best}px`;
    fitCache.set(key, best);
    setSize(best);
  }, [key, theme.fontSize]);

  const { inset } = theme;
  const boxStyle: CSSProperties = {
    top: `${inset.top}%`,
    right: `${inset.right}%`,
    bottom: `${inset.bottom}%`,
    left: `${inset.left}%`,
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[theme.verticalAlign],
    background: theme.boxColor || undefined,
    padding: theme.boxColor ? '24px 48px' : 0,
  };
  const textStyle: CSSProperties = {
    fontSize: size,
    fontFamily: theme.fontFamily,
    fontWeight: theme.fontWeight,
    fontStyle: theme.italic ? 'italic' : 'normal',
    color: theme.color,
    textAlign: theme.textAlign,
    textTransform: theme.uppercase ? 'uppercase' : 'none',
    lineHeight: theme.lineHeight,
    textShadow: theme.shadow ? '0 0.04em 0.12em rgba(0,0,0,0.75)' : 'none',
    WebkitTextStroke: theme.outline ? `${theme.outline}px ${theme.outlineColor}` : undefined,
  };

  return (
    <div ref={boxRef} className="slide-box" style={boxStyle}>
      <div ref={contentRef} className="slide-content" style={textStyle}>
        <div className="slide-text">{text}</div>
        {caption && (
          <div className="slide-caption" style={{ fontSize: `${theme.captionScale}em` }}>
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaFill({ mediaId, muted }: { mediaId: string; muted: boolean }) {
  const media = useMedia(mediaId);
  if (!media) return null;
  return media.isVideo ? (
    <video className="media-fill" src={media.url} autoPlay loop muted={muted} playsInline />
  ) : (
    <img className="media-fill" src={media.url} alt="" />
  );
}

export function BackgroundFill({ bg, muted = true }: { bg: FrameBackground; muted?: boolean }) {
  switch (bg.kind) {
    case 'color':
      return <div className="fill" style={{ background: bg.color }} />;
    case 'gradient':
      return <div className="fill" style={{ background: `linear-gradient(135deg, ${bg.color}, ${bg.color2})` }} />;
    case 'media':
      return <MediaFill mediaId={bg.mediaId} muted={muted} />;
  }
}

interface Layer {
  id: number;
  key: string | null;
  node: ReactNode;
  leaving: boolean;
}

let layerSeq = 0;

/**
 * Transitions between children whenever `itemKey` changes. "cross" fades the
 * old content out while the new fades in; "over" fades the new content in on
 * top of the old, which avoids a dip to black between backgrounds.
 */
export function Transition({
  itemKey,
  duration,
  mode = 'cross',
  children,
}: {
  itemKey: string | null;
  duration: number;
  mode?: 'cross' | 'over';
  children: ReactNode;
}) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: layerSeq++, key: itemKey, node: children, leaving: false }]);
  const [shownKey, setShownKey] = useState(itemKey);
  const lastChildren = useRef(children);

  if (itemKey !== shownKey) {
    const outgoing = lastChildren.current;
    setShownKey(itemKey);
    setLayers((prev) => [
      ...prev.filter((l) => l.key !== itemKey).map((l) => (l.leaving ? l : { ...l, node: outgoing, leaving: true })),
      { id: layerSeq++, key: itemKey, node: null, leaving: false },
    ]);
  }

  useEffect(() => {
    lastChildren.current = children;
  });

  const hasLeaving = layers.some((l) => l.leaving);
  useEffect(() => {
    if (!hasLeaving) return;
    const t = setTimeout(() => setLayers((prev) => prev.filter((l) => !l.leaving)), duration + 50);
    return () => clearTimeout(t);
  }, [hasLeaving, layers, duration]);

  return (
    <>
      {layers.map((l) => (
        <div
          key={l.id}
          className={`layer ${l.leaving ? (mode === 'cross' ? 'fade-out' : '') : 'fade-in'}`}
          style={{ animationDuration: `${duration}ms` }}
        >
          {l.leaving ? l.node : children}
        </div>
      ))}
    </>
  );
}

export function resolveTokens(text: string, timer: OutputFrame['timer'], now: number) {
  return text
    .replace(/\{countdown\}/gi, formatDuration(Math.max(0, timerRemaining(timer, now))))
    .replace(/\{clock\}/gi, formatClock(new Date(now)));
}

function MessageBanner({ text, timer }: { text: string; timer: OutputFrame['timer'] }) {
  const now = useNow(500);
  return <div className="message-banner">{resolveTokens(text, timer, now)}</div>;
}

/** The audience picture, layer by layer. Used by the output window and the operator's monitor. */
export function OutputView({ frame, muted = true }: { frame: OutputFrame | null; muted?: boolean }) {
  const d = frame?.transitionMs ?? 400;
  return (
    <ScaledCanvas className="output-view">
      <div className="fill" style={{ background: '#000' }} />
      <Transition itemKey={frame?.background?.key ?? null} duration={d} mode="over">
        {frame?.background && <BackgroundFill bg={frame.background} muted={muted} />}
      </Transition>
      <Transition itemKey={frame?.slide?.key ?? null} duration={d}>
        {frame?.slide && <SlideText text={frame.slide.text} caption={frame.slide.caption} theme={frame.slide.theme} />}
      </Transition>
      <Transition itemKey={frame?.message?.key ?? null} duration={d}>
        {frame?.message && <MessageBanner text={frame.message.text} timer={frame.timer} />}
      </Transition>
      <Transition itemKey={frame?.logoMediaId ? `logo:${frame.logoMediaId}` : null} duration={d}>
        {frame?.logoMediaId && (
          <div className="fill logo-layer">
            <BackgroundFill bg={{ key: '', kind: 'media', mediaId: frame.logoMediaId }} muted={muted} />
          </div>
        )}
      </Transition>
    </ScaledCanvas>
  );
}

/** A static slide preview, used for thumbnails and theme swatches. */
export function SlidePreview({ text, caption, theme }: { text: string; caption?: string; theme: Theme }) {
  const bg = theme.background;
  const fill: FrameBackground | null =
    bg.type === 'color'
      ? { key: '', kind: 'color', color: bg.color }
      : bg.type === 'gradient'
        ? { key: '', kind: 'gradient', color: bg.color, color2: bg.color2 }
        : bg.type === 'media' && bg.mediaId
          ? { key: '', kind: 'media', mediaId: bg.mediaId }
          : null;
  return (
    <ScaledCanvas>
      <div className="fill" style={{ background: '#000' }} />
      {fill && <BackgroundFill bg={fill} />}
      <SlideText text={text} caption={caption} theme={theme} />
    </ScaledCanvas>
  );
}
