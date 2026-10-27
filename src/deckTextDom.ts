/**
 * Text boxes of PowerPoint slides, edited in place: a box's paragraphs and runs as HTML for a
 * contenteditable element, and back again. Formatting the browser applies while editing (bold,
 * italic, a color or font on the selection) comes back as runs with that formatting.
 */
import type { DeckParagraph, DeckRun, DeckText } from './deck';
import { paragraphOf } from './deckEdit';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** CSS for a run, at the box's shrink-to-fit scale. */
function runCss(r: Omit<DeckRun, 'text'>, scale: number): string {
  const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
  return [
    `font-family:${r.font.replace(/"/g, "'")}`,
    `font-size:${(r.size * scale).toFixed(2)}px`,
    `font-weight:${r.bold ? 700 : 400}`,
    `font-style:${r.italic ? 'italic' : 'normal'}`,
    `color:${r.color}`,
    deco && `text-decoration:${deco}`,
    r.caps && 'text-transform:uppercase',
    r.baseline && `vertical-align:${r.baseline > 0 ? 'super' : 'sub'}`,
  ]
    .filter(Boolean)
    .join(';');
}

export function lineHeightCss(p: DeckParagraph, scale: number, reduction = 0): string {
  return 'px' in p.lineSpacing ? `${(p.lineSpacing.px * scale).toFixed(2)}px` : String(1.2 * p.lineSpacing.factor * (1 - reduction));
}

/** A paragraph's own look as CSS: alignment, indents, spacing. */
function paragraphCss(p: DeckParagraph, scale: number, reduction: number, first: boolean): string {
  return [
    `text-align:${p.align}`,
    `padding-left:${p.marginLeft.toFixed(2)}px`,
    `text-indent:${p.indent.toFixed(2)}px`,
    `margin:${first ? 0 : (p.spaceBefore * scale).toFixed(2)}px 0 ${(p.spaceAfter * scale).toFixed(2)}px`,
    `line-height:${lineHeightCss(p, scale, reduction)}`,
    `font-size:${(p.emptySize * scale).toFixed(2)}px`,
  ].join(';');
}

/** The box's text as HTML: a <div> per paragraph, a <span> per run. */
export function textToHtml(t: DeckText): string {
  return t.paragraphs
    .map((p, i) => {
      const runs = p.runs.map((r) => (r.br ? '<br>' : `<span style="${runCss(r, t.fontScale)}">${esc(r.text)}</span>`)).join('');
      // An empty line needs a <br> to have a height (and somewhere for the caret).
      const empty = !p.runs.some((r) => r.text) || p.runs.at(-1)?.br;
      return `<div style="${paragraphCss(p, t.fontScale, t.lineReduction, i === 0)}">${runs}${empty ? '<br>' : ''}</div>`;
    })
    .join('');
}

/** A run's look, from the computed style of the element its text is in. */
function lookOf(el: Element, scale: number): Omit<DeckRun, 'text'> {
  const cs = getComputedStyle(el);
  const deco = cs.textDecorationLine || cs.textDecoration;
  return {
    font: cs.fontFamily,
    size: parseFloat(cs.fontSize) / scale,
    bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold',
    italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
    underline: deco.includes('underline'),
    strike: deco.includes('line-through'),
    color: cs.color,
    caps: cs.textTransform === 'uppercase',
    baseline: cs.verticalAlign === 'super' ? 0.3 : cs.verticalAlign === 'sub' ? -0.25 : 0,
  };
}

const sameLook = (a: DeckRun, b: DeckRun) => {
  const { text: _a, br: _ab, ...la } = a;
  const { text: _b, br: _bb, ...lb } = b;
  return !a.br && !b.br && JSON.stringify(la) === JSON.stringify(lb);
};

const BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

/**
 * The text an edited box now has. Paragraphs keep their own look (alignment, spacing, bullets)
 * by position; new ones take the look of the one before. Sizes are back to PowerPoint's (before
 * its shrink-to-fit scale).
 */
export function htmlToText(root: HTMLElement, before: DeckText): DeckText {
  const scale = before.fontScale || 1;
  const lines: { runs: DeckRun[]; align?: string }[] = [];
  let current: { runs: DeckRun[]; align?: string } | null = null;
  const start = (block?: Element) => {
    current = { runs: [], align: block ? getComputedStyle(block).textAlign : undefined };
    lines.push(current);
    return current;
  };
  const walk = (node: Node, inBlock: boolean) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? '').replace(/​/g, '');
        if (!text) continue;
        const line = current ?? start();
        line.runs.push({ text, ...lookOf(child.parentElement ?? root, scale) });
      } else if (child instanceof HTMLElement) {
        if (child.tagName === 'BR') {
          const line = current ?? start();
          // A <br> that ends a block is only there to give it a height.
          const last = !child.nextSibling && inBlock && child.parentElement && BLOCKS.has(child.parentElement.tagName);
          if (!last) line.runs.push({ text: '', br: true, ...lookOf(child.parentElement ?? root, scale) });
        } else if (BLOCKS.has(child.tagName)) {
          start(child);
          walk(child, true);
          current = null;
        } else walk(child, inBlock);
      }
    }
  };
  walk(root, false);

  const looks = before.paragraphs;
  const paragraphs = lines.map((line, i): DeckParagraph => {
    const like = looks[Math.min(i, looks.length - 1)] ?? paragraphOf('', { ...emptyLook(), size: 40 });
    const runs: DeckRun[] = [];
    for (const r of line.runs) {
      const prev = runs.at(-1);
      if (prev && sameLook(prev, r)) prev.text += r.text;
      else runs.push(r);
    }
    while (runs.at(-1)?.br) runs.pop();
    const align =
      line.align === 'center' || line.align === 'right' || line.align === 'justify' ? line.align : line.align ? 'left' : like.align;
    return { ...like, align: align as DeckParagraph['align'], runs, emptySize: runs[0]?.size ?? like.emptySize };
  });
  return {
    ...before,
    paragraphs: paragraphs.length ? paragraphs : [{ ...(looks[0] ?? paragraphOf('', { ...emptyLook(), size: 40 })), runs: [] }],
  };
}

const emptyLook = (): Omit<DeckRun, 'text'> => ({
  font: 'sans-serif',
  size: 40,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: 'rgba(0, 0, 0, 1)',
  caps: false,
  baseline: 0,
});
