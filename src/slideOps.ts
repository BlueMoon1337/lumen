/**
 * Edits to a presentation's slides and groups that the right-click menus, the inspector and
 * the keyboard share. Each returns the changed fields, ready for updatePresentation.
 */
import type { ColorLabel, Group, Presentation, Slide, SlideTransition, TextStyle, Theme } from './types';
import { uid } from './util';

/** A slide, a group, or every slide of the presentation. */
export type SlideScope = { slideId: string } | { groupId: string } | 'presentation';

const mapSlides = (p: Presentation, scope: SlideScope, fn: (sl: Slide) => Slide): Group[] =>
  p.groups.map((g) => {
    if (scope === 'presentation' || ('groupId' in scope && scope.groupId === g.id)) return { ...g, slides: g.slides.map(fn) };
    if ('slideId' in scope && g.slides.some((sl) => sl.id === scope.slideId))
      return { ...g, slides: g.slides.map((sl) => (sl.id === scope.slideId ? fn(sl) : sl)) };
    return g;
  });

/**
 * Puts a slide in a group, as ProPresenter does: the slide starts a new group that also takes
 * the slides after it in its old group. A group's first slide just renames and recolors its group.
 */
export function assignGroup(p: Presentation, slideId: string, preset: ColorLabel): Pick<Presentation, 'groups' | 'arrangement'> {
  const gi = p.groups.findIndex((g) => g.slides.some((sl) => sl.id === slideId));
  if (gi < 0) return { groups: p.groups, arrangement: p.arrangement };
  const old = p.groups[gi];
  const at = old.slides.findIndex((sl) => sl.id === slideId);
  if (at === 0) {
    const groups = p.groups.map((g, i) => (i === gi ? { ...g, name: preset.name, color: preset.color } : g));
    return { groups, arrangement: p.arrangement };
  }
  const split: Group = { id: uid(), name: preset.name, color: preset.color, slides: old.slides.slice(at) };
  const groups = [...p.groups.slice(0, gi), { ...old, slides: old.slides.slice(0, at) }, split, ...p.groups.slice(gi + 1)];
  // Wherever the old group plays, the new one now follows it.
  const arrangement = p.arrangement.flatMap((id) => (id === old.id ? [id, split.id] : [id]));
  return { groups, arrangement };
}

/** Removes a group, its slides and its places in the arrangement. */
export function deleteGroup(p: Presentation, groupId: string): Pick<Presentation, 'groups' | 'arrangement'> {
  return { groups: p.groups.filter((g) => g.id !== groupId), arrangement: p.arrangement.filter((id) => id !== groupId) };
}

/** A copy of a group with new ids, placed after it (and after it in the arrangement). */
export function duplicateGroup(p: Presentation, groupId: string): Pick<Presentation, 'groups' | 'arrangement'> {
  const gi = p.groups.findIndex((g) => g.id === groupId);
  if (gi < 0) return { groups: p.groups, arrangement: p.arrangement };
  const g = p.groups[gi];
  const copy: Group = { ...structuredClone(g), id: uid(), slides: g.slides.map((sl) => ({ ...structuredClone(sl), id: uid() })) };
  const groups = [...p.groups.slice(0, gi + 1), copy, ...p.groups.slice(gi + 1)];
  const arrangement = p.arrangement.length ? p.arrangement.flatMap((id) => (id === groupId ? [id, copy.id] : [id])) : [];
  return { groups, arrangement };
}

/** Copies of `slides` (new ids) inserted after `afterSlideId`, or at the end. */
export function insertSlides(p: Presentation, afterSlideId: string | null, slides: Slide[]): Pick<Presentation, 'groups' | 'arrangement'> {
  const copies = slides.map((sl) => ({ ...structuredClone(sl), id: uid() }));
  let gi = p.groups.findIndex((g) => g.slides.some((sl) => sl.id === afterSlideId));
  if (gi < 0) gi = p.groups.length - 1;
  if (gi < 0) {
    const group: Group = { id: uid(), name: 'Verse 1', color: '#3b82f6', slides: copies };
    return { groups: [group], arrangement: [group.id] };
  }
  const groups = p.groups.map((g, i) => {
    if (i !== gi) return g;
    const at = g.slides.findIndex((sl) => sl.id === afterSlideId);
    const next = [...g.slides];
    next.splice(at >= 0 ? at + 1 : next.length, 0, ...copies);
    return { ...g, slides: next };
  });
  return { groups, arrangement: p.arrangement };
}

const TEXT_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'italic', 'uppercase', 'color', 'textAlign', 'verticalAlign'] as const;

/** The text formatting of a slide as it looks (not where its box sits): what Copy Text Style copies. */
export function textStyleOf(theme: Theme): TextStyle {
  return Object.fromEntries(TEXT_KEYS.map((k) => [k, theme[k]])) as TextStyle;
}

const without = (style: TextStyle | undefined, keys: string[]): TextStyle | undefined => {
  if (!style) return undefined;
  const rest = Object.fromEntries(Object.entries(style).filter(([k]) => !keys.includes(k)));
  return Object.keys(rest).length ? rest : undefined;
};

/**
 * Pastes text formatting onto a slide, a group, or the whole presentation. For the whole
 * presentation it becomes the presentation's formatting, and slides stop overriding those settings.
 */
export function pasteTextStyle(p: Presentation, scope: SlideScope, style: TextStyle): Pick<Presentation, 'groups' | 'style'> {
  if (scope === 'presentation') {
    const keys = Object.keys(style);
    return { style: { ...p.style, ...style }, groups: mapSlides(p, scope, (sl) => ({ ...sl, style: without(sl.style, keys) })) };
  }
  return { style: p.style, groups: mapSlides(p, scope, (sl) => ({ ...sl, style: { ...sl.style, ...style } })) };
}

/** Takes the formatting a slide, group or presentation adds to the theme back off. */
export function clearTextStyle(p: Presentation, scope: SlideScope): Pick<Presentation, 'groups' | 'style'> {
  const groups = mapSlides(p, scope, (sl) => ({ ...sl, style: undefined }));
  return { groups, style: scope === 'presentation' ? undefined : p.style };
}

/** Sets (or, with undefined, clears) the transition of a slide, each slide of a group, or the presentation. */
export function setTransition(p: Presentation, scope: SlideScope, t: SlideTransition | undefined): Partial<Presentation> {
  if (scope === 'presentation') return { transition: t };
  return { groups: mapSlides(p, scope, (sl) => ({ ...sl, transition: t })) };
}

/** Sets or clears a slide's label. */
export function setLabel(p: Presentation, slideId: string, label: ColorLabel | undefined): Pick<Presentation, 'groups'> {
  return { groups: mapSlides(p, { slideId }, (sl) => ({ ...sl, label })) };
}

/** The slides of a group, one slide, or every slide once (ignoring repeats in the arrangement). */
export function slidesIn(p: Presentation, scope: SlideScope): Slide[] {
  if (scope === 'presentation') return p.groups.flatMap((g) => g.slides);
  if ('groupId' in scope) return p.groups.find((g) => g.id === scope.groupId)?.slides ?? [];
  return p.groups.flatMap((g) => g.slides.filter((sl) => sl.id === scope.slideId));
}
