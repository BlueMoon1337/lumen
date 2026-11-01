/** Destinations whose contents are never visible text. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'expandedcolortbl',
  'stylesheet',
  'info',
  'pict',
  'listtable',
  'listoverridetable',
  'generator',
  'filetbl',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'header',
  'footer',
  'fldinst',
  'object',
]);

const SYMBOLS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n',
  tab: ' ',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
};

const cp1252 = new TextDecoder('windows-1252');

/**
 * Extracts the plain text from RTF, as written by macOS and ProPresenter.
 * Returns one line per paragraph with surrounding whitespace trimmed.
 */
export function rtfToText(rtf: string): string {
  let out = '';
  const stack: { skip: boolean; uc: number }[] = [];
  let state = { skip: false, uc: 1 };
  let pendingSkip = 0;
  let i = 0;

  const emit = (s: string) => {
    if (state.skip) return;
    if (pendingSkip > 0) {
      // Characters after \uN are an ASCII fallback for readers without Unicode.
      const take = Math.min(pendingSkip, s.length);
      pendingSkip -= take;
      s = s.slice(take);
    }
    out += s;
  };

  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push(state);
      state = { ...state };
      i++;
    } else if (ch === '}') {
      state = stack.pop() ?? { skip: false, uc: 1 };
      i++;
    } else if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === undefined) break;
      if (/[a-zA-Z]/.test(next)) {
        let j = i + 1;
        while (j < rtf.length && /[a-zA-Z]/.test(rtf[j])) j++;
        const word = rtf.slice(i + 1, j);
        let k = j;
        if (rtf[k] === '-') k++;
        while (k < rtf.length && /\d/.test(rtf[k])) k++;
        const param = k > j ? Number(rtf.slice(j, k)) : null;
        if (rtf[k] === ' ') k++;
        i = k;
        if (SKIP_DESTINATIONS.has(word)) state.skip = true;
        else if (word === 'uc' && param != null) state.uc = param;
        else if (word === 'u' && param != null) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param));
          if (!state.skip) pendingSkip = state.uc;
        } else if (SYMBOLS[word]) emit(SYMBOLS[word]);
      } else if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        emit(cp1252.decode(new Uint8Array([parseInt(hex, 16) || 0x3f])));
        i += 4;
      } else {
        // Control symbols.
        if (next === '\n' || next === '\r') emit('\n');
        else if (next === '\\' || next === '{' || next === '}') emit(next);
        else if (next === '~') emit(' ');
        else if (next === '_') emit('-');
        else if (next === '*') state.skip = true;
        i += 2;
      }
    } else {
      if (ch !== '\n' && ch !== '\r') emit(ch);
      i++;
    }
  }

  return out
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** A stretch of RTF text in one format. Unset values weren't given (the box's own apply). */
export interface RtfRun {
  text: string;
  /** The font's name as the font table gives it (a PostScript name, e.g. "Copperplate-Light"). */
  font?: string;
  /** In points (px on a 1920 × 1080 slide). */
  size?: number;
  /** Hex, e.g. "#ffff54". */
  color?: string;
  bold: boolean;
  italic: boolean;
}

export interface RtfParagraph {
  align: 'left' | 'center' | 'right' | 'justify';
  runs: RtfRun[];
}

/** The text of a group that starts with `{\name`, e.g. the font table. */
function groupText(rtf: string, name: string): string {
  const start = rtf.indexOf(`{\\${name}`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = start; i < rtf.length; i++) {
    if (rtf[i] === '\\') i++;
    else if (rtf[i] === '{') depth++;
    else if (rtf[i] === '}' && --depth === 0) return rtf.slice(start + name.length + 2, i);
  }
  return '';
}

function fontTable(rtf: string): Map<number, string> {
  const fonts = new Map<number, string>();
  for (const entry of groupText(rtf, 'fonttbl').split(';')) {
    const n = entry.match(/\\f(\d+)/);
    const name = entry
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .trim();
    if (n && name) fonts.set(Number(n[1]), name);
  }
  return fonts;
}

function colorTable(rtf: string): string[] {
  const hex = (v: string | undefined) =>
    Number(v ?? 0)
      .toString(16)
      .padStart(2, '0');
  return groupText(rtf, 'colortbl')
    .split(';')
    .slice(0, -1)
    .map((entry) => {
      const r = entry.match(/\\red(\d+)/)?.[1];
      const g = entry.match(/\\green(\d+)/)?.[1];
      const b = entry.match(/\\blue(\d+)/)?.[1];
      return r === undefined && g === undefined && b === undefined ? '' : `#${hex(r)}${hex(g)}${hex(b)}`;
    });
}

/**
 * RTF as paragraphs of formatted runs, as macOS and ProPresenter write it: each run's font,
 * size, color, bold and italic, and each paragraph's alignment. Empty paragraphs are kept.
 */
export function rtfToParagraphs(rtf: string): RtfParagraph[] {
  const fonts = fontTable(rtf);
  const colors = colorTable(rtf);
  type Fmt = { font?: number; size?: number; color?: number; bold: boolean; italic: boolean };
  const paragraphs: RtfParagraph[] = [];
  let align: RtfParagraph['align'] = 'left';
  let runs: RtfRun[] = [];
  const stack: { skip: boolean; uc: number; fmt: Fmt }[] = [];
  let state = { skip: false, uc: 1, fmt: { bold: false, italic: false } as Fmt };
  let pendingSkip = 0;
  let i = 0;

  const emit = (s: string) => {
    if (state.skip || !s) return;
    if (pendingSkip > 0) {
      const take = Math.min(pendingSkip, s.length);
      pendingSkip -= take;
      s = s.slice(take);
      if (!s) return;
    }
    const f = state.fmt;
    const run: RtfRun = {
      text: s.replace(/ /g, ' '),
      font: f.font !== undefined ? fonts.get(f.font) : undefined,
      size: f.size,
      color: f.color !== undefined ? colors[f.color] || undefined : undefined,
      bold: f.bold,
      italic: f.italic,
    };
    const last = runs.at(-1);
    if (
      last &&
      last.font === run.font &&
      last.size === run.size &&
      last.color === run.color &&
      last.bold === run.bold &&
      last.italic === run.italic
    )
      last.text += run.text;
    else runs.push(run);
  };
  const breakParagraph = () => {
    if (state.skip) return;
    paragraphs.push({ align, runs });
    runs = [];
  };

  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push(state);
      state = { ...state, fmt: { ...state.fmt } };
      i++;
    } else if (ch === '}') {
      state = stack.pop() ?? { skip: false, uc: 1, fmt: { bold: false, italic: false } };
      i++;
    } else if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === undefined) break;
      if (/[a-zA-Z]/.test(next)) {
        let j = i + 1;
        while (j < rtf.length && /[a-zA-Z]/.test(rtf[j])) j++;
        const word = rtf.slice(i + 1, j);
        let k = j;
        if (rtf[k] === '-') k++;
        while (k < rtf.length && /\d/.test(rtf[k])) k++;
        const param = k > j ? Number(rtf.slice(j, k)) : null;
        if (rtf[k] === ' ') k++;
        i = k;
        if (SKIP_DESTINATIONS.has(word)) state.skip = true;
        else if (word === 'uc' && param != null) state.uc = param;
        else if (word === 'u' && param != null) {
          emit(String.fromCharCode(param < 0 ? param + 65536 : param));
          if (!state.skip) pendingSkip = state.uc;
        } else if (word === 'par' || word === 'line' || word === 'sect') breakParagraph();
        else if (word === 'f' && param != null) state.fmt.font = param;
        else if (word === 'fs' && param != null) state.fmt.size = param / 2;
        else if (word === 'cf' && param != null) state.fmt.color = param;
        else if (word === 'b') state.fmt.bold = param !== 0;
        else if (word === 'i') state.fmt.italic = param !== 0;
        else if (word === 'plain') state.fmt = { bold: false, italic: false };
        else if (word === 'pard') align = 'left';
        else if (word === 'ql') align = 'left';
        else if (word === 'qc') align = 'center';
        else if (word === 'qr') align = 'right';
        else if (word === 'qj') align = 'justify';
        else if (SYMBOLS[word]) emit(SYMBOLS[word]);
      } else if (next === "'") {
        emit(cp1252.decode(new Uint8Array([parseInt(rtf.slice(i + 2, i + 4), 16) || 0x3f])));
        i += 4;
      } else {
        if (next === '\n' || next === '\r') breakParagraph();
        else if (next === '\\' || next === '{' || next === '}') emit(next);
        else if (next === '~') emit(' ');
        else if (next === '_') emit('-');
        else if (next === '*') state.skip = true;
        i += 2;
      }
    } else {
      if (ch !== '\n' && ch !== '\r') emit(ch);
      i++;
    }
  }
  if (runs.length) paragraphs.push({ align, runs });
  // Trailing spaces, and empty paragraphs at the end, aren't shown.
  for (const p of paragraphs) {
    const last = p.runs.at(-1);
    if (last) last.text = last.text.replace(/\s+$/, '');
    p.runs = p.runs.filter((r) => r.text);
  }
  while (paragraphs.length && !paragraphs.at(-1)!.runs.length) paragraphs.pop();
  return paragraphs;
}
