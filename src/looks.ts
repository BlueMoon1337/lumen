/**
 * Looks, as in ProPresenter (Screens ▸ Live, Edit Looks…): for each audience screen, which
 * layers it shows, a theme of its own for the slides (a lower third for a livestream, say),
 * and a mask. The live look drives the screens; presets are saved looks to switch to.
 */
import type { Look, LookMask, LookScreen, ScreenLook, Theme } from './types';

/** A screen a look doesn't mention shows everything. */
export const FULL_SCREEN: LookScreen = {
  messages: true,
  logo: true,
  announcements: true,
  slide: true,
  media: true,
  videoInput: true,
};

export const DEFAULT_LOOK: Look = { id: 'look-default', name: 'Default', screens: {} };

export const lookScreen = (look: Pick<Look, 'screens'>, screenId: string): LookScreen => ({
  ...FULL_SCREEN,
  ...look.screens[screenId],
});

/** The rows of the Looks window's switches, top to bottom. */
export const LOOK_LAYERS: { key: keyof Omit<LookScreen, 'themeId' | 'mask'>; label: string }[] = [
  { key: 'messages', label: 'Messages' },
  { key: 'logo', label: 'Logo' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'slide', label: 'Slide' },
  { key: 'media', label: 'Media' },
  { key: 'videoInput', label: 'Video Input' },
];

/** The masks, as the part of the screen they leave showing (CSS inset() of a 16:9 screen). */
export const MASKS: { id: LookMask; label: string; inset: [number, number, number, number] | null }[] = [
  { id: 'none', label: 'None', inset: null },
  { id: 'fourThree', label: '4:3 in the Middle', inset: [0, 12.5, 0, 12.5] },
  { id: 'letterbox', label: 'Letterbox (2.39:1)', inset: [12.8, 0, 12.8, 0] },
  { id: 'lowerThird', label: 'Lower Third', inset: [66.67, 0, 0, 0] },
  { id: 'upperThird', label: 'Upper Third', inset: [0, 0, 66.67, 0] },
  { id: 'leftHalf', label: 'Left Half', inset: [0, 50, 0, 0] },
  { id: 'rightHalf', label: 'Right Half', inset: [0, 0, 0, 50] },
];

/** A mask as a CSS clip-path; the whole screen for none. */
export function maskClip(mask: LookMask | undefined): string {
  const inset = MASKS.find((m) => m.id === mask)?.inset ?? [0, 0, 0, 0];
  return `inset(${inset.map((v) => `${v}%`).join(' ')})`;
}

export function screenLook(look: Look, screenId: string, themes: Theme[], fadeMs: number): ScreenLook {
  const { themeId, mask, ...show } = lookScreen(look, screenId);
  return { show, theme: themes.find((t) => t.id === themeId), mask: mask ?? 'none', fadeMs };
}

/** Whether two looks show the same thing (so the live look still is the preset it came from). */
export function sameLook(a: Look, b: Look, screenIds: string[]): boolean {
  return screenIds.every((id) => JSON.stringify(lookScreen(a, id)) === JSON.stringify(lookScreen(b, id)));
}
