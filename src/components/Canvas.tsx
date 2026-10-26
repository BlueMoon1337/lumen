import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { timerRemaining, useNow } from '../clock';
import { useFontsVersion } from '../fonts';
import { useMedia } from '../media';
import { toFrameBackground } from '../theme';
import { DEFAULT_TRANSITION, directionOf, easingCss } from '../transitions';
import type { FrameBackground, OutputFrame, SlideTransition, Theme, ThemeBackground, ThemeTextBox } from '../types';
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

/**
 * A camera or capture card, live. Each window opens it for itself (a stream can't be sent
 * between windows); it's closed again when the layer goes.
 */
export function CameraFill({ deviceId }: { deviceId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch(() => {});
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);
  return <video ref={ref} className="media-fill" autoPlay muted playsInline />;
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
  /** The animation classes, length and easing, fixed when the layer arrives or starts leaving so later changes don't restart it. */
  effect: string;
  duration: number;
  easing: string;
}

let layerSeq = 0;

/** A layer's classes for a transition: "tr-in tr-push dir-left", and so on. */
function effectClass(t: Pick<SlideTransition, 'kind' | 'direction'>, phase: 'in' | 'out') {
  return `tr-${phase} tr-${t.kind} dir-${directionOf(t) ?? 'none'}`;
}

/**
 * Transitions between children whenever `itemKey` changes, with the effect the incoming
 * item brings (a dissolve, a push, a wipe…). "over" keeps the old content still underneath
 * while the new arrives, which avoids a dip to black between backgrounds.
 */
export function Transition({
  itemKey,
  duration,
  effect = DISSOLVE,
  mode = 'cross',
  children,
}: {
  itemKey: string | null;
  duration: number;
  effect?: Pick<SlideTransition, 'kind' | 'direction' | 'easing'>;
  mode?: 'cross' | 'over';
  children: ReactNode;
}) {
  const ms = effect.kind === 'cut' ? 0 : duration;
  const easing = easingCss(effect);
  const [layers, setLayers] = useState<Layer[]>(() => [
    { id: layerSeq++, key: itemKey, node: children, leaving: false, effect: effectClass(effect, 'in'), duration: ms, easing },
  ]);
  const [shownKey, setShownKey] = useState(itemKey);
  const lastChildren = useRef(children);

  if (itemKey !== shownKey) {
    const outgoing = lastChildren.current;
    // Clearing (nothing comes in) fades out, as kinds that keep the old picture still while the new
    // one arrives would otherwise leave it up and then drop it. Arriving from nothing, a Reveal (which
    // only moves the old picture) fades in.
    const fade = { kind: 'dissolve' } as const;
    const out =
      itemKey === null && effect.kind !== 'cut'
        ? effectClass(fade, 'out')
        : mode === 'over' && effect.kind === 'dissolve'
          ? 'tr-hold'
          : effectClass(effect, 'out');
    const into = shownKey === null && effect.kind === 'reveal' ? effectClass(fade, 'in') : effectClass(effect, 'in');
    setShownKey(itemKey);
    setLayers((prev) => [
      ...prev
        .filter((l) => l.key !== itemKey)
        .map((l) => (l.leaving ? l : { ...l, node: outgoing, leaving: true, effect: out, duration: ms, easing })),
      { id: layerSeq++, key: itemKey, node: null, leaving: false, effect: into, duration: ms, easing },
    ]);
  }

  useEffect(() => {
    lastChildren.current = children;
  });

  const leaving = layers.filter((l) => l.leaving);
  const longest = Math.max(0, ...leaving.map((l) => l.duration));
  useEffect(() => {
    if (!leaving.length) return;
    const t = setTimeout(() => setLayers((prev) => prev.filter((l) => !l.leaving)), longest + 50);
    return () => clearTimeout(t);
  }, [leaving.length, layers, longest]);

  // The group keeps its layers' stacking (Reveal puts the old slide on top) to itself.
  return (
    <div className="tr-group">
      {layers.map((l) => (
        <div key={l.id} className={`layer ${l.effect}`} style={{ animationDuration: `${l.duration}ms`, animationTimingFunction: l.easing }}>
          {l.leaving ? l.node : children}
        </div>
      ))}
    </div>
  );
}

const DISSOLVE = { kind: 'dissolve' } as const;

export function resolveTokens(text: string, timer: OutputFrame['timer'], now: number) {
  return text
    .replace(/\{countdown\}/gi, formatDuration(Math.max(0, timerRemaining(timer, now))))
    .replace(/\{clock\}/gi, formatClock(new Date(now)));
}

function MessageBanner({ text, timer }: { text: string; timer: OutputFrame['timer'] }) {
  const now = useNow(500);
  return <div className="message-banner">{resolveTokens(text, timer, now)}</div>;
}

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
  // The slide layer changes the way the incoming slide says, and so does a background that
  // changes with it; backgrounds from the media bin use the media transition. Messages and
  // the logo fade.
  const slideFx = frame?.transition ?? DEFAULT_TRANSITION;
  const mediaFx = frame?.mediaTransition ?? DEFAULT_TRANSITION;
  const announcementFx = frame?.announcementTransition ?? DEFAULT_TRANSITION;
  const d = frame?.fadeMs ?? 400;
  const background = frame?.background ?? null;
  const camera = frame?.videoInput?.deviceId ?? null;
  const isLive = (bg: FrameBackground | null) => bg?.kind === 'media' && !!bg.live;
  const last = useRef({ background, camera });
  // A background that changes because media or a camera came or went uses the media transition.
  const backgroundFx = isLive(background) || isLive(last.current.background) || camera !== last.current.camera ? mediaFx : slideFx;
  useEffect(() => {
    last.current = { background, camera };
  });
  const foreground = (
    <>
      <Transition itemKey={frame?.slide?.key ?? null} duration={slideFx.ms} effect={slideFx}>
        {frame?.slide && (
          <>
            <SlideText text={frame.slide.text} caption={frame.slide.caption} theme={frame.slide.theme} />
            {frame.slide.footer && <div className="slide-footer">{frame.slide.footer}</div>}
          </>
        )}
      </Transition>
      <Transition itemKey={frame?.announcement?.key ?? null} duration={announcementFx.ms} effect={announcementFx}>
        {frame?.announcement && (
          <>
            {alphaKey === 'off' && frame.announcement.background && <BackgroundFill bg={frame.announcement.background} />}
            <SlideText text={frame.announcement.text} caption={frame.announcement.caption} theme={frame.announcement.theme} />
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
        <>
          <Transition itemKey={camera} duration={mediaFx.ms} effect={mediaFx} mode="over">
            {camera && <CameraFill deviceId={camera} />}
          </Transition>
          <Transition itemKey={background?.key ?? null} duration={backgroundFx.ms} effect={backgroundFx} mode="over">
            {background && <BackgroundFill bg={background} muted={muted} />}
          </Transition>
        </>
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
