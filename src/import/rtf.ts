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
