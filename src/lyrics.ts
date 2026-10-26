import type { Group, Presentation, SequenceEntry, Slide } from './types';
import { uid } from './util';

const GROUP_COLORS: [RegExp, string][] = [
  [/^pre[- ]?chorus/i, '#d4a72c'],
  [/^chorus|^refrain/i, '#d9485f'],
  [/^verse/i, '#3b82f6'],
  [/^bridge/i, '#9b5de5'],
  [/^tag|^vamp/i, '#14b8a6'],
  [/^intro|^outro|^ending|^interlude|^instrumental/i, '#6b7280'],
];

export function colorForGroup(name: string): string {
  for (const [re, color] of GROUP_COLORS) if (re.test(name.trim())) return color;
  return '#64748b';
}

const HEADER = /^\[(.+)\]\s*$/;

/**
 * Parses editor text into groups and an arrangement.
 *
 *   [Verse 1]          starts a group
 *   (blank line)       starts a new slide
 *   ~ John 3:16        caption shown under the slide text
 *   > Slow down here   note shown on the stage display only
 *
 * A header that repeats an earlier group name with no lines of its own
 * repeats that group in the arrangement.
 */
export function parseLyrics(text: string): { groups: Group[]; arrangement: string[] } {
  const groups: Group[] = [];
  const arrangement: string[] = [];
  const byName = new Map<string, Group>();

  let current: { name: string; slides: Slide[] } | null = null;
  let slide: Slide | null = null;

  const closeSlide = () => {
    if (current && slide && (slide.text || slide.caption || slide.notes)) current.slides.push(slide);
    slide = null;
  };
  const closeGroup = () => {
    closeSlide();
    if (!current) return;
    const key = current.name.toLowerCase();
    const existing = byName.get(key);
    if (existing && current.slides.length === 0) {
      arrangement.push(existing.id);
    } else if (current.slides.length > 0) {
      let name = current.name;
      if (existing) {
        let n = 2;
        while (byName.has(`${current.name} ${n}`.toLowerCase())) n++;
        name = `${current.name} ${n}`;
      }
      const group: Group = { id: uid(), name, color: colorForGroup(name), slides: current.slides };
      groups.push(group);
      byName.set(name.toLowerCase(), group);
      arrangement.push(group.id);
    }
    current = null;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const header = line.trim().match(HEADER);
    if (header) {
      closeGroup();
      current = { name: header[1].trim(), slides: [] };
      continue;
    }
    if (!line.trim()) {
      closeSlide();
      continue;
    }
    if (!current) current = { name: groups.length || arrangement.length ? 'Slide' : 'Verse 1', slides: [] };
    if (!slide) slide = { id: uid(), text: '' };
    const trimmed = line.trim();
    if (trimmed.startsWith('~')) {
      slide.caption = trimmed.slice(1).trim();
    } else if (trimmed.startsWith('>')) {
      const note = trimmed.slice(1).trim();
      slide.notes = slide.notes ? `${slide.notes}\n${note}` : note;
    } else {
      slide.text = slide.text ? `${slide.text}\n${trimmed}` : trimmed;
    }
  }
  closeGroup();
  return { groups, arrangement };
}

/**
 * Text with a new slide every `n` lines, for text with no blank lines between its slides
 * (lyrics copied from a web page, say). Blank lines and [Group] headers still start one.
 */
export function slidesEvery(text: string, n: number): string {
  const out: string[] = [];
  let lines = 0;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || HEADER.test(line)) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      if (line) out.push(line);
      lines = 0;
      continue;
    }
    if (lines === n) {
      out.push('');
      lines = 0;
    }
    out.push(line);
    lines++;
  }
  return out.join('\n');
}

/** A title for text: its first line that isn't a [Group] header, without closing punctuation. */
export function titleFromText(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !HEADER.test(l));
  return (line ?? '')
    .replace(/[.,;:!?]+$/, '')
    .slice(0, 60)
    .trim();
}

/** Inverse of parseLyrics, used to load a presentation into the text editor. */
export function presentationToText(p: Presentation): string {
  const seen = new Set<string>();
  const order = p.arrangement.length ? p.arrangement : p.groups.map((g) => g.id);
  const blocks: string[] = [];
  const emit = (group: Group) => {
    const header = `[${group.name}]`;
    if (seen.has(group.id)) {
      blocks.push(header);
      return;
    }
    seen.add(group.id);
    const slides = group.slides.map((s) => {
      const lines = s.text ? s.text.split('\n') : [];
      if (s.caption) lines.push(`~ ${s.caption}`);
      if (s.notes) lines.push(...s.notes.split('\n').map((n) => `> ${n}`));
      return lines.join('\n');
    });
    blocks.push([header, slides.join('\n\n')].join('\n'));
  };
  for (const id of order) {
    const group = p.groups.find((g) => g.id === id);
    if (group) emit(group);
  }
  // Groups left out of the arrangement still round-trip.
  for (const group of p.groups) if (!seen.has(group.id)) emit(group);
  return blocks.join('\n\n');
}

export function getSequence(p: Presentation): SequenceEntry[] {
  const order = p.arrangement.length ? p.arrangement : p.groups.map((g) => g.id);
  const out: SequenceEntry[] = [];
  for (const id of order) {
    const group = p.groups.find((g) => g.id === id);
    if (!group) continue;
    group.slides.forEach((slide, indexInGroup) => out.push({ group, slide, indexInGroup }));
  }
  return out;
}
