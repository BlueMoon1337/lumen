import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { findBook, formatRange, parseReference, type BibleBookMeta } from '../bible';
import { importPlaylistFile } from '../commands';
import { useStore } from '../store';
import { parseProPlaylist } from './proplaylist';
import { parseProPresenter7 } from './propresenter';
import { rtfToText } from './rtf';
import { parseRvBible } from './rvbible';
import { parseUsx } from './usx';
import { readZip } from './zip';

// ---- A tiny protobuf writer for building test .pro files ----

const enc = new TextEncoder();
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const varint = (n: number) => {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return new Uint8Array(out);
};
const bytesField = (field: number, data: Uint8Array) => concat([varint(field * 8 + 2), varint(data.length), data]);
const str = (field: number, s: string) => bytesField(field, enc.encode(s));
const msg = (field: number, ...parts: Uint8Array[]) => bytesField(field, concat(parts));
const num = (field: number, n: number) => concat([varint(field * 8), varint(n)]);
const float = (field: number, n: number) => {
  const b = new Uint8Array(5);
  b[0] = field * 8 + 5;
  new DataView(b.buffer).setFloat32(1, n, true);
  return b;
};
const double = (field: number, n: number) => {
  const b = new Uint8Array(9);
  b[0] = field * 8 + 1;
  new DataView(b.buffer).setFloat64(1, n, true);
  return b;
};
const uuid = (field: number, id: string) => msg(field, str(1, id));

const rtf = (text: string) =>
  `{\\rtf1\\ansi\\ansicpg1252\\cocoartf2706{\\fonttbl\\f0\\fnil Helvetica;}{\\colortbl;\\red255\\green255\\blue255;}\\pard\\qc\\f0\\fs190 \\cf2 ${text}}`;

/** A cue whose slide has one text element per entry in `texts`. */
const cue = (id: string, texts: string[], notes?: string) =>
  msg(
    13,
    uuid(1, id),
    msg(
      10,
      uuid(1, `${id}-action`),
      num(9, 11),
      msg(
        23,
        msg(
          2,
          msg(1, ...texts.map((t) => msg(1, msg(1, str(2, 'Text'), msg(13, str(5, rtf(t))))))),
          ...(notes ? [msg(2, str(1, rtf(notes)))] : []),
        ),
      ),
    ),
  );

const group = (id: string, name: string, rgb: [number, number, number], cueIds: string[]) =>
  msg(
    12,
    msg(1, uuid(1, id), str(2, name), msg(3, float(1, rgb[0]), float(2, rgb[1]), float(3, rgb[2]), float(4, 1))),
    ...cueIds.map((c) => uuid(2, c)),
  );

describe('ProPresenter 7 import', () => {
  const file = concat([
    uuid(2, 'P'),
    str(3, 'Cancion de Prueba'),
    uuid(10, 'A2'),
    msg(11, uuid(1, 'A1'), str(2, 'Default'), uuid(3, 'G1')),
    msg(11, uuid(1, 'A2'), str(2, 'Sunday'), uuid(3, 'G1'), uuid(3, 'G2'), uuid(3, 'G1')),
    group('G1', 'Verse 1', [0, 0, 1], ['C1', 'C2']),
    group('G2', 'Chorus', [1, 0, 0], ['C3']),
    group('G3', 'Chorus', [0, 1, 0], ['C4']),
    cue('C1', ["Primera l\\'ednea\\\nsegunda"], 'Entra la banda'),
    cue('C2', ['Line one', 'Line two in a second box']),
    cue('C3', ['Coro \\u233 ?final']),
    cue('C4', ['Otro coro']),
    msg(14, str(1, 'Autor'), str(4, 'Editorial'), num(5, 2019), num(6, 1234567), num(7, 1)),
    msg(18, double(1, 0.5)),
  ]);
  const p = parseProPresenter7(file);

  it('reads the title, groups, colors and slide text', () => {
    expect(p.title).toBe('Cancion de Prueba');
    expect(p.groups.map((g) => [g.name, g.color])).toEqual([
      ['Verse 1', '#0000ff'],
      ['Chorus', '#ff0000'],
      ['Chorus 2', '#00ff00'],
    ]);
    expect(p.groups[0].slides[0]).toEqual({ text: 'Primera línea\nsegunda', notes: 'Entra la banda' });
    expect(p.groups[0].slides[1].text).toBe('Line one\nLine two in a second box');
    expect(p.groups[1].slides[0].text).toBe('Coro éfinal');
  });

  it('uses the selected arrangement', () => {
    expect(p.arrangement).toEqual([0, 1, 0]);
  });

  it('reads CCLI details and the transition', () => {
    expect(p).toMatchObject({
      author: 'Autor',
      publisher: 'Editorial',
      year: '2019',
      ccli: '1234567',
      showCopyright: true,
      transitionMs: 500,
    });
  });

  it('rejects other files with a clear message', () => {
    expect(() => parseProPresenter7(enc.encode('<?xml version="1.0"?><RVPresentationDocument/>'))).toThrow(/ProPresenter 6/);
    expect(() => parseProPresenter7(enc.encode('hello world'))).toThrow(/Not a ProPresenter 7/);
  });
});

describe('RTF', () => {
  it('keeps text and line breaks, drops tables and formatting', () => {
    const text = rtfToText(
      "{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0 Arial;}{\\colortbl;\\red0;}{\\*\\expandedcolortbl;;}\\f0\\fs48 \\cf1 Hola\\par mam\\'e1 \\{ok\\} \\u8217?s\\line  fin \\\\ }",
    );
    expect(text).toBe('Hola\nmamá {ok} ’s\nfin \\');
  });
});

describe('USX', () => {
  it('reads verses, skips headings and notes, handles USX 3 milestones', () => {
    const book = parseUsx(
      `<usx version="3.0"><book code="PSA" style="id">Salmos</book>
       <chapter number="1" style="c" sid="PSA 1"/>
       <para style="s1">Heading</para>
       <para style="q1"><verse number="1" style="v" sid="PSA 1:1"/>Line one<note caller="+" style="f"><char style="ft">footnote</char></note>
       </para><para style="q2">line two<verse eid="PSA 1:1"/></para>
       <para style="p"><verse number="2" style="v" sid="PSA 1:2"/>Two &amp; <char style="wj">three</char><verse eid="PSA 1:2"/> <verse number="3" style="v"/>Three</para>
       <chapter eid="PSA 1"/><chapter number="2" style="c"/><para style="p"><verse number="1" style="v"/>Next chapter</para></usx>`,
    );
    expect(book.code).toBe('PSA');
    expect(book.chapters).toEqual([['Line one line two', 'Two & three', 'Three'], ['Next chapter']]);
  });
});

describe('rvbible', () => {
  const zip = zipSync({
    'rvmetadata.xml': strToU8('<RVBibleMetdata><name>Biblia de Prueba</name><abbreviation>BDP</abbreviation></RVBibleMetdata>'),
    'metadata.xml': strToU8(
      '<DBLMetadata><language><iso>spa</iso></language><bookNames><book code="JHN"><long>EL EVANGELIO SEGÚN SAN JUAN</long><short>SAN JUAN</short><abbr>Jn.</abbr></book><book code="1JN"><long>1 JUAN</long><short>1 JUAN</short><abbr>1 Jn.</abbr></book></bookNames></DBLMetadata>',
    ),
    'USX_1/1JN.usx': strToU8(
      '<usx><book code="1JN"/><chapter number="1"/><para style="p"><verse number="1"/>Lo que era desde el principio</para></usx>',
    ),
    'USX_1/JHN.usx': strToU8(
      '<usx><book code="JHN"/><chapter number="1"/><para style="p"><verse number="1"/>En el principio</para><para style="p"><verse number="2"/>Este era</para></usx>',
    ),
  });
  const bible = parseRvBible(zip);

  it('reads metadata, book names and verses in canonical order', () => {
    expect(bible).toMatchObject({ name: 'Biblia de Prueba', abbreviation: 'BDP', language: 'spa' });
    expect(bible.books.map((b) => [b.code, b.short, b.abbr])).toEqual([
      ['JHN', 'SAN JUAN', 'Jn.'],
      ['1JN', '1 JUAN', '1 Jn.'],
    ]);
    expect(bible.books[0].chapters).toEqual([['En el principio', 'Este era']]);
  });

  it('rejects files that are not Bibles', () => {
    expect(() => parseRvBible(enc.encode('not a zip'))).toThrow(/Not a Bible/);
  });
});

describe('Bible references', () => {
  const books: BibleBookMeta[] = [
    { code: 'PSA', name: 'SALMOS', short: 'SALMOS', abbr: 'Sal.', verses: [6, 12, 8, ...Array(19).fill(10), 6] },
    { code: 'JHN', name: 'EL SANTO EVANGELIO SEGÚN SAN JUAN', short: 'SAN JUAN', abbr: 'Jn.', verses: [51, 25, 36, 54] },
    { code: '1CO', name: '1 CORINTIOS', short: '1 CORINTIOS', abbr: '1 Co.', verses: Array(16).fill(20) },
    { code: '1JN', name: '1 JUAN', short: '1 JUAN', abbr: '1 Jn.', verses: [10, 29, 24, 21, 21] },
  ];
  const ref = (s: string) => {
    const r = parseReference(s, books);
    return 'error' in r ? r.error : formatRange(r);
  };

  it('finds books by local, abbreviated and English names', () => {
    for (const [query, code] of [
      ['Juan', 'JHN'],
      ['San Juan', 'JHN'],
      ['jn', 'JHN'],
      ['John', 'JHN'],
      ['1 Juan', '1JN'],
      ['I Juan', '1JN'],
      ['1jn', '1JN'],
      ['Salmo', 'PSA'],
      ['psalms', 'PSA'],
      ['1 Co', '1CO'],
    ])
      expect(findBook(query, books)?.code, query).toBe(code);
  });

  it('parses verses, ranges and whole chapters', () => {
    expect(ref('Juan 3:16')).toBe('San Juan 3:16');
    expect(ref('Juan 3:16-18')).toBe('San Juan 3:16-18');
    expect(ref('Jn 3:35-4:2')).toBe('San Juan 3:35-4:2');
    expect(ref('Salmos 23')).toBe('Salmos 23');
    expect(ref('juan 2-3')).toBe('San Juan 2-3');
    expect(ref('Jn. 3.16')).toBe('San Juan 3:16');
  });

  it('explains bad references', () => {
    expect(ref('Juan 9:1')).toMatch(/4 chapters/);
    expect(ref('Juan 3:99')).toMatch(/36 verses/);
    expect(ref('Hechos 2:1')).toMatch(/No book/);
    expect(ref('hola')).toMatch(/reference like/);
  });
});

/** Stored entries with Zip64 sizes in the extra field and a plain end record, as ProPresenter writes them. */
function proPresenterZip(entries: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name);
    const extra = new Uint8Array(28);
    const x = new DataView(extra.buffer);
    x.setUint16(0, 1, true);
    x.setUint16(2, 24, true);
    x.setBigUint64(4, BigInt(data.length), true);
    x.setBigUint64(12, BigInt(data.length), true);
    x.setBigUint64(20, BigInt(offset), true);
    const local = new Uint8Array(30);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 45, true);
    l.setUint32(18, 0xffffffff, true);
    l.setUint32(22, 0xffffffff, true);
    l.setUint16(26, nameBytes.length, true);
    l.setUint16(28, extra.length, true);
    parts.push(local, nameBytes, extra, data);
    const header = new Uint8Array(46);
    const c = new DataView(header.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(6, 45, true);
    c.setUint32(20, 0xffffffff, true);
    c.setUint32(24, 0xffffffff, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint16(30, extra.length, true);
    c.setUint32(42, offset, true);
    central.push(header, nameBytes, extra);
    offset += 30 + nameBytes.length + extra.length + data.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, cd.length, true);
  e.setUint32(16, offset, true);
  return concat([...parts, cd, end]);
}

describe('ProPresenter playlists', () => {
  const song = concat([
    str(3, 'Alabanza Uno'),
    msg(11, uuid(1, 'ARR-SHORT'), uuid(3, 'G2')),
    group('G1', 'Verse 1', [0, 0, 1], ['C1']),
    group('G2', 'Chorus', [1, 0, 0], ['C2']),
    cue('C1', ['Verso']),
    cue('C2', ['Coro']),
  ]);
  const item = (...parts: Uint8Array[]) => msg(1, ...parts);
  const presentationItem = (name: string, path: string, arrangement?: string) =>
    item(
      str(2, name),
      msg(
        4,
        msg(1, str(1, `file:///Users/x/${encodeURI(path)}`), msg(4, num(1, 10), str(2, path))),
        ...(arrangement ? [uuid(2, arrangement)] : []),
      ),
    );
  const data = msg(
    3,
    str(2, 'PLAYLIST'),
    msg(
      12,
      msg(
        1,
        str(2, 'Domingo'),
        msg(
          13,
          item(str(2, 'Alabanza'), msg(3)),
          presentationItem('Alabanza Uno', 'Libraries/Songs/Alabanza Uno.pro'),
          presentationItem('Alabanza Uno', 'Libraries/Songs/Alabanza Uno.pro', 'ARR-SHORT'),
          presentationItem('Perdida', 'Libraries/Songs/Perdida.pro'),
          item(str(2, 'Video de bienvenida'), msg(5)),
        ),
      ),
      msg(
        1,
        str(2, 'Carpeta'),
        msg(12, msg(1, str(2, 'Miércoles'), msg(13, presentationItem('Alabanza Uno', 'Libraries/Songs/Alabanza Uno.pro')))),
      ),
    ),
  );
  const zip = proPresenterZip([
    ['Alabanza Uno.pro', song],
    ['data', data],
  ]);

  it('reads zips with ProPresenter’s Zip64 layout', () => {
    expect([...readZip(zip).keys()]).toEqual(['Alabanza Uno.pro', 'data']);
  });

  it('reads playlists, folders, headers and arrangement choices', () => {
    const bundle = parseProPlaylist(zip);
    expect(bundle.playlists.map((p) => p.name)).toEqual(['Domingo', 'Miércoles']);
    expect(bundle.playlists[0].items).toEqual([
      { type: 'header', label: 'Alabanza' },
      { type: 'presentation', name: 'Alabanza Uno', file: 'Alabanza Uno.pro', arrangementId: undefined },
      { type: 'presentation', name: 'Alabanza Uno', file: 'Alabanza Uno.pro', arrangementId: 'ARR-SHORT' },
      { type: 'presentation', name: 'Perdida', file: undefined, arrangementId: undefined },
    ]);
  });

  it('imports each song once, builds the playlists, and reuses songs on re-import', async () => {
    const file = new File([zip.slice()], 'Domingo.proplaylist');
    const before = Object.keys(useStore.getState().presentations).length;
    const first = await importPlaylistFile(file);
    const s = useStore.getState();
    // The full arrangement and the chorus-only arrangement are different presentations.
    expect(first).toMatchObject({ names: ['Domingo', 'Miércoles'], added: 2, reused: 0, missing: ['Perdida'] });
    expect(Object.keys(s.presentations).length).toBe(before + 2);
    const domingo = s.playlists.find((p) => p.id === first.playlistIds[0])!;
    expect(domingo.items.map((i) => (i.type === 'header' ? `# ${i.label}` : s.presentations[i.presentationId].arrangement.length))).toEqual(
      ['# Alabanza', 2, 1],
    );

    const again = await importPlaylistFile(file);
    expect(again).toMatchObject({ added: 0, reused: 2 });
    expect(useStore.getState().playlists.find((p) => p.id === again.playlistIds[0])!.name).toBe('Domingo 2');
  });

  it('rejects other files', () => {
    expect(() => parseProPlaylist(enc.encode('nope'))).toThrow(/Not a ProPresenter playlist/);
  });
});
