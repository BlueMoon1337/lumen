/**
 * Export ▸ Slide Images…: each slide drawn as the screens show it (its background or media,
 * the text box shrunk to fit, the caption) onto a canvas, then saved as a JPEG or PNG.
 */
import { captionBoxTheme, CANVAS_H, CANVAS_W } from './components/Canvas';
import { safeFileName } from './fileFormats';
import { getSequence } from './lyrics';
import { getMediaBlob } from './media';
import type { AppState } from './store';
import { resolveTheme, slideTheme } from './theme';
import type { Slide, Theme, ThemeBackground } from './types';

export type ImageFormat = 'jpeg' | 'png';

export interface SlideImageOptions {
  format: ImageFormat;
  /** Width in pixels; the height follows 16:9. */
  width: number;
}

export const IMAGE_SIZES = [
  { width: 1280, label: '1280 × 720' },
  { width: 1920, label: '1920 × 1080' },
  { width: 3840, label: '3840 × 2160' },
];

type Ctx = CanvasRenderingContext2D;

const fontOf = (t: Theme, size: number, weight = t.fontWeight) => `${t.italic ? 'italic ' : ''}${weight} ${size}px ${t.fontFamily}`;

/** Splits text into the lines CSS would show: at line breaks, and between words where a line gets too wide. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/);
    let line = '';
    for (const part of words) {
      if (!part) continue;
      const next = line + part;
      if (line.trim() && /\S/.test(part) && measure(next.trimEnd()) > maxWidth) {
        lines.push(line.trimEnd());
        line = part;
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

interface Block {
  lines: string[];
  size: number;
  weight: number;
  alpha: number;
  uppercase: boolean;
  gapBefore: number;
}

/** The text and caption at a font size, laid out in the box; whether they fit. */
function layout(ctx: Ctx, t: Theme, text: string, caption: string | undefined, size: number, w: number, h: number) {
  const blocks: Block[] = [];
  const add = (body: string, px: number, weight: number, uppercase: boolean, alpha: number, gapBefore: number) => {
    ctx.font = fontOf(t, px, weight);
    const shown = uppercase ? body.toUpperCase() : body;
    blocks.push({ lines: wrapLines(shown, w, (s) => ctx.measureText(s).width), size: px, weight, alpha, uppercase, gapBefore });
  };
  add(text, size, t.fontWeight, t.uppercase, 1, 0);
  if (caption) {
    const px = size * t.captionScale;
    add(caption, px, 400, false, 0.85, px * 0.5);
  }
  let height = 0;
  let widest = 0;
  for (const b of blocks) {
    ctx.font = fontOf(t, b.size, b.weight);
    height += b.gapBefore + b.lines.length * b.size * t.lineHeight;
    for (const line of b.lines) widest = Math.max(widest, ctx.measureText(line).width);
  }
  return { blocks, height, fits: height <= h + 1 && widest <= w + 1 };
}

/** Draws text in a theme's box, shrinking it from the theme's size until it fits, as the screens do. */
function drawText(ctx: Ctx, t: Theme, text: string, caption?: string) {
  const pad = t.boxColor ? { x: 48, y: 24 } : { x: 0, y: 0 };
  const box = {
    x: (t.inset.left / 100) * CANVAS_W,
    y: (t.inset.top / 100) * CANVAS_H,
    w: ((100 - t.inset.left - t.inset.right) / 100) * CANVAS_W,
    h: ((100 - t.inset.top - t.inset.bottom) / 100) * CANVAS_H,
  };
  if (t.boxColor) {
    ctx.fillStyle = t.boxColor;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  const inner = { x: box.x + pad.x, y: box.y + pad.y, w: box.w - pad.x * 2, h: box.h - pad.y * 2 };
  let fitted = layout(ctx, t, text, caption, t.fontSize, inner.w, inner.h);
  if (!fitted.fits) {
    let lo = 8;
    let hi = t.fontSize;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (layout(ctx, t, text, caption, mid, inner.w, inner.h).fits) lo = mid;
      else hi = mid;
    }
    fitted = layout(ctx, t, text, caption, lo, inner.w, inner.h);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  let y = inner.y + { top: 0, middle: (inner.h - fitted.height) / 2, bottom: inner.h - fitted.height }[t.verticalAlign];
  ctx.textAlign = t.textAlign;
  ctx.textBaseline = 'alphabetic';
  const x = { left: inner.x, center: inner.x + inner.w / 2, right: inner.x + inner.w }[t.textAlign];
  for (const b of fitted.blocks) {
    y += b.gapBefore;
    ctx.font = fontOf(t, b.size, b.weight);
    ctx.globalAlpha = b.alpha;
    const lineH = b.size * t.lineHeight;
    const m = ctx.measureText('Hg');
    const ascent = m.fontBoundingBoxAscent ?? b.size * 0.8;
    const descent = m.fontBoundingBoxDescent ?? b.size * 0.2;
    for (const line of b.lines) {
      // CSS centres the glyphs in each line box.
      const baseline = y + (lineH - ascent - descent) / 2 + ascent;
      const shadow = () => {
        if (!t.shadow) return;
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowOffsetY = b.size * 0.04;
        ctx.shadowBlur = b.size * 0.12;
      };
      const noShadow = () => {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      };
      // The outline goes under the fill (paint-order: stroke fill), so half of it shows.
      if (t.outline) {
        shadow();
        ctx.lineJoin = 'round';
        ctx.lineWidth = t.outline;
        ctx.strokeStyle = t.outlineColor;
        ctx.strokeText(line, x, baseline);
        noShadow();
      } else shadow();
      ctx.fillStyle = t.color;
      ctx.fillText(line, x, baseline);
      noShadow();
      y += lineH;
    }
  }
  ctx.restore();
}

/** An image or a frame half a second into a video, ready to draw. */
async function mediaImage(id: string): Promise<CanvasImageSource | null> {
  const blob = await getMediaBlob(id);
  if (!blob) return null;
  if (!blob.type.startsWith('video/')) return createImageBitmap(blob).catch(() => null);
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('video'));
    });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 3000);
    });
    return await createImageBitmap(video);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fills the canvas with an image, cropped to cover it (object-fit: cover). */
export function drawCover(ctx: Ctx, image: CanvasImageSource) {
  const iw = (image as { width: number }).width;
  const ih = (image as { height: number }).height;
  if (!iw || !ih) return;
  const scale = Math.max(CANVAS_W / iw, CANVAS_H / ih);
  const w = iw * scale;
  const h = ih * scale;
  ctx.drawImage(image, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
}

async function drawBackground(ctx: Ctx, bg: ThemeBackground, media: string | undefined, images: Map<string, CanvasImageSource | null>) {
  const image = async (id: string) => {
    if (!images.has(id)) images.set(id, await mediaImage(id));
    return images.get(id) ?? null;
  };
  // A slide's media cue shows behind it, as in its thumbnail.
  const mediaId = media ?? (bg.type === 'media' ? bg.mediaId : undefined);
  if (mediaId) {
    const img = await image(mediaId);
    if (img) drawCover(ctx, img);
  } else if (bg.type === 'color') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  } else if (bg.type === 'gradient') {
    // CSS linear-gradient(135deg, …) on a 16:9 box.
    const half = ((CANVAS_W + CANVAS_H) * Math.SQRT1_2) / 2;
    const [cx, cy, d] = [CANVAS_W / 2, CANVAS_H / 2, Math.SQRT1_2 * half];
    const g = ctx.createLinearGradient(cx - d, cy - d, cx + d, cy + d);
    g.addColorStop(0, bg.color);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

/** Waits for the fonts the slides use, so they're drawn in them rather than a fallback. */
export async function loadFonts(themes: Theme[]) {
  if (!document.fonts) return;
  const wanted = new Set(themes.flatMap((t) => [fontOf(t, 40), fontOf(t, 40, 400)]));
  await Promise.all([...wanted].map((f) => document.fonts.load(f).catch(() => [])));
}

export async function drawSlide(
  ctx: Ctx,
  theme: Theme,
  slide: Pick<Slide, 'text' | 'caption' | 'background' | 'media'>,
  images = new Map<string, CanvasImageSource | null>(),
) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  await drawBackground(ctx, slide.background ?? theme.background, slide.media, images);
  drawWords(ctx, theme, slide.text, slide.caption);
}

/** A slide's words and caption, in their boxes, on a 1920 × 1080 canvas. */
export function drawWords(ctx: Ctx, theme: Theme, text: string, caption?: string) {
  if (theme.captionBox) {
    drawText(ctx, theme, text);
    if (caption) drawText(ctx, captionBoxTheme(theme, theme.captionBox), caption);
  } else drawText(ctx, theme, text, caption);
}

/** Images of a presentation's slides, in the order they're shown, named "Title 01.jpg" and so on. */
export async function slideImages(
  s: Pick<AppState, 'presentations' | 'themes' | 'settings'>,
  presentationId: string,
  { format, width }: SlideImageOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ name: string; data: Uint8Array }[]> {
  const p = s.presentations[presentationId];
  if (!p) return [];
  const base = resolveTheme(s, p);
  const sequence = getSequence(p);
  const themes = sequence.map((e) => slideTheme(base, p, e.slide));
  await loadFonts(themes);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((width * CANVAS_H) / CANVAS_W);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas to draw on.');
  ctx.scale(width / CANVAS_W, width / CANVAS_W);
  const images = new Map<string, CanvasImageSource | null>();
  const digits = Math.max(2, String(sequence.length).length);
  const title = safeFileName(p.title);
  const out: { name: string; data: Uint8Array }[] = [];
  for (const [i, entry] of sequence.entries()) {
    if (format === 'jpeg') {
      // JPEG has no transparency: a slide without a background is on black.
      ctx.fillStyle = '#000';
    }
    await drawSlide(ctx, themes[i], entry.slide, images);
    if (format === 'jpeg') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.globalCompositeOperation = 'source-over';
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, `image/${format}`, 0.92));
    if (!blob) throw new Error('A slide image could not be made.');
    out.push({
      name: `${title} ${String(i + 1).padStart(digits, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`,
      data: new Uint8Array(await blob.arrayBuffer()),
    });
    onProgress?.(i + 1, sequence.length);
  }
  return out;
}
