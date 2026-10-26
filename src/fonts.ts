import { unzlibSync } from 'fflate';
import { useSyncExternalStore } from 'react';
import { getMediaBlob } from './media';
import type { FontMeta } from './types';

export interface FontChoice {
  label: string;
  /** CSS font-family value stored in themes and styles. */
  value: string;
}

/**
 * Copperplate is a commercial font, so Lumen can't ship it. macOS includes
 * it, Windows with Office has Copperplate Gothic, and Cinzel (free, bundled)
 * stands in elsewhere: like Copperplate it sets lowercase as small capitals.
 */
export const COPPERPLATE = 'Copperplate, "Copperplate Gothic Light", "Copperplate Gothic", Cinzel, serif';

export const SYSTEM_FONTS: FontChoice[] = [
  { label: 'Helvetica / Arial', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'System UI', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Copperplate', value: COPPERPLATE },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
];

/** Open-licensed fonts bundled with Lumen (see main.tsx), available on every computer. */
export const BUNDLED_FONTS: FontChoice[] = [{ label: 'Cinzel', value: 'Cinzel, serif' }];

/** CSS value for a font that is installed or added by name. */
export const fontValue = (family: string) => `"${family.replace(/"/g, '')}", "Helvetica Neue", Arial, sans-serif`;

export function fontLabel(value: string, choices: FontChoice[] = [...SYSTEM_FONTS, ...BUNDLED_FONTS]): string {
  return choices.find((c) => c.value === value)?.label ?? value.split(',')[0].replace(/"/g, '').trim();
}

/** The CSS value Lumen uses for a font named in another program (e.g. ProPresenter). */
export function cssFamilyFor(family: string): string {
  const name = family.trim();
  if (/^copperplate/i.test(name)) return COPPERPLATE;
  const known = [...SYSTEM_FONTS, ...BUNDLED_FONTS].find(
    (c) =>
      c.label.toLowerCase() === name.toLowerCase() || c.value.toLowerCase().split(',')[0].replace(/"/g, '').trim() === name.toLowerCase(),
  );
  return known?.value ?? fontValue(name);
}

const WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*light|demi\s*light|light/i, 300],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
  [/medium/i, 500],
];

/** Weight and style from a face name such as "Copperplate-Light" or "OpenSans-BoldItalic". */
export function styleFromName(name: string): { weight: number; italic: boolean } {
  const face = name.includes('-') ? name.slice(name.lastIndexOf('-') + 1) : name;
  return { weight: WEIGHTS.find(([re]) => re.test(face))?.[1] ?? 400, italic: /italic|oblique/i.test(face) };
}

// ---- Reading font files -----------------------------------------------------

export interface FontFileInfo {
  family: string;
  weight: number;
  italic: boolean;
}

type Tables = Map<string, Uint8Array>;

function sfntTables(bytes: Uint8Array, offset = 0): Tables {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables: Tables = new Map();
  const count = v.getUint16(offset + 4);
  for (let i = 0; i < count; i++) {
    const rec = offset + 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4));
    const start = v.getUint32(rec + 8);
    tables.set(tag, bytes.subarray(start, start + v.getUint32(rec + 12)));
  }
  return tables;
}

function woffTables(bytes: Uint8Array): Tables {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables: Tables = new Map();
  const count = v.getUint16(12);
  for (let i = 0; i < count; i++) {
    const rec = 44 + i * 20;
    const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4));
    if (tag !== 'name' && tag !== 'OS/2') continue;
    const start = v.getUint32(rec + 4);
    const compressed = v.getUint32(rec + 8);
    const original = v.getUint32(rec + 12);
    const data = bytes.subarray(start, start + compressed);
    tables.set(tag, compressed < original ? unzlibSync(data) : data);
  }
  return tables;
}

const utf16be = new TextDecoder('utf-16be');
const latin1 = new TextDecoder('latin1');

function readName(name: Uint8Array, ids: number[]): string | undefined {
  const v = new DataView(name.buffer, name.byteOffset, name.byteLength);
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  const found: { id: number; score: number; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = v.getUint16(r);
    const encoding = v.getUint16(r + 2);
    const language = v.getUint16(r + 4);
    const id = v.getUint16(r + 6);
    if (!ids.includes(id)) continue;
    const raw = name.subarray(strings + v.getUint16(r + 10), strings + v.getUint16(r + 10) + v.getUint16(r + 8));
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode && !(platform === 1 && encoding === 0)) continue;
    const score = (platform === 3 ? 2 : platform === 0 ? 1 : 0) + (language === 0x409 || (platform === 1 && language === 0) ? 4 : 0);
    found.push({ id, score, text: (unicode ? utf16be : latin1).decode(raw).trim() });
  }
  for (const id of ids) {
    const best = found.filter((f) => f.id === id && f.text).sort((a, b) => b.score - a.score)[0];
    if (best) return best.text;
  }
  return undefined;
}

function infoFromTables(tables: Tables): Partial<FontFileInfo> {
  const out: Partial<FontFileInfo> = {};
  const name = tables.get('name');
  if (name && name.length > 6) {
    // Typographic family (16) groups weights under one name; legacy family (1) otherwise.
    out.family = readName(name, [16, 1]);
    const sub = readName(name, [17, 2]);
    if (sub) Object.assign(out, styleFromName(sub));
  }
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 64) {
    const v = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    const weight = v.getUint16(4);
    if (weight >= 1 && weight <= 1000) out.weight = Math.round(weight / 100) * 100 || 100;
    const selection = v.getUint16(62);
    out.italic = !!(selection & 1) || !!(selection & 0x200) || !!out.italic;
  }
  return out;
}

/** Family from a file name like "OpenSans-Bold.ttf" → "Open Sans". */
function familyFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').split(/[-_]/)[0];
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Custom Font';
}

/** Splits a font collection (.ttc) into standalone fonts; other files pass through. */
export function splitFontCollection(bytes: Uint8Array): Uint8Array[] {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'ttcf') return [bytes];
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const faces: Uint8Array[] = [];
  for (let f = 0; f < v.getUint32(8); f++) {
    const offset = v.getUint32(12 + f * 4);
    const count = v.getUint16(offset + 4);
    const records = Array.from({ length: count }, (_, i) => {
      const rec = offset + 12 + i * 16;
      return { rec, start: v.getUint32(rec + 8), length: v.getUint32(rec + 12) };
    });
    const header = 12 + count * 16;
    const out = new Uint8Array(header + records.reduce((n, r) => n + ((r.length + 3) & ~3), 0));
    const o = new DataView(out.buffer);
    out.set(bytes.subarray(offset, offset + 12), 0);
    let pos = header;
    records.forEach((r, i) => {
      out.set(bytes.subarray(r.rec, r.rec + 8), 12 + i * 16);
      o.setUint32(12 + i * 16 + 8, pos);
      o.setUint32(12 + i * 16 + 12, r.length);
      out.set(bytes.subarray(r.start, r.start + r.length), pos);
      pos += (r.length + 3) & ~3;
    });
    faces.push(out);
  }
  return faces;
}

/** Reads family, weight and style from a TrueType/OpenType/WOFF font, falling back to the file name. */
export function readFontInfo(bytes: Uint8Array, fileName: string): FontFileInfo {
  let info: Partial<FontFileInfo> = {};
  try {
    const sig = String.fromCharCode(...bytes.subarray(0, 4));
    if (sig === 'wOFF') info = infoFromTables(woffTables(bytes));
    else if (sig === '\0\x01\0\0' || sig === 'OTTO' || sig === 'true') info = infoFromTables(sfntTables(bytes));
    // WOFF2 needs Brotli to read its tables; the file name is used instead.
  } catch {
    info = {};
  }
  const fromName = styleFromName(fileName.replace(/\.[^.]+$/, ''));
  return {
    family: info.family || familyFromFileName(fileName),
    weight: info.weight ?? fromName.weight,
    italic: info.italic ?? fromName.italic,
  };
}

// ---- Using added fonts --------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
if (typeof document !== 'undefined' && document.fonts) document.fonts.addEventListener('loadingdone', bump);

/** Changes whenever a font finishes loading, so text measured with a fallback font can be measured again. */
export function useFontsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}

const registered = new Map<string, FontFace>();
let queue: Promise<void> = Promise.resolve();

/** Makes added fonts available in this window; safe to call repeatedly with the full list. */
export function registerFonts(fonts: FontMeta[]): Promise<void> {
  queue = queue.then(async () => {
    let changed = false;
    for (const meta of fonts) {
      if (registered.has(meta.id)) continue;
      try {
        const blob = await getMediaBlob(meta.id);
        if (!blob) continue;
        const face = new FontFace(meta.family, await blob.arrayBuffer(), {
          weight: String(meta.weight),
          style: meta.italic ? 'italic' : 'normal',
        });
        await face.load();
        document.fonts.add(face);
        registered.set(meta.id, face);
        changed = true;
      } catch {
        // Unreadable font file; it simply won't be available.
      }
    }
    for (const [id, face] of registered) {
      if (fonts.some((f) => f.id === id)) continue;
      document.fonts.delete(face);
      registered.delete(id);
      changed = true;
    }
    if (changed) bump();
  });
  return queue;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

export const faceName = (f: { weight: number; italic: boolean }) =>
  `${WEIGHT_NAMES[f.weight] ?? f.weight}${f.italic ? ' Italic' : ''}`.replace('Regular Italic', 'Italic');

export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,.ttc';

/** Whether a font is installed, by comparing its text width with generic fallbacks. */
export function isFontInstalled(family: string): boolean {
  if (typeof document === 'undefined') return false;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const sample = 'mmmmmmmmmmlliWWQQ@#&0123456789';
  return ['monospace', 'serif', 'sans-serif'].some((generic) => {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `72px "${family}", ${generic}`;
    return ctx.measureText(sample).width !== base;
  });
}
