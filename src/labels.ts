import { PROPRESENTER_GROUPS } from './lyrics';
import type { ColorLabel, Settings } from './types';

/** The groups offered when assigning slides: ProPresenter's, with its colors. Colors match imported and typed lyrics. */
export const DEFAULT_GROUPS: ColorLabel[] = PROPRESENTER_GROUPS.map((g) => ({ ...g }));

/** Lumen's group list before it matched ProPresenter's, to recognise saved settings that are just that. */
export const OLD_DEFAULT_GROUPS = [
  'Verse 1',
  'Verse 2',
  'Verse 3',
  'Verse 4',
  'Pre-Chorus',
  'Chorus',
  'Bridge',
  'Tag',
  'Vamp',
  'Intro',
  'Interlude',
  'Outro',
  'Ending',
];

/**
 * Saved groups after ProPresenter's list came in: Lumen's old list becomes the new one; a list
 * someone changed keeps their changes and gains the groups it doesn't have.
 */
export function upgradeGroupPresets(saved: ColorLabel[] | undefined): ColorLabel[] | undefined {
  if (!saved) return undefined;
  if (saved.length === OLD_DEFAULT_GROUPS.length && saved.every((g, i) => g.name === OLD_DEFAULT_GROUPS[i])) return undefined;
  const key = (n: string) => n.toLowerCase().replace(/[\s-]+/g, '');
  const have = new Set(saved.map((g) => key(g.name)));
  return [...saved, ...DEFAULT_GROUPS.filter((g) => !have.has(key(g.name)))];
}

/** Slide labels: cues for the operator, shown on the thumbnails. */
export const DEFAULT_LABELS: ColorLabel[] = [
  { name: 'Welcome', color: '#22a35a' },
  { name: 'Announcements', color: '#e07b28' },
  { name: 'Prayer', color: '#7c5cd6' },
  { name: 'Scripture', color: '#2f7fd8' },
  { name: 'Sermon', color: '#c43c4e' },
  { name: 'Offering', color: '#c9a227' },
  { name: 'Communion', color: '#8e2a4f' },
  { name: 'Key Change', color: '#14b8a6' },
  { name: 'Instrumental', color: '#6b7280' },
  { name: 'Last Time', color: '#db4fa0' },
];

export const groupPresets = (settings: Pick<Settings, 'groupPresets'>) => settings.groupPresets ?? DEFAULT_GROUPS;
export const labelPresets = (settings: Pick<Settings, 'labelPresets'>) => settings.labelPresets ?? DEFAULT_LABELS;

/** Colors offered for groups and labels. */
export const LABEL_SWATCHES: ColorLabel[] = [
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Red', color: '#d9485f' },
  { name: 'Gold', color: '#d4a72c' },
  { name: 'Purple', color: '#9b5de5' },
  { name: 'Teal', color: '#14b8a6' },
  { name: 'Green', color: '#22a35a' },
  { name: 'Orange', color: '#e07b28' },
  { name: 'Pink', color: '#db4fa0' },
  { name: 'Gray', color: '#6b7280' },
  { name: 'Black', color: '#1a1a1a' },
  { name: 'White', color: '#e5e5e5' },
];
