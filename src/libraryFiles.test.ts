import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plannedFiles, syncLibraryFiles } from './libraryFiles';
import { useStore } from './store';
import type { Presentation } from './types';

const pres = (id: string, title: string, category = 'song'): Presentation =>
  ({ id, title, category, groups: [], arrangement: [], updatedAt: 1 }) as unknown as Presentation;

describe('presentation files in Libraries', () => {
  it('go in their library’s folder, named after them, numbered when two match', () => {
    const plan = plannedFiles(
      [pres('a', 'Oceans'), pres('b', 'Oceans'), pres('c', 'Titles: Sunday', 'titles')],
      (c) => (c === 'song' ? 'Songs' : 'Titles'),
      {},
    );
    expect(
      Object.values(plan)
        .map((f) => `${f.folder}/${f.name}`)
        .sort(),
    ).toEqual(['Libraries/Songs/Oceans 2.lumen', 'Libraries/Songs/Oceans.lumen', 'Libraries/Titles/Titles Sunday.lumen']);
  });

  it('keep the name they were written with when a namesake comes along', () => {
    const plan = plannedFiles([pres('new', 'Oceans'), pres('old', 'Oceans')], () => 'Songs', {
      old: { folder: 'Libraries/Songs', name: 'Oceans.lumen', at: 1 },
    });
    expect(plan.old.name).toBe('Oceans.lumen');
    expect(plan.new.name).toBe('Oceans 2.lumen');
  });
});

describe('keeping the Libraries folder in step', () => {
  const files = new Map<string, string>();
  const storage = new Map<string, string>();
  beforeEach(() => {
    files.clear();
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    });
    vi.stubGlobal('window', {
      lumenDesktop: {
        lumenFolder: async () => '/Users/me/Documents/Lumen',
        writeFinderFile: async (folder: string, name: string, data: Uint8Array) =>
          void files.set(`${folder}/${name}`, new TextDecoder().decode(data)),
        removeLumenFile: async (folder: string, name: string) => void files.delete(`${folder}/${name}`),
      },
    });
    useStore.setState({
      libraries: [
        { id: 'song', name: 'Songs' },
        { id: 'other', name: 'Other' },
      ],
      presentations: { a: pres('a', 'Oceans') },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('writes, renames, moves and removes the files as the library changes', async () => {
    await syncLibraryFiles();
    expect([...files.keys()]).toEqual(['Libraries/Songs/Oceans.lumen']);
    expect(JSON.parse(files.get('Libraries/Songs/Oceans.lumen')!).presentations[0].title).toBe('Oceans');

    useStore.setState((s) => ({ presentations: { a: { ...s.presentations.a, title: 'Oceans (Live)', category: 'other', updatedAt: 2 } } }));
    await syncLibraryFiles();
    expect([...files.keys()]).toEqual(['Libraries/Other/Oceans (Live).lumen']);

    useStore.setState({ presentations: {} });
    await syncLibraryFiles();
    expect(files.size).toBe(0);
  });
});
