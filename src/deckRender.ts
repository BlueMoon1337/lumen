/**
 * Draws slides from Lumen's deck model (src/deck.ts) onto a canvas: backgrounds, shapes (preset
 * and drawn), pictures with their crops, and text set in its boxes, as PowerPoint lays it out
 * (wrapping, alignment, bullets and numbers, spacing, anchoring, autofit). Imported PowerPoint
 * slides show as these pictures.
 */
import type { Deck, DeckElement, DeckFill, DeckGeometry, DeckParagraph, DeckPath, DeckRun, DeckSlide, DeckStroke, DeckText } from './deck';

type Ctx = CanvasRenderingContext2D;
type Images = Map<string, CanvasImageSource | null>;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** The pictures a deck uses, decoded (those that can't be, such as EMF, are null). */
export async function loadDeckImages(deck: Deck, files: Map<string, Uint8Array>): Promise<Images> {
  const paths = new Set<string>();
  const walk = (els: DeckElement[]) =>
    els.forEach((e) => {
      if (e.kind === 'picture') paths.add(e.image);
      if (e.kind === 'shape' && e.fill?.kind === 'image') paths.add(e.fill.image);
      if (e.kind === 'group') walk(e.children);
    });
  for (const s of deck.slides) {
    if (s.background?.kind === 'image') paths.add(s.background.image);
    walk(s.elements);
  }
  const images: Images = new Map();
  await Promise.all(
    [...paths].map(async (p) => {
      const bytes = files.get(p);
      const type = MIME[p.slice(p.lastIndexOf('.') + 1).toLowerCase()];
      if (!bytes || !type) return images.set(p, null);
      const blob = new Blob([bytes as BlobPart], { type });
      try {
        if (type === 'image/svg+xml') {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.src = url;
          await img.decode();
          images.set(p, img);
        } else images.set(p, await createImageBitmap(blob));
      } catch {
        images.set(p, null);
      }
    }),
  );
  return images;
}

// ---- Geometry ---------------------------------------------------------------------------------

/** A preset shape's outline in a w × h box, `a` its adjustments (PowerPoint's, out of 100000). */
function presetPath(name: string, w: number, h: number, a: Record<string, number>): Path2D {
  const p = new Path2D();
  const ss = Math.min(w, h);
  const adj = (k: string, d: number) => (a[k] ?? a.adj ?? d) / 100000;
  const poly = (...pts: [number, number][]) => {
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
  };
  switch (name) {
    case 'ellipse':
    case 'flowChartConnector':
      p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'roundRect':
    case 'flowChartAlternateProcess': {
      const r = ss * Math.min(0.5, adj('adj', 16667));
      p.roundRect(0, 0, w, h, r);
      break;
    }
    case 'triangle': {
      const x = w * adj('adj', 50000);
      poly([x, 0], [w, h], [0, h]);
      break;
    }
    case 'rtTriangle':
      poly([0, 0], [w, h], [0, h]);
      break;
    case 'diamond':
    case 'flowChartDecision':
      poly([w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]);
      break;
    case 'parallelogram': {
      const x = ss * adj('adj', 25000);
      poly([x, 0], [w, 0], [w - x, h], [0, h]);
      break;
    }
    case 'trapezoid': {
      const x = ss * adj('adj', 25000);
      poly([x, 0], [w - x, 0], [w, h], [0, h]);
      break;
    }
    case 'homePlate': {
      const x = w - ss * adj('adj', 50000);
      poly([0, 0], [x, 0], [w, h / 2], [x, h], [0, h]);
      break;
    }
    case 'chevron': {
      const x = ss * adj('adj', 50000);
      poly([0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]);
      break;
    }
    case 'pentagon':
      poly([w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]);
      break;
    case 'hexagon': {
      const x = ss * adj('adj', 25000);
      poly([x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]);
      break;
    }
    case 'octagon': {
      const x = ss * adj('adj', 29289);
      poly([x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]);
      break;
    }
    case 'mathMinus': {
      const dy = (h * adj('adj1', 23520)) / 2;
      const dx = w * 0.3675;
      p.rect(w / 2 - dx, h / 2 - dy, dx * 2, dy * 2);
      break;
    }
    case 'snip1Rect': {
      const x = ss * adj('adj', 16667);
      poly([0, 0], [w - x, 0], [w, x], [w, h], [0, h]);
      break;
    }
    case 'round2SameRect': {
      const r = ss * adj('adj1', 16667);
      p.roundRect(0, 0, w, h, [r, r, 0, 0]);
      break;
    }
    case 'line':
    case 'straightConnector1':
    case 'bentConnector3':
      p.moveTo(0, 0);
      p.lineTo(w, h);
      break;
    default:
      p.rect(0, 0, w, h);
  }
  return p;
}

const isLine = (g: DeckGeometry) => 'preset' in g && ['line', 'straightConnector1', 'bentConnector3'].includes(g.preset);

/** A drawn shape's paths in a w × h box. */
function customPaths(paths: DeckPath[], w: number, h: number): { path: Path2D; fill: boolean; stroke: boolean }[] {
  return paths.map((dp) => {
    const sx = dp.w ? w / dp.w : 1;
    const sy = dp.h ? h / dp.h : 1;
    const p = new Path2D();
    let cx = 0;
    let cy = 0;
    for (const c of dp.commands) {
      switch (c.op) {
        case 'M':
          cx = c.x * sx;
          cy = c.y * sy;
          p.moveTo(cx, cy);
          break;
        case 'L':
          cx = c.x * sx;
          cy = c.y * sy;
          p.lineTo(cx, cy);
          break;
        case 'C':
          p.bezierCurveTo(c.x1 * sx, c.y1 * sy, c.x2 * sx, c.y2 * sy, c.x * sx, c.y * sy);
          cx = c.x * sx;
          cy = c.y * sy;
          break;
        case 'Q':
          p.quadraticCurveTo(c.x1 * sx, c.y1 * sy, c.x * sx, c.y * sy);
          cx = c.x * sx;
          cy = c.y * sy;
          break;
        case 'A': {
          // An arc of an ellipse from the current point, by its start and sweep angles.
          const rx = c.wR * sx;
          const ry = c.hR * sy;
          const param = (deg: number) => {
            const a = (deg * Math.PI) / 180;
            return Math.atan2(rx * Math.sin(a), ry * Math.cos(a));
          };
          const t1 = param(c.stAng);
          const t2 = t1 + (c.swAng * Math.PI) / 180;
          const ox = cx - rx * Math.cos(t1);
          const oy = cy - ry * Math.sin(t1);
          if (rx > 0 && ry > 0) p.ellipse(ox, oy, rx, ry, 0, t1, t2, c.swAng < 0);
          cx = ox + rx * Math.cos(t2);
          cy = oy + ry * Math.sin(t2);
          break;
        }
        case 'Z':
          p.closePath();
          break;
      }
    }
    return { path: p, fill: dp.fill, stroke: dp.stroke };
  });
}

function outlines(g: DeckGeometry, w: number, h: number) {
  if ('paths' in g) return customPaths(g.paths, w, h);
  return [{ path: presetPath(g.preset, w, h, g.adjust), fill: !isLine(g), stroke: true }];
}

// ---- Fills ------------------------------------------------------------------------------------

function drawImageInto(ctx: Ctx, img: CanvasImageSource, w: number, h: number, crop?: { l: number; t: number; r: number; b: number }) {
  const iw = (img as { width: number }).width;
  const ih = (img as { height: number }).height;
  if (!iw || !ih) return;
  const c = crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const sx = iw * c.l;
  const sy = ih * c.t;
  const sw = iw * (1 - c.l - c.r);
  const sh = ih * (1 - c.t - c.b);
  if (sw <= 0 || sh <= 0) return;
  // A crop beyond the picture (negative) leaves space around it.
  const dx = c.l < 0 ? (-c.l / (1 - c.l - c.r)) * w : 0;
  const dy = c.t < 0 ? (-c.t / (1 - c.t - c.b)) * h : 0;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const csx = clamp(sx, iw);
  const csy = clamp(sy, ih);
  const csw = Math.min(iw - csx, sw - (csx - sx));
  const csh = Math.min(ih - csy, sh - (csy - sy));
  ctx.drawImage(img, csx, csy, csw, csh, dx, dy, (csw / sw) * w, (csh / sh) * h);
}

function applyFill(ctx: Ctx, fill: DeckFill, w: number, h: number, images: Images, shape?: Path2D) {
  if (fill.kind === 'solid') {
    ctx.fillStyle = fill.color;
    if (shape) ctx.fill(shape);
    else ctx.fillRect(0, 0, w, h);
  } else if (fill.kind === 'gradient') {
    let g: CanvasGradient;
    if (fill.radial) g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    else {
      const a = (fill.angle * Math.PI) / 180;
      const half = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
      const dx = Math.cos(a) * half;
      const dy = Math.sin(a) * half;
      g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    }
    for (const s of fill.stops) g.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color);
    ctx.fillStyle = g;
    if (shape) ctx.fill(shape);
    else ctx.fillRect(0, 0, w, h);
  } else {
    const img = images.get(fill.image);
    if (!img) return;
    ctx.save();
    if (shape) ctx.clip(shape);
    if (fill.alpha !== undefined) ctx.globalAlpha *= fill.alpha;
    if (fill.tile) {
      const pattern = ctx.createPattern(img, 'repeat');
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
    } else drawImageInto(ctx, img, w, h, fill.crop);
    ctx.restore();
  }
}

function applyStroke(ctx: Ctx, stroke: DeckStroke, path: Path2D) {
  ctx.save();
  ctx.lineWidth = stroke.width;
  ctx.strokeStyle = stroke.color;
  ctx.lineJoin = 'round';
  if (stroke.dash) ctx.setLineDash(stroke.dash);
  ctx.stroke(path);
  ctx.restore();
}

// ---- Text -------------------------------------------------------------------------------------

const fontOf = (r: DeckRun, size: number) => `${r.italic ? 'italic ' : ''}${r.bold ? 700 : 400} ${size}px ${r.font}`;

/** A piece of a line: some text in one run's style, measured. */
interface Piece {
  run: DeckRun;
  text: string;
  width: number;
  size: number;
  space: boolean;
}

interface Line {
  pieces: Piece[];
  width: number;
  size: number;
  /** Where it starts, from the box's text area's left edge. */
  x: number;
  avail: number;
  last: boolean;
}

/** Splits a paragraph into lines that fit `width`, the first line from `firstX` and the rest from `restX`. */
function layoutParagraph(
  ctx: Ctx,
  para: DeckParagraph,
  width: number,
  firstX: number,
  restX: number,
  scale: number,
  wrap: boolean,
): Line[] {
  const tokens: Piece[] = [];
  const breaks = new Set<number>();
  for (const run of para.runs) {
    if (run.br) {
      breaks.add(tokens.length);
      continue;
    }
    const size = run.size * scale;
    ctx.font = fontOf(run, size);
    const text = run.caps ? run.text.toUpperCase() : run.text;
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      tokens.push({ run, text: part, width: ctx.measureText(part).width, size, space: /^\s+$/.test(part) });
    }
  }
  const lines: Line[] = [];
  const newLine = (): Line => {
    const x = lines.length === 0 ? firstX : restX;
    return { pieces: [], width: 0, size: 0, x, avail: width - x, last: false };
  };
  let line = newLine();
  const push = () => {
    // Spaces at the end of a line don't take room.
    while (line.pieces.length && line.pieces[line.pieces.length - 1].space) line.width -= line.pieces.pop()!.width;
    lines.push(line);
    line = newLine();
  };
  tokens.forEach((t, i) => {
    if (breaks.has(i)) push();
    if (t.space && !line.pieces.length && lines.length) return;
    if (wrap && !t.space && line.pieces.length && line.width + t.width > line.avail + 0.5) push();
    // A word longer than the line breaks between letters.
    if (wrap && !t.space && t.width > line.avail && !line.pieces.length) {
      ctx.font = fontOf(t.run, t.size);
      let chunk = '';
      for (const ch of t.text) {
        const w = ctx.measureText(chunk + ch).width;
        if (chunk && w > line.avail) {
          line.pieces.push({ ...t, text: chunk, width: ctx.measureText(chunk).width });
          line.width += ctx.measureText(chunk).width;
          line.size = Math.max(line.size, t.size);
          push();
          chunk = ch;
        } else chunk += ch;
      }
      const w = ctx.measureText(chunk).width;
      line.pieces.push({ ...t, text: chunk, width: w });
      line.width += w;
      line.size = Math.max(line.size, t.size);
      return;
    }
    line.pieces.push(t);
    line.width += t.width;
    line.size = Math.max(line.size, t.size);
  });
  if (breaks.has(tokens.length)) push();
  push();
  lines[lines.length - 1].last = true;
  for (const l of lines) if (!l.size) l.size = para.emptySize * scale;
  return lines;
}

/** The height of a line: PowerPoint's single spacing is about 1.2 times the font size. */
function lineHeight(para: DeckParagraph, size: number, reduction: number) {
  return 'px' in para.lineSpacing ? para.lineSpacing.px : size * 1.2 * para.lineSpacing.factor * (1 - reduction);
}

function drawText(ctx: Ctx, text: DeckText, w: number, h: number) {
  const left = text.insets.l;
  const width = Math.max(1, w - text.insets.l - text.insets.r);
  const scale = text.fontScale;
  type Laid = { para: DeckParagraph; lines: Line[]; before: number; after: number };
  const laid: Laid[] = text.paragraphs.map((para, i) => {
    let bulletWidth = 0;
    if (para.bullet) {
      const first = para.runs.find((r) => r.text) ?? para.runs[0];
      const size = (first?.size ?? para.emptySize) * scale * para.bullet.scale;
      ctx.font = `${size}px ${para.bullet.font ?? first?.font ?? 'sans-serif'}`;
      bulletWidth = ctx.measureText(para.bullet.text).width + size * 0.3;
    }
    const firstX = para.bullet ? Math.max(para.marginLeft, para.marginLeft + para.indent + bulletWidth) : para.marginLeft + para.indent;
    return {
      para,
      lines: layoutParagraph(ctx, para, width, Math.max(0, firstX), Math.max(0, para.marginLeft), scale, text.wrap),
      before: i === 0 ? 0 : para.spaceBefore * scale,
      after: para.spaceAfter * scale,
    };
  });
  let total = 0;
  laid.forEach((l, i) => {
    total += l.before;
    for (const line of l.lines) total += lineHeight(l.para, line.size, text.lineReduction);
    if (i < laid.length - 1) total += l.after;
  });
  const areaTop = text.insets.t;
  const areaH = h - text.insets.t - text.insets.b;
  let y = text.anchor === 'middle' ? areaTop + (areaH - total) / 2 : text.anchor === 'bottom' ? areaTop + areaH - total : areaTop;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const [pi, { para, lines, before, after }] of laid.entries()) {
    y += before;
    lines.forEach((line, li) => {
      const lh = lineHeight(para, line.size, text.lineReduction);
      // The text sits at the bottom of its line, as PowerPoint puts extra spacing above it.
      const baseline = y + lh - line.size * 0.24;
      let x = left + line.x;
      const free = line.avail - line.width;
      let gap = 0;
      if (para.align === 'center') x += free / 2;
      else if (para.align === 'right') x += free;
      else if (para.align === 'justify' && !line.last) {
        const spaces = line.pieces.filter((p) => p.space).length;
        if (spaces) gap = free / spaces;
      }
      if (li === 0 && para.bullet) {
        const b = para.bullet;
        const first = para.runs.find((r) => r.text) ?? para.runs[0];
        const size = (first?.size ?? para.emptySize) * text.fontScale * b.scale;
        ctx.font = `${size}px ${b.font ?? first?.font ?? 'sans-serif'}`;
        ctx.fillStyle = b.color ?? first?.color ?? '#000';
        ctx.fillText(b.text, left + Math.max(0, para.marginLeft + para.indent), baseline);
      }
      for (const piece of line.pieces) {
        const r = piece.run;
        ctx.font = fontOf(r, piece.size);
        ctx.fillStyle = r.color;
        const shift = -r.baseline * piece.size;
        if (!piece.space) ctx.fillText(piece.text, x, baseline + shift);
        if (r.underline || r.strike) {
          ctx.fillRect(
            x,
            baseline + shift + (r.underline ? piece.size * 0.1 : -piece.size * 0.3),
            piece.width + (piece.space ? gap : 0),
            Math.max(1, piece.size / 18),
          );
        }
        x += piece.width + (piece.space ? gap : 0);
      }
      y += lh;
    });
    if (pi < laid.length - 1) y += after;
  }
}

// ---- Elements ---------------------------------------------------------------------------------

/** Moves the drawing into an element's box, turned and flipped as it is. */
function enterBox(
  ctx: Ctx,
  e: { x: number; y: number; w: number; h: number; rotation: number; flipH: boolean; flipV: boolean },
  flip = true,
) {
  ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
  if (e.rotation) ctx.rotate((e.rotation * Math.PI) / 180);
  if (flip && (e.flipH || e.flipV)) ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.translate(-e.w / 2, -e.h / 2);
}

function drawElement(ctx: Ctx, e: DeckElement, images: Images) {
  ctx.save();
  if (e.kind === 'group') {
    // The children are placed on the slide already; turn and flip them about the group's middle.
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
    if (e.rotation) ctx.rotate((e.rotation * Math.PI) / 180);
    if (e.flipH || e.flipV) ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
    ctx.translate(-(e.x + e.w / 2), -(e.y + e.h / 2));
    for (const c of e.children) drawElement(ctx, c, images);
    ctx.restore();
    return;
  }
  enterBox(ctx, e);
  const shapes = outlines(e.geometry, e.w, e.h);
  if (e.kind === 'picture') {
    const img = images.get(e.image);
    if (img) {
      ctx.save();
      if (!('preset' in e.geometry && e.geometry.preset === 'rect')) ctx.clip(shapes[0].path);
      if (e.alpha !== undefined) ctx.globalAlpha *= e.alpha;
      drawImageInto(ctx, img, e.w, e.h, e.crop);
      ctx.restore();
    }
    if (e.stroke) applyStroke(ctx, e.stroke, shapes[0].path);
    ctx.restore();
    return;
  }
  for (const s of shapes) {
    if (s.fill && e.fill) applyFill(ctx, e.fill, e.w, e.h, images, s.path);
    if (s.stroke && e.stroke) applyStroke(ctx, e.stroke, s.path);
  }
  ctx.restore();
  if (e.text) {
    // Text turns with its shape but isn't mirrored by a flip.
    ctx.save();
    enterBox(ctx, e, false);
    drawText(ctx, e.text, e.w, e.h);
    ctx.restore();
  }
}

/** Draws a slide at the deck's size (1920 wide) onto ctx. */
export function drawDeckSlide(ctx: Ctx, deck: Pick<Deck, 'width' | 'height'>, slide: DeckSlide, images: Images) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, deck.width, deck.height);
  ctx.clip();
  if (slide.background) applyFill(ctx, slide.background, deck.width, deck.height, images);
  for (const e of slide.elements) drawElement(ctx, e, images);
  ctx.restore();
}

/**
 * A slide as a 1920 × 1080 JPEG for the screens: a slide of another shape (4:3, say) sits in the
 * middle on black.
 */
export async function renderDeckSlide(deck: Deck, slide: DeckSlide, images: Images, width = 1920, height = 1080): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas to draw on.');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / deck.width, height / deck.height);
  ctx.translate((width - deck.width * scale) / 2, (height - deck.height * scale) / 2);
  ctx.scale(scale, scale);
  drawDeckSlide(ctx, deck, slide, images);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('A slide couldn’t be drawn.');
  return blob;
}
