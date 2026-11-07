/** The icons a library can have in the sidebar (right-click it ▸ Icon). */
import type { Library, LibraryIcon } from './types';

export const LIBRARY_ICONS: { id: LibraryIcon; name: string }[] = [
  { id: 'library', name: 'Box' },
  { id: 'bible', name: 'Scripture' },
  { id: 'powerpoint', name: 'PowerPoint' },
  { id: 'trebleClef', name: 'Treble Clef' },
];

/** A library's icon: the one chosen, else the Bible for Scripture and the box for the others. */
export const libraryIcon = (lib: Library): LibraryIcon => lib.icon ?? (lib.id === 'scripture' ? 'bible' : 'library');
