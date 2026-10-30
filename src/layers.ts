/**
 * The layers of the picture (and audio), as in ProPresenter's clear column, top to bottom:
 * Audio, Messages, Logo (where ProPresenter has Props), Announcements, Slide, Media, Video Input.
 */
import type { IconName } from './components/ui';
import type { ClearGroup, ClearLayer, LiveState, Settings } from './types';

export const LAYERS: { id: ClearLayer; label: string; icon: IconName; hotkey?: string }[] = [
  { id: 'audio', label: 'Audio', icon: 'music', hotkey: 'F5' },
  { id: 'messages', label: 'Messages', icon: 'send', hotkey: 'F6' },
  { id: 'logo', label: 'Logo', icon: 'layers', hotkey: 'F4' },
  { id: 'announcements', label: 'Announcements', icon: 'megaphone', hotkey: 'F7' },
  { id: 'slide', label: 'Slide', icon: 'lines', hotkey: 'F2' },
  { id: 'media', label: 'Media', icon: 'image', hotkey: 'F3' },
  { id: 'videoInput', label: 'Video Input', icon: 'video' },
];

export const ALL_LAYERS: ClearLayer[] = LAYERS.map((l) => l.id);

export const layerLabel = (id: ClearLayer) => LAYERS.find((l) => l.id === id)?.label ?? id;

/** The clear groups a new library starts with; the operator can change them (Clear Groups…). */
export const DEFAULT_CLEAR_GROUPS: ClearGroup[] = [
  { id: 'cg-text', name: 'Clear Text', icon: 'lines', color: '#e6458b', layers: ['slide', 'announcements', 'messages'] },
  { id: 'cg-visuals', name: 'Clear All but Audio', icon: 'close', color: '#f7941d', layers: ALL_LAYERS.filter((l) => l !== 'audio') },
  { id: 'cg-media', name: 'Clear Media & Audio', icon: 'music', color: '#9b5de5', layers: ['media', 'videoInput', 'audio'] },
];

export const clearGroupsOf = (settings: Pick<Settings, 'clearGroups'>) => settings.clearGroups ?? DEFAULT_CLEAR_GROUPS;

/** Icons a clear group can have. */
export const CLEAR_GROUP_ICONS: { name: IconName; label: string }[] = [
  { name: 'close', label: 'Clear' },
  { name: 'lines', label: 'Words' },
  { name: 'text', label: 'Text' },
  { name: 'slides', label: 'Slides' },
  { name: 'megaphone', label: 'Announcements' },
  { name: 'music', label: 'Music' },
  { name: 'image', label: 'Media' },
  { name: 'video', label: 'Camera' },
  { name: 'send', label: 'Message' },
  { name: 'layers', label: 'Logo' },
];

/** Whether a layer has something on it. */
export function isLayerLive(live: LiveState, layer: ClearLayer): boolean {
  switch (layer) {
    case 'audio':
      return !!live.audioId;
    case 'messages':
      return !!live.messageId;
    case 'logo':
      return live.logo;
    case 'announcements':
      return !!live.announcement;
    case 'slide':
      return !!live.slide;
    case 'media':
      return !!live.mediaId;
    case 'videoInput':
      return !!live.videoInput;
  }
}

/** The live state with some layers cleared. */
export function clearLive(live: LiveState, layers: ClearLayer[]): LiveState {
  const next = { ...live };
  for (const layer of layers) {
    if (layer === 'audio') Object.assign(next, { audioId: null, audioPaused: false, audioFrom: null, audioPlayed: [], audioLoop: false });
    if (layer === 'messages') next.messageId = null;
    if (layer === 'logo') next.logo = false;
    if (layer === 'announcements') next.announcement = null;
    if (layer === 'slide') Object.assign(next, { slide: null, stageSlide: null });
    if (layer === 'media') Object.assign(next, { mediaId: null, mediaPaused: false });
    if (layer === 'videoInput') next.videoInput = null;
  }
  return next;
}
