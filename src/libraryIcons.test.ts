import { describe, expect, it } from 'vitest';
import { versesLibrary } from './libraryIcons';

const lib = (id: string, name: string, icon?: 'bible' | 'library') => ({ id, name, icon });

describe('versesLibrary', () => {
  it('keeps the library chosen while it exists', () => {
    expect(versesLibrary([lib('song', 'Songs'), lib('scripture', 'Scripture'), lib('x', 'Titles')], 'x')).toBe('x');
  });
  it('falls back to Scripture, not the first library', () => {
    expect(versesLibrary([lib('song', 'Songs'), lib('scripture', 'Scripture')], 'gone')).toBe('scripture');
  });
  it('finds a library named for verses, or given the Bible icon', () => {
    expect(versesLibrary([lib('song', 'Songs'), lib('t', 'Titles'), lib('v', 'Verses')])).toBe('v');
    expect(versesLibrary([lib('song', 'Songs'), lib('v', 'Versículos')])).toBe('v');
    expect(versesLibrary([lib('song', 'Songs'), lib('w', 'Word', 'bible')])).toBe('w');
  });
  it('uses the first when none looks like scripture', () => {
    expect(versesLibrary([lib('song', 'Songs'), lib('t', 'Titles')])).toBe('song');
  });
});
