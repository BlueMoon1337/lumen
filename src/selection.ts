/**
 * Highlighting several items, as in Finder: click one to choose just it, ⌘-click (Ctrl-click) to
 * add or take one out, ⇧-click to choose everything from the last one clicked. Used by the media
 * bin and the library's list of presentations.
 */
import { create } from 'zustand';

export interface Selection {
  ids: string[];
  /** Where a ⇧-click range starts: the item last clicked without ⇧. */
  anchor: string | null;
}

export interface Mods {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** ⌘ (or Ctrl), or ⇧, held: the click changes the highlight rather than choosing one item. */
export const isExtending = (e: Mods) => e.metaKey || e.ctrlKey || e.shiftKey;

/** The highlight after clicking `id`, with `order` the items as shown. */
export function clickSelection(current: Selection, order: string[], id: string, e: Mods): Selection {
  if (e.shiftKey) {
    const from = order.indexOf(current.anchor ?? id);
    const to = order.indexOf(id);
    if (from < 0 || to < 0) return { ids: [id], anchor: id };
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    // ⌘⇧ adds the range to what's highlighted; ⇧ alone replaces it.
    const ids = e.metaKey || e.ctrlKey ? [...new Set([...current.ids, ...range])] : range;
    return { ids, anchor: current.anchor ?? id };
  }
  if (e.metaKey || e.ctrlKey) {
    const ids = current.ids.includes(id) ? current.ids.filter((x) => x !== id) : [...current.ids, id];
    return { ids, anchor: id };
  }
  return { ids: [id], anchor: id };
}

/** The items to act on from one that was right-clicked or dragged: the highlight, if it's in it. */
export function actedOn(selection: Selection, order: string[], id: string): string[] {
  if (!selection.ids.includes(id) || selection.ids.length < 2) return [id];
  return order.filter((x) => selection.ids.includes(x));
}

/** What's highlighted in the media bin. */
export const useMediaSelection = create<Selection>(() => ({ ids: [], anchor: null }));

/** What's highlighted in the library's list of presentations. */
export const useLibrarySelection = create<Selection>(() => ({ ids: [], anchor: null }));
