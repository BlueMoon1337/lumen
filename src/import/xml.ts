/**
 * A small XML reader for Office files (PowerPoint's parts): elements, attributes and text, with
 * entities decoded. Names keep their prefix ("a:p"); `local` gives the name without it. Enough
 * for well-formed machine-written XML, without a DOM, so it runs in tests too.
 */
import { decodeXml } from './usx';

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** The element's own text (for <a:t> and the like), entities decoded. */
  text: string;
}

export const local = (name: string) => name.slice(name.indexOf(':') + 1);

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decodeXml(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      i = xml.indexOf('-->', lt + 4);
      i = i < 0 ? n : i + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += xml.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const gt = findTagEnd(xml, lt);
    if (xml[lt + 1] === '/') {
      if (stack.length > 1) stack.pop();
      i = gt + 1;
      continue;
    }
    const selfClosing = xml[gt - 1] === '/';
    const body = xml.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    const el: XmlElement = { name, attrs: space < 0 ? {} : parseAttrs(body.slice(space)), children: [], text: '' };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
    i = gt + 1;
  }
  return root.children.find((c) => c.name) ?? root;
}

/** The end of a tag, past any ">" inside quoted attribute values. */
function findTagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from + 1; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return xml.length - 1;
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(s); m; m = re.exec(s)) attrs[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  return attrs;
}

/** The first child with this local name (prefix ignored). */
export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => local(c.name) === name);
}

/** The children with this local name. */
export function children(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => local(c.name) === name) : [];
}

/** Follows a path of child names: path(sp, 'spPr', 'xfrm', 'off'). */
export function path(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let at = el;
  for (const n of names) at = child(at, n);
  return at;
}

/** Every descendant with this local name, in document order. */
export function descendants(el: XmlElement | undefined, name: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  for (const c of el.children) {
    if (local(c.name) === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

/** An attribute by its local name (r:embed and embed alike). */
export function attrOf(el: XmlElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  if (name in el.attrs) return el.attrs[name];
  for (const [k, v] of Object.entries(el.attrs)) if (local(k) === name) return v;
  return undefined;
}

export function numAttr(el: XmlElement | undefined, name: string): number | undefined {
  const v = attrOf(el, name);
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
