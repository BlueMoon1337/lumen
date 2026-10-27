/**
 * Reads a PowerPoint file (.pptx, as PowerPoint, Keynote and Google Slides save them) into
 * Lumen's deck model (src/deck.ts): every slide's shapes, pictures and text, with what they
 * inherit from the slide's layout, the master and the theme worked out (positions of
 * placeholders, text styles, theme colors and fonts, backgrounds).
 *
 * Not read (yet): tables and charts (their text is still found, for search), animations,
 * videos, and SmartArt. The embedded fonts are MicroType-compressed and can't be loaded, so
 * text is set in the nearest font installed (see fontStack).
 */
import {
  DECK_WIDTH,
  type Deck,
  type DeckBullet,
  type DeckColor,
  type DeckElement,
  type DeckFill,
  type DeckGeometry,
  type DeckParagraph,
  type DeckPath,
  type DeckRun,
  type DeckSlide,
  type DeckStroke,
  type DeckText,
} from '../deck';
import { attrOf, child, children, descendants, local, numAttr, parseXml, path, type XmlElement } from './xml';
import { readZip } from './zip';

const EMU_PER_PT = 12700;

interface Part {
  path: string;
  xml: XmlElement;
  /** Relationship id → target path in the file. */
  rels: Map<string, string>;
  /** The first target of each kind of relationship ("slideLayout", "notesSlide"…). */
  relsByType: Map<string, string>;
}

interface Theme {
  colors: Record<string, string>;
  majorFont: string;
  minorFont: string;
}

interface Ctx {
  files: Map<string, Uint8Array>;
  /** Pixels per EMU. */
  scale: number;
  theme: Theme;
  clrMap: Record<string, string>;
  parts: Map<string, Part>;
  /** The fill of the group being read, for shapes filled "as the group" (grpFill). */
  groupFill?: DeckFill | null;
}

const utf8 = new TextDecoder('utf-8');

function dirOf(p: string) {
  return p.slice(0, p.lastIndexOf('/') + 1);
}

/** "../media/image1.png" relative to "ppt/slides/" → "ppt/media/image1.png". */
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dirOf(base) + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function loadPart(ctx: Pick<Ctx, 'files' | 'parts'>, partPath: string): Part | undefined {
  const cached = ctx.parts.get(partPath);
  if (cached) return cached;
  const bytes = ctx.files.get(partPath);
  if (!bytes) return undefined;
  const relsPath = `${dirOf(partPath)}_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`;
  const rels = new Map<string, string>();
  const relsByType = new Map<string, string>();
  const relBytes = ctx.files.get(relsPath);
  if (relBytes) {
    for (const r of children(parseXml(utf8.decode(relBytes)), 'Relationship')) {
      if (r.attrs.TargetMode === 'External') continue;
      const target = resolvePath(partPath, r.attrs.Target ?? '');
      rels.set(r.attrs.Id, target);
      const type = (r.attrs.Type ?? '').replace(/^.*\//, '');
      if (!relsByType.has(type)) relsByType.set(type, target);
    }
  }
  const part = { path: partPath, xml: parseXml(utf8.decode(bytes)), rels, relsByType };
  ctx.parts.set(partPath, part);
  return part;
}

const relTarget = (part: Part, type: string) => part.relsByType.get(type);

// ---- Colors -----------------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(0, 6).padEnd(6, '0'), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  orange: 'FFA500',
  purple: '800080',
};

/** A color element's color (srgbClr, schemeClr…) with its tint, shade, luminance and alpha changes. */
function colorOf(ctx: Ctx, holder: XmlElement | undefined, phClr?: string): DeckColor | undefined {
  const el = holder?.children.find((c) => /^(srgbClr|schemeClr|sysClr|prstClr|scrgbClr|hslClr)$/.test(local(c.name)));
  if (!el) return undefined;
  let hex: string | undefined;
  switch (local(el.name)) {
    case 'srgbClr':
      hex = el.attrs.val;
      break;
    case 'sysClr':
      hex = el.attrs.lastClr ?? (el.attrs.val === 'window' ? 'FFFFFF' : '000000');
      break;
    case 'prstClr':
      hex = PRESET_COLORS[el.attrs.val] ?? '000000';
      break;
    case 'scrgbClr': {
      const c = ['r', 'g', 'b'].map((k) => Math.round((Number(el.attrs[k]) / 100000) * 255));
      hex = c.map((v) => v.toString(16).padStart(2, '0')).join('');
      break;
    }
    case 'schemeClr': {
      const v = el.attrs.val;
      if (v === 'phClr') hex = phClr;
      else hex = ctx.theme.colors[ctx.clrMap[v] ?? v] ?? ctx.theme.colors[v];
      break;
    }
    default:
      hex = '000000';
  }
  if (!hex) return undefined;
  let rgb = hexToRgb(hex);
  let alpha = 1;
  for (const m of el.children) {
    const val = Number(m.attrs.val) / 100000;
    switch (local(m.name)) {
      case 'alpha':
        alpha = val;
        break;
      case 'lumMod': {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, Math.min(1, l * val)]);
        break;
      }
      case 'lumOff': {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, s, Math.min(1, Math.max(0, l + val))]);
        break;
      }
      case 'satMod': {
        const [h, s, l] = rgbToHsl(rgb);
        rgb = hslToRgb([h, Math.min(1, s * val), l]);
        break;
      }
      case 'tint':
        rgb = rgb.map((c) => c + (255 - c) * (1 - val)) as [number, number, number];
        break;
      case 'shade':
        rgb = rgb.map((c) => c * val) as [number, number, number];
        break;
    }
  }
  const [r, g, b] = rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

/** The plain hex of a scheme color, for phClr. */
function hexOf(ctx: Ctx, holder: XmlElement | undefined): string | undefined {
  const c = colorOf(ctx, holder);
  const m = c?.match(/rgba\((\d+), (\d+), (\d+)/);
  return m ? [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('') : undefined;
}

// ---- Fills and lines --------------------------------------------------------------------------

/** A fill from an element holding one (spPr, bgPr…): undefined when it names none, null for noFill. */
function fillOf(ctx: Ctx, part: Part, holder: XmlElement | undefined, phClr?: string): DeckFill | null | undefined {
  if (!holder) return undefined;
  for (const c of holder.children) {
    switch (local(c.name)) {
      case 'noFill':
        return null;
      case 'solidFill': {
        const color = colorOf(ctx, c, phClr);
        return color ? { kind: 'solid', color } : undefined;
      }
      case 'gradFill': {
        const stops = children(child(c, 'gsLst'), 'gs')
          .map((gs) => ({ pos: (numAttr(gs, 'pos') ?? 0) / 100000, color: colorOf(ctx, gs, phClr) ?? 'rgba(0, 0, 0, 1)' }))
          .sort((a, b) => a.pos - b.pos);
        if (!stops.length) return undefined;
        const lin = child(c, 'lin');
        return { kind: 'gradient', angle: (numAttr(lin, 'ang') ?? 0) / 60000, radial: !!child(c, 'path'), stops };
      }
      case 'blipFill': {
        const blip = child(c, 'blip');
        const image = part.rels.get(attrOf(blip, 'embed') ?? '');
        if (!image) return undefined;
        const alphaMod = child(blip, 'alphaModFix');
        return {
          kind: 'image',
          image,
          crop: cropOf(child(c, 'srcRect')),
          alpha: alphaMod ? (numAttr(alphaMod, 'amt') ?? 100000) / 100000 : undefined,
          tile: !!child(c, 'tile'),
        };
      }
      case 'pattFill': {
        const color = colorOf(ctx, child(c, 'fgClr'), phClr);
        return color ? { kind: 'solid', color } : undefined;
      }
      case 'grpFill':
        return ctx.groupFill;
    }
  }
  return undefined;
}

function cropOf(src: XmlElement | undefined) {
  if (!src) return undefined;
  const v = (k: string) => (numAttr(src, k) ?? 0) / 100000;
  const crop = { l: v('l'), t: v('t'), r: v('r'), b: v('b') };
  return crop.l || crop.t || crop.r || crop.b ? crop : undefined;
}

const DASHES: Record<string, number[]> = {
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  dot: [1, 2],
  lgDash: [8, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
};

function strokeOf(ctx: Ctx, part: Part, ln: XmlElement | undefined, phClr?: string): DeckStroke | null | undefined {
  if (!ln) return undefined;
  if (child(ln, 'noFill')) return null;
  const fill = fillOf(ctx, part, ln, phClr);
  if (!fill || fill.kind !== 'solid') return fill === null ? null : undefined;
  const width = Math.max(1, (numAttr(ln, 'w') ?? 9525) * ctx.scale);
  const dash = DASHES[child(ln, 'prstDash')?.attrs.val ?? ''];
  return { color: fill.color, width, dash: dash?.map((d) => d * width) };
}

// ---- Text -------------------------------------------------------------------------------------

/** Paragraph and run properties gathered from the levels a paragraph inherits, later ones winning. */
interface Props {
  algn?: string;
  marL?: number;
  indent?: number;
  lnSpc?: XmlElement;
  spcBef?: XmlElement;
  spcAft?: XmlElement;
  bullet?: XmlElement;
  buFont?: string;
  buClr?: XmlElement;
  buSzPct?: number;
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  cap?: string;
  baseline?: number;
  fill?: XmlElement;
  font?: string;
}

function mergePPr(into: Props, pPr: XmlElement | undefined): Props {
  if (!pPr) return into;
  const out = { ...into };
  if (pPr.attrs.algn) out.algn = pPr.attrs.algn;
  if (pPr.attrs.marL !== undefined) out.marL = Number(pPr.attrs.marL);
  if (pPr.attrs.indent !== undefined) out.indent = Number(pPr.attrs.indent);
  for (const c of pPr.children) {
    switch (local(c.name)) {
      case 'lnSpc':
        out.lnSpc = c;
        break;
      case 'spcBef':
        out.spcBef = c;
        break;
      case 'spcAft':
        out.spcAft = c;
        break;
      case 'buNone':
      case 'buChar':
      case 'buAutoNum':
        out.bullet = c;
        break;
      case 'buFont':
        out.buFont = c.attrs.typeface;
        break;
      case 'buClr':
        out.buClr = c;
        break;
      case 'buSzPct':
        out.buSzPct = Number(c.attrs.val) / 100000;
        break;
      case 'defRPr':
        Object.assign(out, mergeRPr({}, c, out));
        break;
    }
  }
  return out;
}

function mergeRPr(into: Props, rPr: XmlElement | undefined, base: Props = into): Props {
  if (!rPr) return into;
  const out: Props = { ...into };
  const a = rPr.attrs;
  if (a.sz) out.sz = Number(a.sz);
  else if (base.sz !== undefined) out.sz = base.sz;
  if (a.b !== undefined) out.b = a.b === '1' || a.b === 'true';
  if (a.i !== undefined) out.i = a.i === '1' || a.i === 'true';
  if (a.u !== undefined) out.u = a.u !== 'none';
  if (a.strike !== undefined) out.strike = a.strike !== 'noStrike';
  if (a.cap !== undefined) out.cap = a.cap;
  if (a.baseline !== undefined) out.baseline = Number(a.baseline) / 100000;
  for (const c of rPr.children) {
    const n = local(c.name);
    if (n === 'solidFill' || n === 'noFill' || n === 'gradFill') out.fill = c;
    else if (n === 'latin' && c.attrs.typeface) out.font = c.attrs.typeface;
  }
  return out;
}

/** Fonts the file names, as CSS lists with what's likely installed when they aren't. */
const FONT_FALLBACKS: [RegExp, string][] = [
  [/^arvo/i, '"Rockwell", "Roboto Slab", "Courier New", serif'],
  [/roboto condensed|narrow|condensed/i, '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif'],
  [/^calibri/i, '"Calibri", "Carlito", "Helvetica Neue", Arial, sans-serif'],
  [/^cambria/i, '"Cambria", "Caladea", Georgia, serif'],
  [/^(times|georgia|garamond|book antiqua|palatino)/i, 'Georgia, "Times New Roman", serif'],
  [/^(montserrat|raleway|lato|open sans|roboto|source sans|poppins|oswald|nunito)/i, '"Helvetica Neue", Arial, sans-serif'],
  [/^(courier|consolas|menlo|monaco)/i, 'Menlo, "Courier New", monospace'],
];

export function fontStack(name: string): string {
  const fallback = FONT_FALLBACKS.find(([re]) => re.test(name))?.[1] ?? '"Helvetica Neue", Arial, sans-serif';
  return `"${name.replace(/"/g, '')}", ${fallback}`;
}

function fontName(ctx: Ctx, typeface: string | undefined): string {
  if (!typeface || typeface === '+mn-lt' || typeface === '+mn-ea') return ctx.theme.minorFont;
  if (typeface === '+mj-lt' || typeface === '+mj-ea') return ctx.theme.majorFont;
  return typeface;
}

const NUMBERING: Record<string, (n: number) => string> = {
  arabicPeriod: (n) => `${n}.`,
  arabicParenR: (n) => `${n})`,
  arabicParenBoth: (n) => `(${n})`,
  arabicPlain: (n) => `${n}`,
  alphaLcPeriod: (n) => `${letters(n).toLowerCase()}.`,
  alphaUcPeriod: (n) => `${letters(n)}.`,
  alphaLcParenR: (n) => `${letters(n).toLowerCase()})`,
  alphaUcParenR: (n) => `${letters(n)})`,
  romanLcPeriod: (n) => `${roman(n).toLowerCase()}.`,
  romanUcPeriod: (n) => `${roman(n)}.`,
};

const letters = (n: number) => {
  let s = '';
  for (n = Math.max(1, n); n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const roman = (n: number) => {
  const map: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let s = '';
  for (const [v, r] of map) while (n >= v) ((s += r), (n -= v));
  return s;
};

/** Where a shape's text styles come from, lowest first: one list of lvlNpPr-holders per source. */
type StyleChain = (XmlElement | undefined)[];

function textOf(ctx: Ctx, txBody: XmlElement, chain: StyleChain, bodyPrs: (XmlElement | undefined)[], fontRefColor?: XmlElement): DeckText {
  const scale = ctx.scale;
  // bodyPr: insets, anchoring, wrapping and autofit, from the master's placeholder up to this one.
  const bodyAttrs: Record<string, string> = {};
  let autofit: XmlElement | undefined;
  for (const b of [...bodyPrs, child(txBody, 'bodyPr')]) {
    if (!b) continue;
    Object.assign(bodyAttrs, b.attrs);
    const fit = child(b, 'normAutofit') ?? child(b, 'noAutofit') ?? child(b, 'spAutoFit');
    if (fit) autofit = fit;
  }
  const inset = (k: string, d: number) => (bodyAttrs[k] !== undefined ? Number(bodyAttrs[k]) : d) * scale;
  const fontScale = autofit && local(autofit.name) === 'normAutofit' ? (numAttr(autofit, 'fontScale') ?? 100000) / 100000 : 1;
  const lineReduction = autofit && local(autofit.name) === 'normAutofit' ? (numAttr(autofit, 'lnSpcReduction') ?? 0) / 100000 : 0;

  const lstStyle = child(txBody, 'lstStyle');
  const numbers = new Map<number, number>();
  const paragraphs: DeckParagraph[] = children(txBody, 'p').map((p) => {
    const pPr = child(p, 'pPr');
    const level = Number(pPr?.attrs.lvl ?? 0);
    const lvlName = `lvl${level + 1}pPr`;
    let props: Props = {};
    for (const source of chain) props = mergePPr(mergePPr(props, child(source, 'defPPr')), child(source, lvlName));
    // A shape style's text color (fontRef) wins over the master's text styles, not the shape's own.
    if (colorOf(ctx, fontRefColor)) props = { ...props, fill: undefined };
    props = mergePPr(mergePPr(mergePPr(props, child(lstStyle, 'defPPr')), child(lstStyle, lvlName)), pPr);
    const size = ((props.sz ?? 1800) / 100) * EMU_PER_PT * scale;
    const defaultColor = colorOf(ctx, fontRefColor) ?? 'rgba(0, 0, 0, 1)';

    const runOf = (r: XmlElement, text: string, br = false): DeckRun => {
      const rp = mergeRPr(props, child(r, 'rPr'));
      const sz = ((rp.sz ?? 1800) / 100) * EMU_PER_PT * scale;
      const fill = rp.fill;
      const color =
        fill && local(fill.name) === 'solidFill'
          ? (colorOf(ctx, fill) ?? defaultColor)
          : fill && local(fill.name) === 'noFill'
            ? 'rgba(0, 0, 0, 0)'
            : defaultColor;
      return {
        text,
        font: fontStack(fontName(ctx, rp.font)),
        size: sz,
        bold: !!rp.b,
        italic: !!rp.i,
        underline: !!rp.u,
        strike: !!rp.strike,
        color,
        caps: rp.cap === 'all',
        baseline: rp.baseline ?? 0,
        br,
      };
    };
    const runs: DeckRun[] = [];
    for (const c of p.children) {
      const n = local(c.name);
      if (n === 'r' || n === 'fld') runs.push(runOf(c, child(c, 't')?.text ?? ''));
      else if (n === 'br') runs.push(runOf(c, '', true));
    }

    // Bullets: a character, an automatic number, or none.
    let bullet: DeckBullet | undefined;
    const bu = props.bullet;
    const firstRun = runs.find((r) => r.text) ?? runs[0];
    if (bu && local(bu.name) !== 'buNone' && runs.some((r) => r.text.trim())) {
      const font = props.buFont && !props.buFont.startsWith('+') ? fontStack(props.buFont) : firstRun?.font;
      const color = props.buClr ? colorOf(ctx, props.buClr) : firstRun?.color;
      if (local(bu.name) === 'buChar') {
        const symbol = symbolBullet(props.buFont, bu.attrs.char ?? '•');
        bullet = { text: symbol ?? bu.attrs.char ?? '•', font: symbol ? firstRun?.font : font, color, scale: props.buSzPct ?? 1 };
      } else {
        const start = Number(bu.attrs.startAt ?? 1);
        const n = (numbers.get(level) ?? start - 1) + 1;
        numbers.set(level, n);
        bullet = { text: (NUMBERING[bu.attrs.type] ?? NUMBERING.arabicPeriod)(n), font: firstRun?.font, color, scale: props.buSzPct ?? 1 };
      }
      // A deeper level restarts its numbering; a shallower one keeps going.
      for (const k of [...numbers.keys()]) if (k > level) numbers.delete(k);
    } else numbers.delete(level);

    const spacing = (el: XmlElement | undefined): number => {
      const pts = child(el, 'spcPts');
      if (pts) return ((numAttr(pts, 'val') ?? 0) / 100) * EMU_PER_PT * scale;
      const pct = child(el, 'spcPct');
      if (pct) return ((numAttr(pct, 'val') ?? 0) / 100000) * size;
      return 0;
    };
    const lnPts = child(props.lnSpc, 'spcPts');
    const lnPct = child(props.lnSpc, 'spcPct');
    const lineSpacing = lnPts
      ? { px: ((numAttr(lnPts, 'val') ?? 0) / 100) * EMU_PER_PT * scale }
      : { factor: lnPct ? (numAttr(lnPct, 'val') ?? 100000) / 100000 : 1 };
    const align =
      ({ ctr: 'center', r: 'right', just: 'justify', dist: 'justify' } as Record<string, DeckParagraph['align']>)[props.algn ?? ''] ??
      'left';
    const endSize = child(p, 'endParaRPr')?.attrs.sz;
    return {
      align,
      marginLeft: (props.marL ?? 0) * scale,
      indent: (props.indent ?? 0) * scale,
      lineSpacing,
      spaceBefore: spacing(props.spcBef),
      spaceAfter: spacing(props.spcAft),
      bullet,
      runs,
      emptySize: endSize ? (Number(endSize) / 100) * EMU_PER_PT * scale : size,
    };
  });

  return {
    paragraphs,
    insets: { l: inset('lIns', 91440), t: inset('tIns', 45720), r: inset('rIns', 91440), b: inset('bIns', 45720) },
    anchor: bodyAttrs.anchor === 'ctr' ? 'middle' : bodyAttrs.anchor === 'b' ? 'bottom' : 'top',
    wrap: bodyAttrs.wrap !== 'none',
    fontScale,
    lineReduction,
    vertical: !!bodyAttrs.vert && bodyAttrs.vert !== 'horz',
  };
}

/** A text body's words: paragraphs on lines of their own. */
function plainText(txBody: XmlElement | undefined): string {
  if (!txBody) return '';
  return children(txBody, 'p')
    .map((p) =>
      p.children
        .map((c) => (local(c.name) === 'br' ? '\n' : local(c.name) === 'r' || local(c.name) === 'fld' ? (child(c, 't')?.text ?? '') : ''))
        .join(''),
    )
    .join('\n')
    .trim();
}

/** Wingdings and Symbol bullets are letters drawn as pictures by those fonts; their look-alikes. */
const WINGDINGS: Record<string, string> = {
  Ø: '➢',
  '§': '▪',
  ü: '✓',
  û: '✗',
  l: '●',
  n: '■',
  o: '□',
  q: '❑',
  u: '◆',
  v: '❖',
  w: '⬥',
  Ä: '➢',
  à: '➔',
  è: '➜',
  ð: '⇨',
  '\uF0D8': '➢',
  '\uF0A7': '▪',
  '\uF0FC': '✓',
  '\uF06C': '●',
  '\uF06E': '■',
  '\uF076': '❖',
};
function symbolBullet(font: string | undefined, char: string): string | undefined {
  const f = font?.toLowerCase() ?? '';
  if (f.startsWith('wingdings')) return WINGDINGS[char] ?? '•';
  if (f === 'symbol') return char === '·' || char === '\uF0B7' ? '•' : undefined;
  return undefined;
}

// ---- Shapes -----------------------------------------------------------------------------------

interface Placeholder {
  type: string;
  idx?: string;
}

function placeholderOf(el: XmlElement): Placeholder | undefined {
  const nv = el.children.find((c) => /^nv.*Pr$/.test(local(c.name)));
  const ph = path(nv, 'nvPr', 'ph');
  if (!ph) return undefined;
  return { type: ph.attrs.type ?? 'body', idx: ph.attrs.idx };
}

/** The shape a placeholder inherits from, in a layout or master. */
function findPlaceholder(part: Part | undefined, ph: Placeholder, byTypeOnly = false): XmlElement | undefined {
  if (!part) return undefined;
  const shapes = descendants(path(part.xml, 'cSld', 'spTree'), 'sp');
  const typeOf = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
  if (!byTypeOnly && ph.idx !== undefined) {
    const byIdx = shapes.find((s) => placeholderOf(s)?.idx === ph.idx);
    if (byIdx) return byIdx;
  }
  return (
    shapes.find((s) => placeholderOf(s)?.type === ph.type) ??
    shapes.find((s) => {
      const t = placeholderOf(s)?.type;
      return t !== undefined && typeOf(t) === typeOf(ph.type);
    })
  );
}

interface Inherit {
  layout?: Part;
  master?: Part;
  /** presentation.xml's defaultTextStyle. */
  defaultTextStyle?: XmlElement;
}

function xfrmBox(ctx: Ctx, xfrm: XmlElement | undefined) {
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  if (!off || !ext) return undefined;
  return {
    x: (numAttr(off, 'x') ?? 0) * ctx.scale,
    y: (numAttr(off, 'y') ?? 0) * ctx.scale,
    w: (numAttr(ext, 'cx') ?? 0) * ctx.scale,
    h: (numAttr(ext, 'cy') ?? 0) * ctx.scale,
    rotation: (numAttr(xfrm, 'rot') ?? 0) / 60000,
    flipH: xfrm?.attrs.flipH === '1',
    flipV: xfrm?.attrs.flipV === '1',
  };
}

function geometryOf(spPr: XmlElement | undefined): DeckGeometry {
  const prst = child(spPr, 'prstGeom');
  if (prst) {
    const adjust: Record<string, number> = {};
    for (const gd of children(child(prst, 'avLst'), 'gd')) {
      const m = gd.attrs.fmla?.match(/^val\s+(-?\d+)/);
      if (m) adjust[gd.attrs.name] = Number(m[1]);
    }
    return { preset: prst.attrs.prst ?? 'rect', adjust };
  }
  const cust = child(spPr, 'custGeom');
  if (cust) {
    const paths: DeckPath[] = children(child(cust, 'pathLst'), 'path').map((p) => {
      const pt = (el: XmlElement | undefined) => ({ x: numAttr(el, 'x') ?? 0, y: numAttr(el, 'y') ?? 0 });
      const commands: DeckPath['commands'] = [];
      for (const c of p.children) {
        const pts = children(c, 'pt');
        switch (local(c.name)) {
          case 'moveTo':
            commands.push({ op: 'M', ...pt(pts[0]) });
            break;
          case 'lnTo':
            commands.push({ op: 'L', ...pt(pts[0]) });
            break;
          case 'cubicBezTo': {
            const [a, b, d] = pts.map(pt);
            if (a && b && d) commands.push({ op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: d.x, y: d.y });
            break;
          }
          case 'quadBezTo': {
            const [a, d] = pts.map(pt);
            if (a && d) commands.push({ op: 'Q', x1: a.x, y1: a.y, x: d.x, y: d.y });
            break;
          }
          case 'arcTo':
            commands.push({
              op: 'A',
              wR: numAttr(c, 'wR') ?? 0,
              hR: numAttr(c, 'hR') ?? 0,
              stAng: (numAttr(c, 'stAng') ?? 0) / 60000,
              swAng: (numAttr(c, 'swAng') ?? 0) / 60000,
            });
            break;
          case 'close':
            commands.push({ op: 'Z' });
            break;
        }
      }
      return {
        w: numAttr(p, 'w') ?? 0,
        h: numAttr(p, 'h') ?? 0,
        fill: p.attrs.fill !== 'none',
        stroke: p.attrs.stroke !== '0' && p.attrs.stroke !== 'false',
        commands,
      };
    });
    return { paths };
  }
  return { preset: 'rect', adjust: {} };
}

function shapeOf(ctx: Ctx, part: Part, sp: XmlElement, inherit: Inherit): DeckElement | undefined {
  const ph = placeholderOf(sp);
  const layoutPh = ph ? findPlaceholder(inherit.layout, ph) : undefined;
  const masterPh = ph ? (findPlaceholder(inherit.master, ph, true) ?? findPlaceholder(inherit.master, ph)) : undefined;
  const spPr = child(sp, 'spPr');
  const box =
    xfrmBox(ctx, child(spPr, 'xfrm')) ?? xfrmBox(ctx, path(layoutPh, 'spPr', 'xfrm')) ?? xfrmBox(ctx, path(masterPh, 'spPr', 'xfrm'));
  if (!box) return undefined;

  // Fill and line: the shape's own, its placeholder's, or its style's (p:style).
  const style = child(sp, 'style');
  const styleFill = child(style, 'fillRef');
  const styleLine = child(style, 'lnRef');
  const phClrFill = hexOf(ctx, styleFill);
  let fill = fillOf(ctx, part, spPr, phClrFill);
  if (fill === undefined && layoutPh) fill = fillOf(ctx, inherit.layout!, child(layoutPh, 'spPr'));
  if (fill === undefined && masterPh) fill = fillOf(ctx, inherit.master!, child(masterPh, 'spPr'));
  if (fill === undefined && styleFill && Number(styleFill.attrs.idx) > 0) {
    const color = colorOf(ctx, styleFill);
    if (color) fill = { kind: 'solid', color };
  }
  let stroke = strokeOf(ctx, part, child(spPr, 'ln'), hexOf(ctx, styleLine));
  if (stroke === undefined && styleLine && Number(styleLine.attrs.idx) > 0) {
    const color = colorOf(ctx, styleLine);
    if (color) stroke = { color, width: Math.max(1, 12700 * ctx.scale) };
  }

  const txBody = child(sp, 'txBody');
  let text: DeckText | undefined;
  if (txBody && descendants(txBody, 't').some((t) => t.text.trim())) {
    const masterStyles = path(inherit.master?.xml, 'txStyles');
    const t = ph?.type;
    const level = !ph
      ? [inherit.defaultTextStyle, child(masterStyles, 'otherStyle')]
      : t === 'title' || t === 'ctrTitle'
        ? [child(masterStyles, 'titleStyle')]
        : t === 'body' || t === 'subTitle' || t === 'obj'
          ? [child(masterStyles, 'bodyStyle')]
          : [child(masterStyles, 'otherStyle')];
    const chain: StyleChain = [...level, path(masterPh, 'txBody', 'lstStyle'), path(layoutPh, 'txBody', 'lstStyle')];
    text = textOf(ctx, txBody, chain, [path(masterPh, 'txBody', 'bodyPr'), path(layoutPh, 'txBody', 'bodyPr')], child(style, 'fontRef'));
  }
  const geometry = geometryOf(spPr ?? undefined);
  if (!text && !fill && !stroke) return undefined;
  return { kind: 'shape', ...box, ...(ph ? { placeholder: ph.type } : {}), geometry, fill: fill ?? null, stroke: stroke ?? null, text };
}

function pictureOf(ctx: Ctx, part: Part, pic: XmlElement): DeckElement | undefined {
  const spPr = child(pic, 'spPr');
  const box = xfrmBox(ctx, child(spPr, 'xfrm'));
  const blipFill = child(pic, 'blipFill');
  const blip = child(blipFill, 'blip');
  const image = part.rels.get(attrOf(blip, 'embed') ?? '');
  if (!box || !image) return undefined;
  const alphaMod = child(blip, 'alphaModFix');
  return {
    kind: 'picture',
    ...box,
    image,
    crop: cropOf(child(blipFill, 'srcRect')),
    alpha: alphaMod ? (numAttr(alphaMod, 'amt') ?? 100000) / 100000 : undefined,
    geometry: geometryOf(spPr),
    stroke: strokeOf(ctx, part, child(spPr, 'ln')) ?? null,
  };
}

function elementsOf(ctx: Ctx, part: Part, tree: XmlElement | undefined, inherit: Inherit, skipPlaceholders: boolean): DeckElement[] {
  const out: DeckElement[] = [];
  for (const el of tree?.children ?? []) {
    const n = local(el.name);
    if (skipPlaceholders && (n === 'sp' || n === 'pic') && placeholderOf(el)) continue;
    let made: DeckElement | undefined;
    if (n === 'sp' || n === 'cxnSp') made = shapeOf(ctx, part, el, inherit);
    else if (n === 'pic') made = pictureOf(ctx, part, el);
    else if (n === 'grpSp') made = groupOf(ctx, part, el, inherit, skipPlaceholders);
    else if (n === 'AlternateContent') {
      // Newer content with a fallback older readers understand: take the fallback.
      const fallback = child(el, 'Fallback');
      out.push(...elementsOf(ctx, part, fallback, inherit, skipPlaceholders));
      continue;
    }
    if (made) out.push(made);
  }
  return out;
}

function groupOf(ctx: Ctx, part: Part, grp: XmlElement, inherit: Inherit, skipPlaceholders: boolean): DeckElement | undefined {
  const xfrm = path(grp, 'grpSpPr', 'xfrm');
  const box = xfrmBox(ctx, xfrm);
  const chOff = child(xfrm, 'chOff');
  const chExt = child(xfrm, 'chExt');
  const own = fillOf(ctx, part, child(grp, 'grpSpPr'));
  const groupCtx = { ...ctx, groupFill: own === undefined ? ctx.groupFill : own };
  const kids = elementsOf(groupCtx, part, grp, inherit, skipPlaceholders);
  if (!box || !kids.length) return undefined;
  // Children are placed in the group's own coordinates; map them onto the group's box.
  const cx = (numAttr(chOff, 'x') ?? 0) * ctx.scale;
  const cy = (numAttr(chOff, 'y') ?? 0) * ctx.scale;
  const cw = (numAttr(chExt, 'cx') ?? 0) * ctx.scale || box.w;
  const ch = (numAttr(chExt, 'cy') ?? 0) * ctx.scale || box.h;
  const sx = cw ? box.w / cw : 1;
  const sy = ch ? box.h / ch : 1;
  const place = (e: DeckElement): DeckElement => {
    const moved = { ...e, x: box.x + (e.x - cx) * sx, y: box.y + (e.y - cy) * sy, w: e.w * sx, h: e.h * sy };
    if (moved.kind === 'group') moved.children = moved.children.map(place);
    if (moved.kind === 'shape' && moved.text && (sx !== 1 || sy !== 1)) {
      const k = Math.min(sx, sy);
      moved.text = {
        ...moved.text,
        insets: { l: moved.text.insets.l * sx, r: moved.text.insets.r * sx, t: moved.text.insets.t * sy, b: moved.text.insets.b * sy },
        paragraphs: moved.text.paragraphs.map((p) => ({
          ...p,
          marginLeft: p.marginLeft * sx,
          indent: p.indent * sx,
          spaceBefore: p.spaceBefore * k,
          spaceAfter: p.spaceAfter * k,
          emptySize: p.emptySize * k,
          lineSpacing: 'px' in p.lineSpacing ? { px: p.lineSpacing.px * k } : p.lineSpacing,
          runs: p.runs.map((r) => ({ ...r, size: r.size * k })),
        })),
      };
    }
    return moved;
  };
  return { kind: 'group', ...box, children: kids.map(place) };
}

/** A slide's, layout's or master's background, if it has one of its own. */
function backgroundOf(ctx: Ctx, part: Part | undefined): DeckFill | null | undefined {
  const bg = path(part?.xml, 'cSld', 'bg');
  if (!bg || !part) return undefined;
  const bgPr = child(bg, 'bgPr');
  if (bgPr) return fillOf(ctx, part, bgPr);
  const ref = child(bg, 'bgRef');
  if (ref) {
    const color = colorOf(ctx, ref);
    return color ? { kind: 'solid', color } : undefined;
  }
  return undefined;
}

function themeOf(files: Map<string, Uint8Array>, themePath: string | undefined): Theme {
  const theme: Theme = { colors: {}, majorFont: 'Calibri Light', minorFont: 'Calibri' };
  const bytes = themePath ? files.get(themePath) : undefined;
  if (!bytes) return theme;
  const xml = parseXml(utf8.decode(bytes));
  const scheme = path(xml, 'themeElements', 'clrScheme');
  for (const c of scheme?.children ?? []) {
    const v = c.children[0];
    if (!v) continue;
    theme.colors[local(c.name)] = local(v.name) === 'sysClr' ? (v.attrs.lastClr ?? '000000') : (v.attrs.val ?? '000000');
  }
  const fonts = path(xml, 'themeElements', 'fontScheme');
  theme.majorFont = path(fonts, 'majorFont', 'latin')?.attrs.typeface || theme.majorFont;
  theme.minorFont = path(fonts, 'minorFont', 'latin')?.attrs.typeface || theme.minorFont;
  return theme;
}

function clrMapOf(el: XmlElement | undefined): Record<string, string> {
  return el ? { ...el.attrs } : { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
}

/** Lumen's model of a PowerPoint file. */
export function parsePptx(bytes: Uint8Array): Deck {
  const files = readZip(bytes);
  const parts = new Map<string, Part>();
  const presPath = 'ppt/presentation.xml';
  const pres = loadPart({ files, parts }, presPath);
  if (!pres) throw new Error('This isn’t a PowerPoint file (there’s no ppt/presentation.xml in it).');
  const sldSz = path(pres.xml, 'sldSz');
  const cx = numAttr(sldSz, 'cx') ?? 12192000;
  const cy = numAttr(sldSz, 'cy') ?? 6858000;
  const scale = DECK_WIDTH / cx;
  const defaultTextStyle = path(pres.xml, 'defaultTextStyle');

  const slideIds = children(path(pres.xml, 'sldIdLst'), 'sldId');
  const fonts = new Set<string>(
    children(path(pres.xml, 'embeddedFontLst'), 'embeddedFont')
      .map((f) => path(f, 'font')?.attrs.typeface ?? '')
      .filter(Boolean),
  );
  const slides: DeckSlide[] = [];
  const numbers = new Map<string, number>();
  for (const sldId of slideIds) {
    // r:id, the relationship (plain id is the slide's number).
    const relId = Object.entries(sldId.attrs).find(([k]) => k !== 'id' && local(k) === 'id')?.[1];
    const slidePath = pres.rels.get(relId ?? '');
    if (!slidePath) continue;
    const slide = loadPart({ files, parts }, slidePath);
    if (!slide) continue;
    const layoutPath = relTarget(slide, 'slideLayout');
    const layout = layoutPath ? loadPart({ files, parts }, layoutPath) : undefined;
    const masterPath = layout ? relTarget(layout, 'slideMaster') : undefined;
    const master = masterPath ? loadPart({ files, parts }, masterPath) : undefined;
    const themePath = master ? relTarget(master, 'theme') : undefined;
    if (themePath && !themePath.endsWith('.xml')) continue;

    const masterMap = clrMapOf(path(master?.xml, 'clrMap'));
    const override = path(slide.xml, 'clrMapOvr', 'overrideClrMapping');
    const ctx: Ctx = { files, scale, theme: themeOf(files, themePath), clrMap: override ? clrMapOf(override) : masterMap, parts };
    const inherit: Inherit = { layout, master, defaultTextStyle };

    const showMaster = slide.xml.attrs.showMasterSp !== '0';
    const layoutShowsMaster = layout?.xml.attrs.showMasterSp !== '0';
    const elements: DeckElement[] = [];
    const design = (els: DeckElement[]) => els.map((e) => ({ ...e, template: true }));
    if (showMaster && layoutShowsMaster && master)
      elements.push(
        ...design(
          elementsOf({ ...ctx, clrMap: masterMap }, master, path(master.xml, 'cSld', 'spTree'), { master, defaultTextStyle }, true),
        ),
      );
    if (showMaster && layout)
      elements.push(...design(elementsOf(ctx, layout, path(layout.xml, 'cSld', 'spTree'), { layout, master, defaultTextStyle }, true)));
    const tree = path(slide.xml, 'cSld', 'spTree');
    elements.push(...elementsOf(ctx, slide, tree, inherit, false));

    const background = backgroundOf(ctx, slide) ??
      backgroundOf(ctx, layout) ??
      backgroundOf({ ...ctx, clrMap: masterMap }, master) ?? { kind: 'solid', color: 'rgba(255, 255, 255, 1)' };

    // The words, shape by shape (tables too) from the top down, for search and the stage display.
    const at = (el: XmlElement) => {
      const ph = placeholderOf(el);
      const xfrm =
        child(child(el, 'spPr') ?? child(el, 'grpSpPr'), 'xfrm') ??
        child(el, 'xfrm') ??
        (ph ? (path(findPlaceholder(layout, ph), 'spPr', 'xfrm') ?? path(findPlaceholder(master, ph, true), 'spPr', 'xfrm')) : undefined);
      const off = child(xfrm, 'off');
      return { y: numAttr(off, 'y') ?? 0, x: numAttr(off, 'x') ?? 0 };
    };
    const text = (tree?.children ?? [])
      .filter((el) => ['sp', 'grpSp', 'graphicFrame'].includes(local(el.name)))
      .filter((el) => !['sldNum', 'dt', 'ftr'].includes(placeholderOf(el)?.type ?? ''))
      .map((el) => ({ el, ...at(el) }))
      // Lines a little apart in height count as level, read left to right.
      .sort((a, b) => (Math.abs(a.y - b.y) > 100000 ? a.y - b.y : a.x - b.x))
      .flatMap(({ el }) => descendants(el, 'txBody').filter((body) => !['sldNum', 'dt', 'ftr'].includes(placeholderOf(body)?.type ?? '')))
      .map(plainText)
      .filter(Boolean)
      .join('\n\n');
    const notesPath = relTarget(slide, 'notesSlide');
    const notesPart = notesPath ? loadPart({ files, parts }, notesPath) : undefined;
    const notesBody = notesPart
      ? descendants(path(notesPart.xml, 'cSld', 'spTree'), 'sp').find((sp) => placeholderOf(sp)?.type === 'body')
      : undefined;

    numbers.set(sldId.attrs.id, slides.length + 1);
    slides.push({
      background: background ?? null,
      elements,
      text,
      notes: plainText(child(notesBody, 'txBody')),
      hidden: slide.xml.attrs.show === '0',
    });
  }
  const sections = descendants(path(pres.xml, 'extLst'), 'section').map((sec) => ({
    name: sec.attrs.name ?? '',
    slides: descendants(sec, 'sldId').flatMap((id) => numbers.get(id.attrs.id) ?? []),
  }));
  return { width: DECK_WIDTH, height: Math.round((cy / cx) * DECK_WIDTH), slides, fonts: [...fonts], sections };
}
