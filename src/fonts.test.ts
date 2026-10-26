import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPPERPLATE, cssFamilyFor, faceName, fontLabel, fontValue, readFontInfo, splitFontCollection, styleFromName } from './fonts';
import { useStore } from './store';

// ---- Build minimal OpenType files: a name table and an OS/2 table are all readFontInfo needs.

function nameTable(entries: [number, string][]) {
  const strings = entries.map(([, s]) => {
    const b = new Uint8Array(s.length * 2);
    [...s].forEach((ch, i) => new DataView(b.buffer).setUint16(i * 2, ch.charCodeAt(0)));
    return b;
  });
  const header = 6 + entries.length * 12;
  const out = new Uint8Array(header + strings.reduce((n, s) => n + s.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, entries.length);
  v.setUint16(4, header);
  let offset = 0;
  entries.forEach(([id], i) => {
    const r = 6 + i * 12;
    v.setUint16(r, 3);
    v.setUint16(r + 2, 1);
    v.setUint16(r + 4, 0x409);
    v.setUint16(r + 6, id);
    v.setUint16(r + 8, strings[i].length);
    v.setUint16(r + 10, offset);
    out.set(strings[i], header + offset);
    offset += strings[i].length;
  });
  return out;
}

function os2Table(weight: number, italic = false) {
  const out = new Uint8Array(78);
  const v = new DataView(out.buffer);
  v.setUint16(4, weight);
  v.setUint16(62, italic ? 1 : 0);
  return out;
}

/** An sfnt (or the font part of a collection) whose table offsets start at `base`. */
function sfnt(tables: [string, Uint8Array][], base = 0) {
  const header = 12 + tables.length * 16;
  const out = new Uint8Array(header + tables.reduce((n, [, t]) => n + ((t.length + 3) & ~3), 0));
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, tables.length);
  let pos = header;
  tables.forEach(([tag, data], i) => {
    const r = 12 + i * 16;
    [...tag].forEach((ch, k) => (out[r + k] = ch.charCodeAt(0)));
    v.setUint32(r + 8, base + pos);
    v.setUint32(r + 12, data.length);
    out.set(data, pos);
    pos += (data.length + 3) & ~3;
  });
  return out;
}

describe('font files', () => {
  it('reads family, weight and style from OpenType tables', () => {
    const font = sfnt([
      ['OS/2', os2Table(300)],
      [
        'name',
        nameTable([
          [1, 'Copperplate Light'],
          [2, 'Regular'],
          [16, 'Copperplate'],
          [17, 'Light'],
        ]),
      ],
    ]);
    expect(readFontInfo(font, 'whatever.ttf')).toEqual({ family: 'Copperplate', weight: 300, italic: false });
  });

  it('splits a font collection into standalone fonts', () => {
    const faces = [
      ['Light', 300],
      ['Bold', 700],
    ] as const;
    let offset = 12 + faces.length * 4;
    const parts = faces.map(([sub, weight]) => {
      const part = sfnt(
        [
          ['OS/2', os2Table(weight)],
          [
            'name',
            nameTable([
              [1, 'Copperplate'],
              [2, sub],
            ]),
          ],
        ],
        offset,
      );
      offset += part.length;
      return part;
    });
    const ttc = new Uint8Array(offset);
    const v = new DataView(ttc.buffer);
    [...'ttcf'].forEach((ch, i) => (ttc[i] = ch.charCodeAt(0)));
    v.setUint32(8, faces.length);
    let at = 12 + faces.length * 4;
    parts.forEach((part, i) => {
      v.setUint32(12 + i * 4, at);
      ttc.set(part, at);
      at += part.length;
    });
    const split = splitFontCollection(ttc);
    expect(split.map((f) => readFontInfo(f, 'Copperplate.ttc'))).toEqual([
      { family: 'Copperplate', weight: 300, italic: false },
      { family: 'Copperplate', weight: 700, italic: false },
    ]);
  });

  it('reads real WOFF files', () => {
    const woff = readFileSync('node_modules/@fontsource/cinzel/files/cinzel-latin-700-normal.woff');
    expect(readFontInfo(new Uint8Array(woff), 'cinzel.woff')).toMatchObject({ family: 'Cinzel', weight: 700, italic: false });
  });

  it('falls back to the file name when tables cannot be read', () => {
    expect(readFontInfo(new TextEncoder().encode('wOF2...'), 'OpenSans-BoldItalic.woff2')).toEqual({
      family: 'Open Sans',
      weight: 700,
      italic: true,
    });
  });
});

describe('font names', () => {
  it('maps face names to weights', () => {
    expect(styleFromName('Copperplate-Light')).toEqual({ weight: 300, italic: false });
    expect(styleFromName('Montserrat-ExtraLightItalic')).toEqual({ weight: 200, italic: true });
    expect(styleFromName('Avenir-SemiBold')).toEqual({ weight: 600, italic: false });
    expect(styleFromName('Helvetica')).toEqual({ weight: 400, italic: false });
    expect(faceName({ weight: 300, italic: false })).toBe('Light');
    expect(faceName({ weight: 400, italic: true })).toBe('Italic');
  });

  it('uses the installed Copperplate first, then Copperplate Gothic, then Cinzel', () => {
    expect(cssFamilyFor('Copperplate')).toBe(COPPERPLATE);
    expect(cssFamilyFor('Copperplate Gothic Light')).toBe(COPPERPLATE);
    expect(COPPERPLATE.split(',').map((f) => f.trim().replace(/"/g, ''))).toEqual([
      'Copperplate',
      'Copperplate Gothic Light',
      'Copperplate Gothic',
      'Cinzel',
      'serif',
    ]);
    expect(fontLabel(COPPERPLATE)).toBe('Copperplate');
  });

  it('keeps unknown fonts by name with a fallback', () => {
    expect(cssFamilyFor('Georgia')).toBe('Georgia, "Times New Roman", serif');
    expect(cssFamilyFor('Avenir Next')).toBe(fontValue('Avenir Next'));
    expect(fontLabel(fontValue('Avenir Next'))).toBe('Avenir Next');
  });
});

describe('added fonts', () => {
  it('replaces an earlier file for the same face', () => {
    const s = useStore.getState();
    s.addFonts([{ id: 'a', family: 'Test Sans', weight: 400, italic: false, fileName: 'a.ttf' }]);
    s.addFonts([
      { id: 'b', family: 'Test Sans', weight: 400, italic: false, fileName: 'b.ttf' },
      { id: 'c', family: 'Test Sans', weight: 700, italic: false, fileName: 'c.ttf' },
    ]);
    expect(useStore.getState().fonts.map((f) => f.id)).toEqual(['b', 'c']);
    s.deleteFont('b');
    expect(useStore.getState().fonts.map((f) => f.id)).toEqual(['c']);
  });
});
