import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { timerRemaining, useNow } from '../clock';
import { useFontsVersion } from '../fonts';
import { useMedia } from '../media';
import { toFrameBackground } from '../theme';
import type { FrameBackground, OutputFrame, Theme, ThemeBackground, ThemeTextBox } from '../types';
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

export function slideBoxStyle(theme: Theme): CSSProperties {
  const { inset } = theme;
  return {
    top: `${inset.top}%`,
    right: `${inset.right}%`,
    bottom: `${inset.bottom}%`,
    left: `${inset.left}%`,
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[theme.verticalAlign],
    background: theme.boxColor || undefined,
    padding: theme.boxColor ? '24px 48px' : 0,
  };
}

export function slideTextStyle(theme: Theme, size: number): CSSProperties {
  return {
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
}

/** The theme a caption box draws with: the box's own position and type, the rest from the main text. */
export function captionBoxTheme(theme: Theme, box: ThemeTextBox): Theme {
  return {
    ...theme,
    inset: box.inset,
    textAlign: box.textAlign,
    verticalAlign: box.verticalAlign,
    fontSize: box.fontSize,
    fontFamily: box.fontFamily ?? theme.fontFamily,
    fontWeight: box.fontWeight ?? theme.fontWeight,
    color: box.color ?? theme.color,
    uppercase: box.uppercase ?? theme.uppercase,
    italic: box.italic ?? theme.italic,
    boxColor: '',
    captionBox: undefined,
  };
}

/**
 * A slide's text in its theme. The caption sits under the text, or in the theme's
 * own caption box (a Bible template's Reference box), each shrinking to fit.
 */
export function SlideText({ text, caption, theme }: { text: string; caption?: string; theme: Theme }) {
  if (!theme.captionBox) return <FittedText text={text} caption={caption} theme={theme} />;
  return (
    <>
      <FittedText text={text} theme={theme} />
      {caption && <FittedText text={caption} theme={captionBoxTheme(theme, theme.captionBox)} />}
    </>
  );
}

/** Text in a theme's box, shrunk from the theme's font size until it fits. */
function FittedText({ text, caption, theme }: { text: string; caption?: string; theme: Theme }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Re-measure once fonts finish loading; until then the fallback font was measured.
  const fontsVersion = useFontsVersion();
  const key = box && `${fitKey(text, caption, theme)}|${box.w}x${box.h}|${fontsVersion}`;
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

  return (
    <div ref={boxRef} className="slide-box" style={slideBoxStyle(theme)}>
      <div ref={contentRef} className="slide-content" style={slideTextStyle(theme, size)}>
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

function MediaFill({ mediaId, muted, paused = false }: { mediaId: string; muted: boolean; paused?: boolean }) {
  const media = useMedia(mediaId);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, media]);
  if (!media) return null;
  return media.isVideo ? (
    <video ref={video} className="media-fill" src={media.url} autoPlay={!paused} loop muted={muted} playsInline />
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
      return <MediaFill mediaId={bg.mediaId} muted={muted} paused={bg.paused} />;
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
/**
 * The audience picture, layer by layer. Used by output windows and the operator's monitor.
 * `alphaKey` "fill" drops the background layers; "key" also draws what's left as a
 * white matte on black, for keying in a video switcher.
 */
export function OutputView({
  frame,
  muted = true,
  screenColor,
  alphaKey = 'off',
}: {
  frame: OutputFrame | null;
  muted?: boolean;
  screenColor?: string;
  alphaKey?: 'off' | 'fill' | 'key';
}) {
  const d = frame?.transitionMs ?? 400;
  const foreground = (
    <>
      <Transition itemKey={frame?.slide?.key ?? null} duration={d}>
        {frame?.slide && (
          <>
            <SlideText text={frame.slide.text} caption={frame.slide.caption} theme={frame.slide.theme} />
            {frame.slide.footer && <div className="slide-footer">{frame.slide.footer}</div>}
          </>
        )}
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
    </>
  );
  return (
    <ScaledCanvas className="output-view">
      <div className="fill" style={{ background: alphaKey === 'off' ? (screenColor ?? '#000') : '#000' }} />
      {alphaKey === 'off' && (
        <Transition itemKey={frame?.background?.key ?? null} duration={d} mode="over">
          {frame?.background && <BackgroundFill bg={frame.background} muted={muted} />}
        </Transition>
      )}
      {alphaKey === 'key' ? <div className="fill key-matte">{foreground}</div> : foreground}
    </ScaledCanvas>
  );
}

/**
 * A static slide preview, used for thumbnails and theme swatches. A slide
 * with no background shows a checkerboard, as in ProPresenter, so it reads as
 * transparent over whatever media is playing.
 */
export function SlidePreview({
  text,
  caption,
  theme,
  background,
}: {
  text: string;
  caption?: string;
  theme: Theme;
  background?: ThemeBackground;
}) {
  const fill = toFrameBackground(background ?? theme.background);
  return (
    <ScaledCanvas>
      <div className={fill ? 'fill' : 'fill checker'} />
      {fill && <BackgroundFill bg={fill} />}
      <SlideText text={text} caption={caption} theme={theme} />
    </ScaledCanvas>
  );
}
