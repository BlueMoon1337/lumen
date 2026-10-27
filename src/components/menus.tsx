/** The right-click menus: what each thing in the window offers, as in ProPresenter. */
import { newPresentation } from '../commands';
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
import type { Group, Library, MediaItem, Playlist, PlaylistItem, Presentation, Slide, SlideTransition, VideoPlayback } from '../types';
import { NamePopup, openPopupAtMenu, openPopupBelow, type ContextEntries } from './ContextMenu';
import { LabelPopup } from './LabelPopup';
import {
  deleteGroup,
  deleteLibrary,
  deleteMedia,
  deletePlaylist,
  deletePresentation,
  deleteSlide,
  deleteSlides,
  removePlaylistItem,
} from './deleting';
import { selectedSlides } from './editCommands';
import {
  exportBundle,
  exportPlaylist,
  exportPresentation,
  exportSlideImagesCommand,
  exportText,
  importFileCommand,
  newLibrary,
  newPlaylist,
} from './fileCommands';
import { shortcut, type IconName } from './ui';
import { setTransitionFor, TargetTransitionPicker, transitionState, type TransitionTarget } from './TransitionPicker';

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
/** Text style entries; `slideIds` are the slides Paste Text Style goes on (the selection, if the slide is in it). */
function styleEntries(p: Presentation, slide: Slide, group: Group, slideIds: string[] = [slide.id]): ContextEntries {
  const s = st();
  const clip = !!s.styleClipboard;
  return [
    { label: 'Copy Text Style', shortcut: shortcut('C', true), action: () => s.copyTextStyle(p.id, slide.id) },
    {
      label: slideIds.length > 1 ? `Paste Text Style to ${slideIds.length} Slides` : 'Paste Text Style',
      shortcut: shortcut('V', true),
      disabled: !clip,
      action: () => s.pasteTextStyle(p.id, { slideIds }),
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

/** Label ▸, for the slide right-clicked and the others selected with it. */
function labelEntries(p: Presentation, slide: Slide, ids: string[], anchor?: Element | null): ContextEntries {
  const s = st();
  const set = (label: Slide['label']) => s.setSlideLabels(p.id, ids, label);
  const presets = labelPresets(s.settings);
  const custom = slide.label && !presets.some((l) => l.name === slide.label?.name && l.color === slide.label.color);
  const popup = <LabelPopup presentationId={p.id} slideIds={ids} />;
  return [
    {
      label: ids.length > 1 ? `Edit ${ids.length} Slides…` : 'Edit…',
      action: () => (anchor?.isConnected ? openPopupBelow(anchor, popup) : openPopupAtMenu(popup)),
    },
    '-',
    { label: 'None', checked: !slide.label, action: () => set(undefined) },
    '-',
    ...presets.map((l) => ({
      label: l.name,
      swatch: l.color,
      checked: slide.label?.name === l.name && slide.label.color === l.color,
      action: () => set(l),
    })),
    custom && slide.label && { label: slide.label.name, swatch: slide.label.color, checked: true, action: () => set(slide.label) },
    '-',
    { label: 'Edit Labels…', action: () => s.setUI({ dialog: 'labels' }) },
  ];
}

// ---- Slides and groups --------------------------------------------------------------

/**
 * A slide's menu, in Show mode's slides (with `index`, its place in the arrangement, to show it)
 * or Edit mode's slide list (`inEdit`). Cut, Copy, Duplicate, Delete and Paste Text Style work
 * on all the selected slides when the slide is one of them.
 */
export function slideMenu(
  p: Presentation,
  slide: Slide,
  group: Group,
  /** `anchor`: the slide's element, for panels that open under it. */
  opts: { index?: number; playlistItemId?: string | null; inEdit?: boolean; anchor?: Element | null },
): ContextEntries {
  const s = st();
  const inEdit = !!opts.inEdit;
  const chosen = selectedSlides(s, p);
  const ids = chosen.includes(slide.id) ? chosen : [slide.id];
  const many = ids.length > 1 ? ` ${ids.length} Slides` : '';
  // In Edit mode a new slide becomes the one on the canvas.
  const select = (id: string | null) => inEdit && id && s.setUI({ editSlideId: id, editTextSelected: false });
  return [
    opts.index != null && { label: 'Show Slide', action: () => s.goLive(p.id, opts.index!, opts.playlistItemId) },
    !inEdit && { label: 'Edit Slide', action: () => s.openEditor(slide.id) },
    '-',
    { label: `Cut${many}`, shortcut: shortcut('X'), action: () => s.cutSlides(p.id, ids) },
    { label: `Copy${many}`, shortcut: shortcut('C'), action: () => s.copySlides(p.id, ids) },
    {
      label: s.slideClipboard && s.slideClipboard.length > 1 ? `Paste ${s.slideClipboard.length} Slides` : 'Paste',
      shortcut: shortcut('V'),
      disabled: !s.slideClipboard,
      action: () => select(s.pasteSlides(p.id, ids[ids.length - 1])),
    },
    { label: `Duplicate${many}`, shortcut: shortcut('D'), action: () => select(s.duplicateSlides(p.id, ids)[0] ?? null) },
    { label: 'Insert Blank Slide', action: () => select(s.addSlide(p.id, slide.id)) },
    { label: many ? `Delete${many}` : 'Delete Slide', shortcut: '⌫', danger: true, action: () => deleteSlides(p.id, ids) },
    '-',
    ...styleEntries(p, slide, group, ids),
    '-',
    { label: 'Group', swatch: group.color, submenu: () => slideGroupEntries(p, slide, group) },
    { label: 'Label', swatch: slide.label?.color, submenu: () => labelEntries(p, slide, ids, opts.anchor) },
    { label: 'Transition', submenu: () => transitionEntries({ presentationId: p.id, scope: { slideId: slide.id } }) },
    { label: 'Media', submenu: () => mediaCueEntries(p, slide) },
  ];
}

/** The slide's media cue: none, or an image or video from the media bin. */
function mediaCueEntries(p: Presentation, slide: Slide): ContextEntries {
  const s = st();
  const visual = s.media.filter((m) => m.kind !== 'audio');
  return [
    { label: 'None', checked: !slide.media, action: () => s.updateSlide(p.id, slide.id, { media: undefined }) },
    '-',
    ...visual.map((m) => ({ label: m.name, checked: slide.media === m.id, action: () => s.updateSlide(p.id, slide.id, { media: m.id }) })),
    !visual.length && { label: 'Import images or videos in the media bin first', disabled: true, action: () => {} },
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
    { label: group.slides.length > 1 ? 'Delete Group…' : 'Delete Group', danger: true, action: () => deleteGroup(p.id, group.id) },
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
      submenu: () =>
        st().libraries.map((l) => ({
          label: l.name,
          checked: p.category === l.id,
          action: () => s.updatePresentation(p.id, { category: l.id }),
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
    {
      label: 'Export',
      submenu: [
        { label: 'Presentation…', action: () => void exportPresentation(p.id) },
        { label: 'Presentation Bundle…', action: () => void exportBundle(p.id) },
        { label: 'Text…', action: () => void exportText(p.id) },
        { label: 'Slide Images…', action: () => exportSlideImagesCommand(p.id) },
      ],
    },
    '-',
    playlistItemId
      ? { label: 'Remove from Playlist', shortcut: '⌫', action: () => removePlaylistItem(playlistItemId) }
      : { label: 'Delete…', shortcut: '⌫', danger: true, action: () => deletePresentation(p.id) },
    // A presentation in a playlist can be deleted from the library from here too.
    !!playlistItemId && { label: 'Delete from Library…', danger: true, action: () => deletePresentation(p.id) },
  ];
}

export function playlistHeaderMenu(item: Extract<PlaylistItem, { type: 'header' }>, onRename: () => void): ContextEntries {
  return [
    { label: 'Rename Header', action: onRename },
    { label: 'Remove Header', shortcut: '⌫', action: () => removePlaylistItem(item.id) },
  ];
}

export function libraryMenu(lib: Library, onRename: () => void): ContextEntries {
  const s = st();
  const open = () => s.setUI({ sidebar: 'library', libraryCategory: lib.id });
  return [
    { label: 'Open', action: open },
    { label: 'Rename…', action: onRename },
    '-',
    { label: 'New Presentation', action: () => newPresentation(lib.id) },
    {
      label: 'Import Files…',
      action: () => {
        open();
        void importFileCommand(lib.id);
      },
    },
    { label: 'New Library…', action: () => void newLibrary() },
    '-',
    { label: 'Delete Library…', danger: true, disabled: s.libraries.length <= 1, action: () => deleteLibrary(lib.id) },
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
    { label: 'New Playlist…', action: () => void newPlaylist() },
    { label: 'Export Playlist…', action: () => void exportPlaylist(pl.id) },
    '-',
    {
      label: 'Delete Playlist…',
      danger: true,
      disabled: s.playlists.length <= 1,
      action: () => deletePlaylist(pl.id),
    },
  ];
}

/** What a video does when it ends. */
export const PLAYBACK: { value: VideoPlayback; label: string; short: string; icon: IconName }[] = [
  { value: 'loop', label: 'Loop', short: 'Loop', icon: 'repeat' },
  { value: 'stop', label: 'Stop on the Last Frame', short: 'Stop', icon: 'pause' },
  { value: 'clear', label: 'Clear', short: 'Clear', icon: 'close' },
  { value: 'next', label: 'Play the Next One', short: 'Next', icon: 'forward10' },
];

export function playbackEntries(mediaId: string): ContextEntries {
  const s = st();
  const item = s.media.find((m) => m.id === mediaId);
  return [
    { header: 'When It Ends' },
    ...PLAYBACK.map((p) => ({
      label: p.label,
      checked: (item?.playback ?? 'loop') === p.value,
      action: () => s.updateMedia(mediaId, { playback: p.value }),
    })),
  ];
}

/** A media bin item; `playlistId` when it's shown in a media playlist. */
export function mediaMenu(m: MediaItem, playlistId?: string | null): ContextEntries {
  const s = st();
  const live = s.live.mediaId === m.id;
  const logo = s.settings.logoMediaId === m.id;
  return [
    { label: live ? 'Clear from Screen' : 'Show on Media Layer', action: () => s.setLiveMedia(live ? null : m.id, playlistId ?? null) },
    m.kind === 'video' && { label: 'When It Ends', submenu: () => playbackEntries(m.id).slice(1) },
    { label: 'Use as Logo', checked: logo, action: () => s.updateSettings({ logoMediaId: logo ? undefined : m.id }) },
    { label: 'Media Transition…', action: () => openPopupAtMenu(<TargetTransitionPicker target="media" />) },
    '-',
    {
      label: 'Add to Media Playlist',
      submenu: () => [
        ...st().mediaPlaylists.map((pl) => ({
          label: pl.name,
          checked: pl.items.includes(m.id),
          action: () => s.addToMediaPlaylist(pl.id, [m.id]),
        })),
        st().mediaPlaylists.length > 0 && '-',
        {
          label: 'New Playlist…',
          action: () =>
            openPopupAtMenu(
              <NamePopup
                title="New Media Playlist"
                colors={false}
                action="Create"
                initial={{ name: 'Playlist', color: '' }}
                onSave={(v) => s.addToMediaPlaylist(s.createMediaPlaylist(v.name), [m.id])}
              />,
            ),
        },
      ],
    },
    !!playlistId && { label: 'Remove from Playlist', action: () => s.removeFromMediaPlaylist(playlistId, m.id) },
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
    { label: 'Delete…', danger: true, action: () => deleteMedia(m.id) },
  ];
}

/** The text box on Edit mode's canvas. */
export function canvasMenu(p: Presentation, slide: Slide, group: Group, editText: () => void): ContextEntries {
  return [
    { label: 'Edit Text', shortcut: '↩', action: editText },
    '-',
    ...styleEntries(p, slide, group),
    '-',
    { label: 'Label', swatch: slide.label?.color, submenu: () => labelEntries(p, slide, [slide.id]) },
    { label: 'Transition', submenu: () => transitionEntries({ presentationId: p.id, scope: { slideId: slide.id } }) },
    '-',
    { label: 'Delete Slide', danger: true, action: () => deleteSlide(p.id, slide.id) },
  ];
}
