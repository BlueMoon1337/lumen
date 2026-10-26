/** The right-click menus: what each thing in the window offers, as in ProPresenter. */
import { groupPresets, LABEL_SWATCHES, labelPresets } from '../labels';
import { colorForGroup } from '../lyrics';
import type { SlideScope } from '../slideOps';
import { useStore } from '../store';
import {
  DEFAULT_TRANSITION,
  directionLabel,
  directionOf,
  EASINGS,
  easingOf,
  QUICK_DURATIONS,
  TRANSITION_KINDS,
  transitionLabel,
  withChanges,
} from '../transitions';
import type { Group, MediaItem, Playlist, PlaylistItem, Presentation, Slide, SlideTransition } from '../types';
import { NamePopup, openPopupAtMenu, type ContextEntries } from './ContextMenu';
import { LIBRARIES } from './Sidebar';
import { setTransitionFor, TargetTransitionPicker, transitionState, type TransitionTarget } from './TransitionPicker';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** How a shortcut reads on this computer: "⌥⌘C" or "⇧⌘Z" on a Mac, "Ctrl+Alt+C" or "Ctrl+Shift+Z" elsewhere. */
export const shortcut = (key: string, alt = false, shift = false) =>
  IS_MAC ? `${alt ? '⌥' : ''}${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;

const st = () => useStore.getState();

// ---- Shared submenus ----------------------------------------------------------------

/** Choose a transition: follow the default, a kind (by direction for those that move), a length, an easing, or the panel. */
export function transitionEntries(target: TransitionTarget): ContextEntries {
  const state = transitionState(st(), target);
  const own = state.value;
  const base = own ?? state.inherited ?? DEFAULT_TRANSITION;
  const set = (patch: Partial<SlideTransition>) => setTransitionFor(target, withChanges(base, patch));
  return [
    state.inherited && {
      label: `${state.inheritedLabel?.includes('presentation') ? 'Presentation Default' : 'Global Default'} (${transitionLabel(state.inherited)})`,
      checked: !own,
      action: () => setTransitionFor(target, undefined),
    },
    state.inherited && '-',
    ...TRANSITION_KINDS.map((k) =>
      k.directions
        ? {
            label: k.label,
            submenu: k.directions.map((d) => ({
              label: directionLabel(k.kind, d),
              checked: own?.kind === k.kind && directionOf(own) === d,
              action: () => set({ kind: k.kind, direction: d }),
            })),
          }
        : { label: k.label, checked: own?.kind === k.kind, title: k.hint, action: () => set({ kind: k.kind }) },
    ),
    '-',
    {
      label: 'Duration',
      disabled: base.kind === 'cut',
      submenu: QUICK_DURATIONS.map((ms) => ({
        label: `${ms / 1000}s`,
        checked: !!own && own.kind !== 'cut' && own.ms === ms,
        action: () => set({ ms }),
      })),
    },
    {
      label: 'Easing',
      disabled: base.kind === 'cut',
      submenu: EASINGS.map((e) => ({
        label: e.label,
        checked: !!own && own.kind !== 'cut' && easingOf(own) === e.value,
        action: () => set({ easing: e.value }),
      })),
    },
    { label: 'Transition Options…', action: () => openPopupAtMenu(<TargetTransitionPicker target={target} />) },
  ];
}

/** Copy, paste and clear text formatting. */
function styleEntries(p: Presentation, slide: Slide, group: Group, inEdit: boolean): ContextEntries {
  const s = st();
  const clip = !!s.styleClipboard;
  return [
    { label: 'Copy Text Style', shortcut: inEdit ? shortcut('C', true) : undefined, action: () => s.copyTextStyle(p.id, slide.id) },
    {
      label: 'Paste Text Style',
      shortcut: inEdit ? shortcut('V', true) : undefined,
      disabled: !clip,
      action: () => s.pasteTextStyle(p.id, { slideId: slide.id }),
    },
    {
      label: 'Paste Text Style To',
      disabled: !clip,
      submenu: [
        { label: `Group “${group.name}”`, action: () => s.pasteTextStyle(p.id, { groupId: group.id }) },
        { label: 'All Slides', action: () => s.pasteTextStyle(p.id, 'presentation') },
      ],
    },
    { label: 'Clear Text Style', disabled: !slide.style, action: () => s.clearTextStyle(p.id, { slideId: slide.id }) },
  ];
}

const newGroupPopup = (onSave: (g: { name: string; color: string }) => void, title = 'New Group') =>
  openPopupAtMenu(
    <NamePopup
      title={title}
      initial={{ name: '', color: colorForGroup('') }}
      action="Create"
      suggestColor={colorForGroup}
      onSave={onSave}
    />,
  );

/** Put a slide in a group (it and the slides after it in its group), or make a new one. */
function slideGroupEntries(p: Presentation, slide: Slide, group: Group): ContextEntries {
  const s = st();
  return [
    ...groupPresets(s.settings).map((g) => ({
      label: g.name,
      swatch: g.color,
      checked: group.name === g.name,
      action: () => s.assignGroup(p.id, slide.id, g),
    })),
    '-',
    { label: 'New Group…', action: () => newGroupPopup((g) => s.assignGroup(p.id, slide.id, g)) },
    { label: 'Edit Groups…', action: () => s.setUI({ dialog: 'labels' }) },
  ];
}

function labelEntries(p: Presentation, slide: Slide): ContextEntries {
  const s = st();
  const set = (label: Slide['label']) => s.setSlideLabel(p.id, slide.id, label);
  const presets = labelPresets(s.settings);
  const custom = slide.label && !presets.some((l) => l.name === slide.label?.name && l.color === slide.label.color);
  return [
    { label: 'None', checked: !slide.label, action: () => set(undefined) },
    '-',
    ...presets.map((l) => ({
      label: l.name,
      swatch: l.color,
      checked: slide.label?.name === l.name && slide.label.color === l.color,
      action: () => set(l),
    })),
    custom && slide.label && { label: slide.label.name, swatch: slide.label.color, checked: true, action: () => {} },
    '-',
    {
      label: 'Custom Label…',
      action: () => openPopupAtMenu(<NamePopup title="Slide Label" initial={slide.label ?? { name: '', color: '#e07b28' }} onSave={set} />),
    },
    { label: 'Edit Labels…', action: () => s.setUI({ dialog: 'labels' }) },
  ];
}

// ---- Slides and groups --------------------------------------------------------------

/**
 * A slide's menu, in Show mode's slides (with `index`, its place in the arrangement, to show it)
 * or Edit mode's slide list (`inEdit`, where the keyboard shortcuts work).
 */
export function slideMenu(
  p: Presentation,
  slide: Slide,
  group: Group,
  opts: { index?: number; playlistItemId?: string | null; inEdit?: boolean },
): ContextEntries {
  const s = st();
  const inEdit = !!opts.inEdit;
  const key = (k: string) => (inEdit ? shortcut(k) : undefined);
  // In Edit mode a new slide becomes the selected one.
  const select = (id: string | null) => inEdit && id && s.openEditor(id);
  return [
    opts.index != null && { label: 'Show Slide', action: () => s.goLive(p.id, opts.index!, opts.playlistItemId) },
    !inEdit && { label: 'Edit Slide', action: () => s.openEditor(slide.id) },
    '-',
    { label: 'Cut', shortcut: key('X'), action: () => s.cutSlides(p.id, [slide.id]) },
    { label: 'Copy', shortcut: key('C'), action: () => s.copySlides(p.id, [slide.id]) },
    {
      label: s.slideClipboard && s.slideClipboard.length > 1 ? `Paste ${s.slideClipboard.length} Slides` : 'Paste',
      shortcut: key('V'),
      disabled: !s.slideClipboard,
      action: () => select(s.pasteSlides(p.id, slide.id)),
    },
    { label: 'Duplicate', shortcut: key('D'), action: () => select(s.duplicateSlide(p.id, slide.id)) },
    { label: 'Insert Blank Slide', action: () => select(s.addSlide(p.id, slide.id)) },
    { label: 'Delete Slide…', danger: true, action: () => confirm('Delete this slide?') && s.deleteSlide(p.id, slide.id) },
    '-',
    ...styleEntries(p, slide, group, inEdit),
    '-',
    { label: 'Group', swatch: group.color, submenu: () => slideGroupEntries(p, slide, group) },
    { label: 'Label', swatch: slide.label?.color, submenu: () => labelEntries(p, slide) },
    { label: 'Transition', submenu: () => transitionEntries({ presentationId: p.id, scope: { slideId: slide.id } }) },
  ];
}

/** Edit mode's slide-list group header. */
export function groupMenu(p: Presentation, group: Group): ContextEntries {
  const s = st();
  const scope: SlideScope = { groupId: group.id };
  return [
    {
      label: 'Rename Group…',
      action: () => openPopupAtMenu(<NamePopup title="Group" initial={group} onSave={(v) => s.updateGroup(p.id, group.id, v)} />),
    },
    {
      label: 'Group',
      submenu: () =>
        groupPresets(st().settings).map((g) => ({
          label: g.name,
          swatch: g.color,
          checked: group.name === g.name,
          action: () => s.updateGroup(p.id, group.id, g),
        })),
    },
    {
      label: 'Color',
      swatch: group.color,
      submenu: LABEL_SWATCHES.map((c) => ({
        label: c.name,
        swatch: c.color,
        checked: group.color === c.color,
        action: () => s.updateGroup(p.id, group.id, { color: c.color }),
      })),
    },
    '-',
    {
      label: 'Add Slide to Group',
      action: () => {
        const id = s.addSlide(p.id, group.slides.at(-1)?.id);
        if (id) s.openEditor(id);
      },
    },
    { label: 'Duplicate Group', action: () => s.duplicateGroup(p.id, group.id) },
    '-',
    { label: 'Paste Text Style to Group', disabled: !s.styleClipboard, action: () => s.pasteTextStyle(p.id, scope) },
    { label: 'Clear Text Style', disabled: !group.slides.some((sl) => sl.style), action: () => s.clearTextStyle(p.id, scope) },
    { label: 'Transition', submenu: () => transitionEntries({ presentationId: p.id, scope }) },
    '-',
    {
      label: 'Delete Group…',
      danger: true,
      action: () =>
        confirm(`Delete “${group.name}” and its ${group.slides.length} slide${group.slides.length === 1 ? '' : 's'}?`) &&
        s.deleteGroup(p.id, group.id),
    },
  ];
}

// ---- Library, playlists, media ---------------------------------------------------------

/** A presentation in the library, or (with `playlistItemId`) in a playlist. */
export function presentationMenu(p: Presentation, playlistItemId?: string): ContextEntries {
  const s = st();
  const open = () => s.select(p.id, playlistItemId ?? null);
  return [
    { label: 'Open', action: open },
    {
      label: 'Edit Slides',
      action: () => {
        open();
        s.openEditor();
      },
    },
    {
      label: 'Reflow',
      action: () => {
        open();
        s.setUI({ mode: 'reflow' });
      },
    },
    '-',
    {
      label: 'Add to Playlist',
      submenu: () => st().playlists.map((pl) => ({ label: pl.name, action: () => s.addToPlaylist(p.id, undefined, pl.id) })),
    },
    {
      label: 'Library',
      submenu: LIBRARIES.map((l) => ({
        label: l.label,
        checked: p.category === l.category,
        action: () => s.updatePresentation(p.id, { category: l.category }),
      })),
    },
    {
      label: 'Theme',
      submenu: () => [
        { label: 'Default', checked: !p.themeId, action: () => s.updatePresentation(p.id, { themeId: undefined }) },
        '-',
        ...st().themes.map((t) => ({
          label: t.name,
          checked: p.themeId === t.id,
          action: () => s.updatePresentation(p.id, { themeId: t.id }),
        })),
      ],
    },
    { label: 'Transition', submenu: () => transitionEntries({ presentationId: p.id, scope: 'presentation' }) },
    {
      label: 'Plays On',
      submenu: [
        { label: 'Slides', checked: !p.destination, action: () => s.updatePresentation(p.id, { destination: undefined }) },
        {
          label: 'Announcements',
          checked: p.destination === 'announcements',
          action: () => s.updatePresentation(p.id, { destination: 'announcements' }),
        },
      ],
    },
    {
      label: 'Auto-Advance',
      submenu: [
        { label: 'Off', checked: !p.autoAdvance, action: () => s.updatePresentation(p.id, { autoAdvance: undefined }) },
        '-',
        ...[5, 8, 10, 15, 30, 60].map((seconds) => ({
          label: `Every ${seconds}s`,
          checked: p.autoAdvance?.seconds === seconds,
          action: () => s.updatePresentation(p.id, { autoAdvance: { loop: p.autoAdvance?.loop ?? true, seconds } }),
        })),
        '-',
        {
          label: 'Loop',
          checked: !!p.autoAdvance?.loop,
          disabled: !p.autoAdvance,
          action: () => p.autoAdvance && s.updatePresentation(p.id, { autoAdvance: { ...p.autoAdvance, loop: !p.autoAdvance.loop } }),
        },
      ],
    },
    { label: 'Paste Text Style to All Slides', disabled: !s.styleClipboard, action: () => s.pasteTextStyle(p.id, 'presentation') },
    '-',
    {
      label: 'Rename…',
      action: () =>
        openPopupAtMenu(
          <NamePopup
            title="Rename Presentation"
            colors={false}
            initial={{ name: p.title, color: '' }}
            onSave={(v) => s.updatePresentation(p.id, { title: v.name })}
          />,
        ),
    },
    { label: 'Duplicate', action: () => s.duplicatePresentation(p.id) },
    playlistItemId
      ? { label: 'Remove from Playlist', action: () => s.removePlaylistItem(playlistItemId) }
      : {
          label: 'Delete…',
          danger: true,
          action: () => confirm(`Delete "${p.title}"? This cannot be undone.`) && s.deletePresentation(p.id),
        },
  ];
}

export function playlistHeaderMenu(item: Extract<PlaylistItem, { type: 'header' }>, onRename: () => void): ContextEntries {
  return [
    { label: 'Rename Header', action: onRename },
    { label: 'Remove Header', action: () => st().removePlaylistItem(item.id) },
  ];
}

export function playlistMenu(pl: Playlist, onRename: () => void): ContextEntries {
  const s = st();
  return [
    {
      label: 'Open',
      action: () => {
        s.setActivePlaylist(pl.id);
        s.setUI({ sidebar: 'playlist' });
      },
    },
    { label: 'Rename…', action: onRename },
    {
      label: 'Add Header',
      action: () => {
        s.setActivePlaylist(pl.id);
        s.addPlaylistHeader('Header');
      },
    },
    '-',
    {
      label: 'New Playlist…',
      action: () =>
        openPopupAtMenu(
          <NamePopup
            title="New Playlist"
            colors={false}
            action="Create"
            initial={{ name: 'New Service', color: '' }}
            onSave={(v) => {
              s.createPlaylist(v.name);
              s.setUI({ sidebar: 'playlist' });
            }}
          />,
        ),
    },
    {
      label: 'Delete Playlist…',
      danger: true,
      disabled: s.playlists.length <= 1,
      action: () => confirm(`Delete playlist "${pl.name}"?`) && s.deletePlaylist(pl.id),
    },
  ];
}

export function mediaMenu(m: MediaItem): ContextEntries {
  const s = st();
  const live = s.live.mediaId === m.id;
  const logo = s.settings.logoMediaId === m.id;
  return [
    { label: live ? 'Clear from Screen' : 'Show Behind Slides', action: () => s.setLiveMedia(live ? null : m.id) },
    { label: 'Use as Logo', checked: logo, action: () => s.updateSettings({ logoMediaId: logo ? undefined : m.id }) },
    { label: 'Media Transition…', action: () => openPopupAtMenu(<TargetTransitionPicker target="media" />) },
    '-',
    {
      label: 'Rename…',
      action: () =>
        openPopupAtMenu(
          <NamePopup
            title="Rename"
            colors={false}
            initial={{ name: m.name, color: '' }}
            onSave={(v) => s.updateMedia(m.id, { name: v.name })}
          />,
        ),
    },
    { label: 'Delete…', danger: true, action: () => confirm(`Delete "${m.name}"?`) && s.deleteMedia(m.id) },
  ];
}

/** The text box on Edit mode's canvas. */
export function canvasMenu(p: Presentation, slide: Slide, group: Group, editText: () => void): ContextEntries {
  const s = st();
  return [
    { label: 'Edit Text', shortcut: '↩', action: editText },
    '-',
    ...styleEntries(p, slide, group, true),
    '-',
    { label: 'Label', swatch: slide.label?.color, submenu: () => labelEntries(p, slide) },
    { label: 'Transition', submenu: () => transitionEntries({ presentationId: p.id, scope: { slideId: slide.id } }) },
    '-',
    { label: 'Delete Slide…', danger: true, action: () => confirm('Delete this slide?') && s.deleteSlide(p.id, slide.id) },
  ];
}
