/**
 * Capture, as in ProPresenter (Screens ▸ Start Capture, Capture Settings…): records an audience
 * screen, as it looks under the live look, with Lumen's sound, to a movie file.
 *
 * The screen is drawn layer by layer onto a canvas (the same drawing as Export ▸ Slide Images,
 * with the screens' fades), and the browser's recorder encodes the canvas and the sound. It
 * writes H.264 or H.265 where the system has them, else WebM; HAP and ProRes need encoders
 * a web page doesn't have.
 */
import { create } from 'zustand';
import { audioElement } from './components/AudioPlayer';
import { CANVAS_H, CANVAS_W, resolveTokens } from './components/Canvas';
import { liveVideoElement } from './components/MediaClock';
import { downloadFile } from './components/ui';
import { useLiveFrame } from './liveFrame';
import { MASKS } from './looks';
import { loadMedia } from './media';
import { notify } from './notices';
import { drawWords, loadFonts, wrapLines } from './slideImages';
import { useStore } from './store';
import { toFrameBackground } from './theme';
import type {
  CaptureCodec,
  CaptureEncoding,
  CaptureSettings,
  FrameBackground,
  OutputFrame,
  ScreenConfig,
  ScreenLook,
  Theme,
} from './types';

// ---- Settings ---------------------------------------------------------------------------------

export interface CodecInfo {
  id: CaptureCodec;
  label: string;
  /** The recorder types that write it, best first; none for codecs a web page can't encode. */
  types: string[];
  extension: string;
}

export const CAPTURE_CODECS: CodecInfo[] = [
  {
    id: 'h264',
    label: 'H.264',
    types: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
    extension: 'mp4',
  },
  {
    id: 'h265',
    label: 'H.265',
    types: ['video/mp4;codecs=hvc1.1.6.L120.B0,mp4a.40.2', 'video/mp4;codecs=hvc1', 'video/mp4;codecs=hev1'],
    extension: 'mp4',
  },
  { id: 'hap', label: 'HAP', types: [], extension: 'mov' },
  { id: 'hapAlpha', label: 'HAP Alpha', types: [], extension: 'mov' },
  { id: 'hapQ', label: 'HAP Q', types: [], extension: 'mov' },
  { id: 'prores422', label: 'ProRes 422', types: [], extension: 'mov' },
  { id: 'prores422hq', label: 'ProRes 422 HQ', types: [], extension: 'mov' },
  { id: 'prores422lt', label: 'ProRes 422 LT', types: [], extension: 'mov' },
  { id: 'prores422proxy', label: 'ProRes 422 Proxy', types: [], extension: 'mov' },
  { id: 'prores4444', label: 'ProRes 4444', types: [], extension: 'mov' },
  { id: 'prores4444xq', label: 'ProRes 4444 XQ', types: [], extension: 'mov' },
  { id: 'vp9', label: 'VP9 (WebM)', types: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'], extension: 'webm' },
];

/** The recorder type for a codec here, or null when this computer's browser can't write it. */
export function recorderType(codec: CaptureCodec): string | null {
  const info = CAPTURE_CODECS.find((c) => c.id === codec);
  if (!info || typeof MediaRecorder === 'undefined') return null;
  return info.types.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** ProPresenter's encodings. */
export const CAPTURE_ENCODINGS: CaptureEncoding[] = [
  { width: 640, height: 360, fps: 30, mbps: 4 },
  { width: 854, height: 480, fps: 30, mbps: 4 },
  { width: 1280, height: 720, fps: 30, mbps: 6 },
  { width: 1280, height: 720, fps: 30, mbps: 10 },
  { width: 1280, height: 720, fps: 30, mbps: 14 },
  { width: 1280, height: 720, fps: 60, mbps: 16 },
  { width: 1920, height: 1080, fps: 30, mbps: 20 },
  { width: 1920, height: 1080, fps: 60, mbps: 24 },
];

export const encodingLabel = (e: CaptureEncoding) => `${e.height}p${e.fps} (${e.mbps} Mbps)`;
export const sameEncoding = (a: CaptureEncoding, b: CaptureEncoding) =>
  a.width === b.width && a.height === b.height && a.fps === b.fps && a.mbps === b.mbps;

/** The folders Save To offers; anything else is a folder's path. */
export const SAVE_FOLDERS = [
  { id: 'downloads', label: 'Downloads' },
  { id: 'documents', label: 'Documents' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'movies', label: 'Movies' },
];

export const AUTO_MATRIX: CaptureSettings['audio']['matrix'] = [
  [true, false],
  [false, true],
];

export const DEFAULT_CAPTURE: CaptureSettings = {
  destination: 'disk',
  saveTo: 'movies',
  codec: 'h264',
  encoding: CAPTURE_ENCODINGS[6],
  audio: { auto: true, matrix: AUTO_MATRIX },
};

export const captureSettings = (s = useStore.getState()): CaptureSettings => ({ ...DEFAULT_CAPTURE, ...s.settings.capture });

/** The audience screen a capture records: the one chosen, else the first. */
export function captureSource(screens: ScreenConfig[], id?: string): ScreenConfig | undefined {
  const audience = screens.filter((sc) => sc.kind === 'audience');
  return audience.find((sc) => sc.id === id) ?? audience[0];
}

/** "Lumen Capture 2026-10-27 at 14.05.33.mp4" */
export function captureFileName(date: Date, extension: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Lumen Capture ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} at ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}.${extension}`;
}

// ---- Drawing the screen -----------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
type Drawable = CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number };

interface Shown {
  key: string;
  draw: (ctx: Ctx) => void;
}

/**
 * A layer's content, changing over `ms`: cross-dissolving from what it showed before, or (`over`)
 * coming in over it, as the screens' transitions do.
 */
class Fader {
  cur: Shown | null = null;
  prev: Shown | null = null;
  t0 = 0;
  ms = 0;

  constructor(private over = false) {}

  set(next: Shown | null, ms: number, now: number) {
    if ((next?.key ?? null) === (this.cur?.key ?? null)) {
      this.cur = next;
      return;
    }
    this.prev = this.cur;
    this.cur = next;
    this.t0 = now;
    this.ms = ms;
  }

  draw(ctx: Ctx, now: number, alpha: number) {
    const p = this.ms > 0 ? Math.min(1, (now - this.t0) / this.ms) : 1;
    if (p >= 1) this.prev = null;
    if (alpha <= 0) return;
    const base = ctx.globalAlpha;
    if (this.prev) {
      ctx.globalAlpha = base * alpha * (this.over && this.cur ? 1 : 1 - p);
      this.prev.draw(ctx);
    }
    if (this.cur) {
      ctx.globalAlpha = base * alpha * p;
      this.cur.draw(ctx);
    }
    ctx.globalAlpha = base;
  }
}

/** A look's switch for a layer, eased on and off over the look's fade. */
class Visibility {
  value = 1;
  last = 0;
  step(target: boolean, ms: number, now: number) {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    const goal = target ? 1 : 0;
    if (ms <= 0) this.value = goal;
    else this.value += Math.sign(goal - this.value) * Math.min(Math.abs(goal - this.value), dt / ms);
    return this.value;
  }
}

const LAYERS = ['videoInput', 'background', 'slide', 'announcement', 'message', 'logo'] as const;
type LayerName = (typeof LAYERS)[number];

/** Draws an audience screen at a size, frame after frame. */
export class ScreenRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private faders = Object.fromEntries(LAYERS.map((l) => [l, new Fader(l === 'videoInput' || l === 'background')])) as Record<
    LayerName,
    Fader
  >;
  private shown = Object.fromEntries(LAYERS.map((l) => [l, new Visibility()])) as Record<LayerName, Visibility>;
  private media = new Map<string, Drawable | null | 'loading'>();
  private words = new Map<string, HTMLCanvasElement>();
  private camera: { deviceId: string; video: HTMLVideoElement; stream: MediaStream | null } | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
    private screenId: () => string | undefined,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas to draw on.');
    this.ctx = ctx;
  }

  /** An image, or a playing copy of a video, once loaded; null until then. */
  private source(mediaId: string, live: boolean): Drawable | null {
    if (live) {
      const v = liveVideoElement();
      if (v && v.readyState >= 2) return v;
    }
    const have = this.media.get(mediaId);
    if (have === 'loading') return null;
    if (have !== undefined) return have;
    this.media.set(mediaId, 'loading');
    void loadMedia(mediaId).then(async (m) => {
      if (!m) return this.media.set(mediaId, null);
      if (m.isVideo) {
        const v = document.createElement('video');
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.src = m.url;
        void v.play().catch(() => {});
        this.media.set(mediaId, v);
      } else {
        const blob = await fetch(m.url).then((r) => r.blob());
        this.media.set(mediaId, await createImageBitmap(blob).catch(() => null));
      }
    });
    return null;
  }

  private cameraVideo(deviceId: string): HTMLVideoElement {
    if (this.camera?.deviceId === deviceId) return this.camera.video;
    this.stopCamera();
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const camera: { deviceId: string; video: HTMLVideoElement; stream: MediaStream | null } = { deviceId, video, stream: null };
    this.camera = camera;
    void navigator.mediaDevices
      ?.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (this.camera !== camera) return stream.getTracks().forEach((t) => t.stop());
        camera.stream = stream;
        video.srcObject = stream;
        void video.play().catch(() => {});
      })
      .catch(() => {});
    return video;
  }

  private stopCamera() {
    this.camera?.stream?.getTracks().forEach((t) => t.stop());
    this.camera = null;
  }

  private fill(bg: FrameBackground): Shown {
    return {
      key: bg.key,
      draw: (ctx) => {
        if (bg.kind === 'color') {
          ctx.fillStyle = bg.color;
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        } else if (bg.kind === 'gradient') {
          const half = ((CANVAS_W + CANVAS_H) * Math.SQRT1_2) / 2;
          const [cx, cy, d] = [CANVAS_W / 2, CANVAS_H / 2, Math.SQRT1_2 * half];
          const g = ctx.createLinearGradient(cx - d, cy - d, cx + d, cy + d);
          g.addColorStop(0, bg.color);
          g.addColorStop(1, bg.color2);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        } else {
          const src = this.source(bg.mediaId, !!bg.live);
          if (src) drawCover(ctx, src);
        }
      },
    };
  }

  /** An imported slide's picture, once loaded. */
  private picture(mediaId: string): Pick<Shown, 'draw'> {
    return {
      draw: (ctx) => {
        const src = this.source(mediaId, false);
        if (src) drawContain(ctx, src);
      },
    };
  }

  /** Words drawn once into a picture of their own, since fitting them takes a while. */
  private text(key: string, theme: Theme, text: string, caption?: string): Shown {
    const id = JSON.stringify([text, caption, theme]);
    return {
      key,
      draw: (ctx) => {
        let pic = this.words.get(id);
        if (!pic) {
          pic = document.createElement('canvas');
          pic.width = this.width;
          pic.height = this.height;
          const c = pic.getContext('2d');
          if (!c) return;
          c.scale(this.width / CANVAS_W, this.height / CANVAS_H);
          drawWords(c, theme, text, caption);
          if (this.words.size > 12) this.words.delete(this.words.keys().next().value!);
          this.words.set(id, pic);
        }
        ctx.drawImage(pic, 0, 0, CANVAS_W, CANVAS_H);
      },
    };
  }

  /** Draws the screen as it is now. */
  draw(frame: OutputFrame, now = performance.now()) {
    const ctx = this.ctx;
    const id = this.screenId();
    const screen = id ? frame.screens.screens.find((sc) => sc.id === id) : undefined;
    const look: ScreenLook | undefined = id ? frame.looks?.[id] : undefined;
    const camera = frame.videoInput?.deviceId ?? null;
    const isLive = (bg: FrameBackground | null) => bg?.kind === 'media' && !!bg.live;
    const lookTheme = look?.theme;
    const background =
      lookTheme && frame.slide && !camera && !isLive(frame.background)
        ? toFrameBackground(frame.slide.background ?? lookTheme.background)
        : frame.background;
    const f = this.faders;
    const fade = frame.fadeMs ?? 400;

    const cameraVideo = camera ? this.cameraVideo(camera) : null;
    f.videoInput.set(cameraVideo ? { key: camera!, draw: (c) => drawCover(c, cameraVideo) } : null, frame.mediaTransition.ms, now);
    // A camera that went off keeps going until it has faded out.
    if (!camera && !f.videoInput.prev) this.stopCamera();
    f.background.set(background ? this.fill(background) : null, (isLive(background) ? frame.mediaTransition : frame.transition).ms, now);
    const slide = frame.slide;
    f.slide.set(
      slide
        ? (() => {
            const words = slide.picture
              ? this.picture(slide.picture)
              : this.text(slide.key, lookTheme ?? slide.theme, slide.text, slide.caption);
            return {
              key: slide.key,
              draw: (c: Ctx) => {
                words.draw(c);
                if (slide.footer) drawFooter(c, slide.footer);
              },
            };
          })()
        : null,
      frame.transition.ms,
      now,
    );
    const a = frame.announcement;
    f.announcement.set(
      a
        ? (() => {
            const bg = a.background ? this.fill(a.background) : null;
            const words = a.picture ? this.picture(a.picture) : this.text(`a:${a.key}`, a.theme, a.text, a.caption);
            return {
              key: a.key,
              draw: (c: Ctx) => {
                bg?.draw(c);
                words.draw(c);
              },
            };
          })()
        : null,
      frame.announcementTransition.ms,
      now,
    );
    const m = frame.message;
    f.message.set(m ? { key: m.key, draw: (c) => drawBanner(c, resolveTokens(m.text, frame.timer, Date.now())) } : null, fade, now);
    const logo = frame.logoMediaId;
    f.logo.set(
      logo
        ? {
            key: logo,
            draw: (c) => {
              c.fillStyle = '#000';
              c.fillRect(0, 0, CANVAS_W, CANVAS_H);
              const src = this.source(logo, false);
              if (src) drawContain(c, src);
            },
          }
        : null,
      fade,
      now,
    );

    const show = look?.show;
    const lookMs = look?.fadeMs ?? 0;
    const vis = (layer: LayerName, on: boolean | undefined) => this.shown[layer].step(on !== false, lookMs, now);
    const visible: Record<LayerName, number> = {
      videoInput: vis('videoInput', show?.videoInput),
      background: vis('background', isLive(background) ? show?.media : show?.slide),
      slide: vis('slide', show?.slide),
      announcement: vis('announcement', show?.announcements),
      message: vis('message', show?.messages),
      logo: vis('logo', show?.logo),
    };

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.scale(this.width / CANVAS_W, this.height / CANVAS_H);
    const inset = MASKS.find((mk) => mk.id === look?.mask)?.inset;
    if (inset) {
      const [t, r, b, l] = inset;
      ctx.beginPath();
      ctx.rect((l / 100) * CANVAS_W, (t / 100) * CANVAS_H, ((100 - l - r) / 100) * CANVAS_W, ((100 - t - b) / 100) * CANVAS_H);
      ctx.clip();
    }
    ctx.fillStyle = screen?.screenColor ?? '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const layer of LAYERS) f[layer].draw(ctx, now, visible[layer]);
    ctx.restore();
  }

  dispose() {
    this.stopCamera();
    for (const m of this.media.values()) if (m instanceof HTMLVideoElement) m.removeAttribute('src');
    this.media.clear();
    this.words.clear();
  }
}

function sourceSize(src: Drawable): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  return [src.width ?? 0, src.height ?? 0];
}

/** Fills the screen with a picture, cropped to cover it (object-fit: cover). */
function drawCover(ctx: Ctx, src: Drawable) {
  const [iw, ih] = sourceSize(src);
  if (!iw || !ih) return;
  const scale = Math.max(CANVAS_W / iw, CANVAS_H / ih);
  ctx.drawImage(src, (CANVAS_W - iw * scale) / 2, (CANVAS_H - ih * scale) / 2, iw * scale, ih * scale);
}

/** A picture as large as fits (object-fit: contain), for the logo. */
function drawContain(ctx: Ctx, src: Drawable) {
  const [iw, ih] = sourceSize(src);
  if (!iw || !ih) return;
  const scale = Math.min(CANVAS_W / iw, CANVAS_H / ih);
  ctx.drawImage(src, (CANVAS_W - iw * scale) / 2, (CANVAS_H - ih * scale) / 2, iw * scale, ih * scale);
}

/** The message banner along the bottom, as the screens show it. */
function drawBanner(ctx: Ctx, text: string) {
  ctx.font = '600 46px system-ui, sans-serif';
  const lines = wrapLines(text, CANVAS_W - 120, (t) => ctx.measureText(t).width);
  const lineH = 46 * 1.2;
  const h = lines.length * lineH + 44;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, CANVAS_H - h, CANVAS_W, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, CANVAS_H - h + 22 + lineH * (i + 0.5)));
}

function drawFooter(ctx: Ctx, text: string) {
  ctx.save();
  ctx.font = '24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H - 24 - 6);
  ctx.restore();
}

// ---- Sound ------------------------------------------------------------------------------------

let audio: AudioContext | null = null;
/** Each element's sound in the graph, after its volume. */
const elementSources = new WeakMap<HTMLMediaElement, AudioNode>();

/**
 * An element's sound, taken into Lumen's audio graph (for good: the browser allows it once). The
 * Audio layer goes on playing out loud, at the element's volume (its fade-out), which not every
 * browser applies to the graph by itself.
 */
function sourceFor(ctx: AudioContext, el: HTMLMediaElement, toSpeakers: boolean) {
  let out = elementSources.get(el);
  if (!out) {
    const node = ctx.createMediaElementSource(el);
    out = node;
    if (toSpeakers) {
      const volume = ctx.createGain();
      const follow = () => (volume.gain.value = el.muted ? 0 : el.volume);
      follow();
      el.addEventListener('volumechange', follow);
      // A suspended graph would silence it.
      el.addEventListener('play', () => void ctx.resume());
      node.connect(volume).connect(ctx.destination);
      out = volume;
    }
    elementSources.set(el, out);
  }
  return out;
}

/**
 * Lumen's sound (the Audio layer, and the live video's own sound) as two channels, routed to the
 * recording's left and right by the matrix: matrix[input][output].
 */
function soundTrack(matrix: CaptureSettings['audio']['matrix']): { track: MediaStreamTrack; stop: () => void } | null {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume();
    const mix = ctx.createGain();
    mix.channelCount = 2;
    mix.channelCountMode = 'explicit';
    mix.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    mix.connect(split);
    const gains: GainNode[] = [];
    for (const input of [0, 1]) {
      for (const output of [0, 1]) {
        const g = ctx.createGain();
        g.gain.value = matrix[input][output] ? 1 : 0;
        split.connect(g, input);
        g.connect(merge, 0, output);
        gains.push(g);
      }
    }
    const out = ctx.createMediaStreamDestination();
    merge.connect(out);
    const connected: AudioNode[] = [];
    const track = audioElement();
    if (track) {
      const node = sourceFor(ctx, track, true);
      node.connect(mix);
      connected.push(node);
    }
    // The operator window's copy of the live video is silent; while recording, its sound goes
    // to the recording only (the screens play it out loud).
    const video = liveVideoElement();
    if (video) {
      const node = sourceFor(ctx, video, false);
      video.muted = false;
      node.connect(mix);
      connected.push(node);
    }
    return {
      track: out.stream.getAudioTracks()[0],
      stop: () => {
        for (const node of connected) node.disconnect(mix);
        if (video) video.muted = true;
        mix.disconnect();
        merge.disconnect();
        gains.forEach((g) => g.disconnect());
      },
    };
  } catch {
    return null;
  }
}

// ---- Recording --------------------------------------------------------------------------------

export interface CaptureStatus {
  recording: boolean;
  stopping: boolean;
  startedAt: number | null;
  /** Where the recording is going: a file's path, or its name for a browser download. */
  file: string | null;
}

export const useCapture = create<CaptureStatus>(() => ({ recording: false, stopping: false, startedAt: null, file: null }));

interface Sink {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

let session: {
  recorder: MediaRecorder;
  renderer: ScreenRenderer;
  timer: number;
  sound: ReturnType<typeof soundTrack>;
  done: Promise<void>;
} | null = null;

/** Starts recording the chosen audience screen with the capture settings. */
export async function startCapture(): Promise<boolean> {
  if (session) return true;
  const s = useStore.getState();
  const settings = captureSettings(s);
  const type = recorderType(settings.codec);
  const codec = CAPTURE_CODECS.find((c) => c.id === settings.codec)!;
  if (!type) {
    notify(
      codec.types.length
        ? `This computer can't record ${codec.label}. Choose another codec in Screens ▸ Capture Settings….`
        : `${codec.label} needs an encoder Lumen doesn't have. Choose H.264 in Screens ▸ Capture Settings….`,
    );
    return false;
  }
  const source = captureSource(s.screens.screens, settings.sourceScreenId);
  const { width, height, fps, mbps } = settings.encoding;
  const extension = type.startsWith('video/webm') ? 'webm' : codec.extension;
  const name = captureFileName(new Date(), extension);

  // Where it goes: a file on disk in the desktop app, a download in a browser.
  const bridge = window.lumenDesktop;
  let sink: Sink;
  let file: string;
  if (bridge?.captureOpen) {
    try {
      file = await bridge.captureOpen(settings.saveTo, name);
    } catch (e) {
      notify(`Couldn't start the capture: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    sink = { write: (d) => bridge.captureWrite(d), close: () => bridge.captureClose() };
  } else {
    const chunks: BlobPart[] = [];
    file = name;
    sink = {
      write: async (d) => void chunks.push(d as BlobPart),
      close: async () => downloadFile(name, new Blob(chunks, { type }), type),
    };
  }

  const frame = () => useLiveFrame.getState().frame;
  await loadFonts([frame().slide?.theme, frame().announcement?.theme].filter((t): t is Theme => !!t)).catch(() => {});
  const renderer = new ScreenRenderer(width, height, () => source?.id);
  // Some browsers only record a canvas that's in the page.
  Object.assign(renderer.canvas.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' });
  document.body.append(renderer.canvas);
  renderer.draw(frame());
  const stream = renderer.canvas.captureStream(fps);
  const sound = soundTrack(settings.audio.auto ? AUTO_MATRIX : settings.audio.matrix);
  if (sound) stream.addTrack(sound.track);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: mbps * 1_000_000, audioBitsPerSecond: 192_000 });
  } catch (e) {
    sound?.stop();
    renderer.canvas.remove();
    renderer.dispose();
    await sink.close().catch(() => {});
    notify(`Couldn't start the capture: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  // Chunks are written in order as they come, each after the one before.
  let writing = Promise.resolve();
  let failed = false;
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    writing = writing
      .then(async () => (failed ? undefined : sink.write(new Uint8Array(await e.data.arrayBuffer()))))
      .catch((err) => {
        if (failed) return;
        failed = true;
        notify(`The capture stopped: ${err instanceof Error ? err.message : String(err)}`);
        void stopCapture();
      });
  };
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      void writing
        .then(() => sink.close())
        .catch(() => {})
        .then(resolve);
    };
  });
  const timer = window.setInterval(() => renderer.draw(frame()), 1000 / fps);
  recorder.start(1000);
  session = { recorder, renderer, timer, sound, done };
  useCapture.setState({ recording: true, stopping: false, startedAt: Date.now(), file });
  return true;
}

/** Stops recording and finishes the file. */
export async function stopCapture(): Promise<void> {
  const current = session;
  if (!current) return;
  session = null;
  useCapture.setState({ stopping: true });
  window.clearInterval(current.timer);
  if (current.recorder.state !== 'inactive') current.recorder.stop();
  current.sound?.stop();
  await current.done;
  current.renderer.canvas.remove();
  current.renderer.dispose();
  const { file } = useCapture.getState();
  useCapture.setState({ recording: false, stopping: false, startedAt: null });
  if (file) notify(window.lumenDesktop ? `Capture saved to ${file}` : `Capture saved as “${file}”.`);
}

export const toggleCapture = () => (session ? stopCapture() : startCapture().then(() => {}));
