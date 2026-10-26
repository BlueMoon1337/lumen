import { create } from 'zustand';
import { useStore } from '../store';

export type PopoverName = 'search' | 'text' | 'theme';

/** The toolbar panel that's open, so Edit ▸ Search (⌘F) can open Search. */
export const useToolbarPop = create<{ pop: PopoverName | null }>(() => ({ pop: null }));

/** Edit ▸ Search: opens the toolbar's Search, in Show mode. */
export function openSearch() {
  const s = useStore.getState();
  if (s.mode !== 'show' && s.mode !== 'bible') s.setUI({ mode: 'show' });
  useToolbarPop.setState({ pop: 'search' });
}
