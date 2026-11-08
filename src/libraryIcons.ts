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

/**
 * The library saved Bible passages go into: the one chosen (Bible ▸ Save As ▸ Library), if it's
 * still there; else the one that looks like it's for scripture (the Bible icon, or a name such as
 * Scripture, Verses or Versículos); else the first.
 */
export function versesLibrary(libraries: Library[], chosen?: string): string {
  if (chosen && libraries.some((l) => l.id === chosen)) return chosen;
  const looks = (l: Library) =>
    l.id === 'scripture' || libraryIcon(l) === 'bible' || /scripture|verse|bible|biblia|escritura|vers[ií]culo|pasaje/i.test(l.name);
  return (libraries.find(looks) ?? libraries[0]).id;
}
