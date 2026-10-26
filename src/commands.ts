import { useStore } from './store';
import type { Category } from './types';

/** Creates an empty presentation in a library and opens it in Reflow for typing lyrics. */
export function newPresentation(category: Category = 'song'): string {
  const s = useStore.getState();
  const id = s.createPresentation({ title: category === 'song' ? 'Untitled Song' : 'Untitled', category });
  s.select(id);
  s.setUI({ mode: 'reflow', sidebar: 'library', libraryCategory: category });
  return id;
}

/** Imports plain-text lyric files, one presentation per file. */
export async function importTextFiles(files: File[], category: Category = 'song') {
  const { createPresentation, select } = useStore.getState();
  let last: string | null = null;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.txt') && file.type !== 'text/plain') continue;
    last = createPresentation({ title: file.name.replace(/\.[^.]+$/, ''), category }, await file.text());
  }
  if (last) select(last);
}
