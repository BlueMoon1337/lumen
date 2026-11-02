import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { loadMedia, useMedia } from '../media';
import { convertHeicPhotos } from '../heic';
import { dismiss, notify } from '../notices';
import { useStore } from '../store';
import { fitsTab, type MediaItem, type MediaPlaylist } from '../types';
import { formatDuration } from '../util';
import { CameraFill } from './Canvas';
import { NamePopup, openContextMenu, openPopupBelow } from './ContextMenu';
import { deleteMedia, deleteMediaPlaylist, removeFromTab, TAB_NAMES, type SpecialTab } from './deleting';
import { mediaMenu, mediaSelectionMenu } from './menus';
import { TransitionButton } from './TransitionPicker';
import { offerReconnect, useIsMissing } from '../finder';
import { actedOn, clickSelection, isExtending, useMediaSelection } from '../selection';
import {
  DRAG_MEDIA,
  DRAG_MEDIA_IDS,
  draggedIds,
  nearestGap,
  FilterField,
  setDragPreview,
  useMarqueeSelect,
  hasOutsideFiles,
  Icon,
  IconButton,
  pickFiles,
  SectionHeader,
} from './ui';

const FILTERS = [
  { value: 'all', label: 'All Media', icon: 'image' },
  { value: 'image', label: 'Images', icon: 'image' },
  { value: 'video', label: 'Videos', icon: 'video' },
  { value: 'background', label: 'Backgrounds', icon: 'backdrop' },
  { value: 'countdown', label: 'Countdowns', icon: 'clock' },
  { value: 'outro', label: 'Outro', icon: 'outro' },
  { value: 'logo', label: 'Logo', icon: 'logo' },
] as const;

/** Whether an item belongs under a media bin filter (a countdown is a video too). */
const inFilter = (m: MediaItem, filter: string) =>
  filter === 'all' ||
  filter === 'playlist' ||
  (filter === 'countdown'
    ? !!m.countdown
    : filter === 'outro'
      ? !!m.outro
      : filter === 'logo'
        ? !!m.logo
        : filter === 'background'
          ? !!m.background
          : m.kind === filter);

/** The media bin holds images and videos; audio lives in the Audio tab. */
const isVisual = (m: MediaItem) => m.kind !== 'audio';

/** Whether this browser (or the desktop app) can play a stored video; true if it can't tell in time. */
function canPlay(id: string): Promise<boolean> {
  return loadMedia(id).then(
    (media) =>
      new Promise<boolean>((resolve) => {
        if (!media) return resolve(false);
        const v = document.createElement('video');
        const done = (ok: boolean) => {
          clearTimeout(t);
          v.removeAttribute('src');
          v.load();
          resolve(ok);
        };
        const t = setTimeout(() => done(true), 8000);
        v.muted = true;
        v.preload = 'metadata';
        v.onloadedmetadata = () => done(v.videoWidth > 0 || v.duration > 0);
        v.onerror = () => done(false);
        v.src = media.url;
      }),
  );
}

/**
 * Imports images and videos (into a media playlist, if given), and says which files were left out
 * or can't be played here, e.g. an HEVC or ProRes video in a browser without that codec.
 */
export async function importMediaFiles(
  chosen: File[],
  playlistId?: string | null,
  options?: { background?: boolean; countdown?: boolean; outro?: boolean; logo?: boolean },
): Promise<MediaItem[]> {
  // iPhone photos (HEIC) become JPEGs first, so every screen can show them.
  let working: number | null = null;
  const { files, converted, failed } = await convertHeicPhotos(chosen, (count) => {
    working = notify(`Converting ${count === 1 ? 'a HEIC photo' : `${count} HEIC photos`} to JPEG…`, 'info', 0);
  });
  if (working !== null) dismiss(working);
  if (converted) notify(`${converted === 1 ? 'A HEIC photo was' : `${converted} HEIC photos were`} added as JPEG.`, 'success', 3500);
  for (const name of failed) notify(`“${name}” couldn’t be converted from HEIC: the photo may be damaged.`, 'error', 9000);
  // Imported in the Backgrounds, Countdowns, Outro or Logo tab, they go in that tab.
  const tab = useStore.getState().mediaFilter;
  const added = await useStore.getState().addMediaFiles(files, playlistId, {
    background: options?.background ?? tab === 'background',
    countdown: options?.countdown ?? tab === 'countdown',
    outro: options?.outro ?? tab === 'outro',
    logo: options?.logo ?? tab === 'logo',
  });
  const audio = added.filter((m) => m.kind === 'audio').length;
  if (audio) notify(`${audio === 1 ? 'The audio file went' : 'Audio files went'} to the Audio tab, in the live panel.`, 'info');
  const skipped = files.length - added.length;
  if (skipped)
    notify(
      `${skipped} file${skipped === 1 ? " isn't an image or video" : "s aren't images or videos"}, so ${skipped === 1 ? 'it was' : 'they were'} left out.`,
      'error',
    );
  for (const m of added.filter((x) => x.kind === 'video'))
    if (!(await canPlay(m.id)))
      notify(
        `“${m.name}” can’t be played on this computer: its video format isn’t supported here. An H.264 MP4 plays everywhere.`,
        'error',
        12000,
      );
  return added;
}

const importInto = (playlistId?: string | null, tab?: SpecialTab) =>
  pickFiles('image/*,video/*,.heic,.heif,.mp4,.m4v,.mov,.webm').then((files) =>
    importMediaFiles(files, playlistId, tab ? intoTab(tab) : undefined),
  );

const hasDrag = (e: DragEvent, type: string) => e.dataTransfer.types.includes(type);

function newMediaPlaylist(anchor: Element) {
  openPopupBelow(
    anchor,
    <NamePopup
      title="New Media Playlist"
      colors={false}
      action="Create"
      initial={{ name: 'Playlist', color: '' }}
      onSave={(v) => useStore.getState().createMediaPlaylist(v.name)}
    />,
  );
}

/** A media playlist in the sidebar: drop media or files on it to add them. */
function MediaPlaylistRow({ playlist }: { playlist: MediaPlaylist }) {
  const selected = useStore((s) => s.mediaFilter === 'playlist' && s.mediaPlaylistId === playlist.id);
  const s = useStore.getState();
  const [drop, setDrop] = useState(false);
  const rename = (anchor: Element) =>
    openPopupBelow(
      anchor,
      <NamePopup
        title="Rename Media Playlist"
        colors={false}
        initial={{ name: playlist.name, color: '' }}
        onSave={(v) => s.renameMediaPlaylist(playlist.id, v.name)}
      />,
    );
  return (
    <div
      className={`collection-row ${selected ? 'selected' : ''} ${drop ? 'drop' : ''}`}
      onClick={() => s.setUI({ mediaFilter: 'playlist', mediaPlaylistId: playlist.id })}
      onDoubleClick={(e) => rename(e.currentTarget)}
      onContextMenu={(e) => {
        const row = e.currentTarget;
        openContextMenu(e, [
          { label: 'Rename…', action: () => rename(row) },
          { label: 'Import Media…', action: () => void importInto(playlist.id) },
          '-',
          {
            label: 'Delete Playlist…',
            danger: true,
            action: () => deleteMediaPlaylist(playlist.id),
          },
        ]);
      }}
      onDragOver={(e) => {
        if (hasDrag(e, DRAG_MEDIA) || hasOutsideFiles(e)) {
          e.preventDefault();
          setDrop(true);
        }
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const ids = draggedIds(e, DRAG_MEDIA, DRAG_MEDIA_IDS);
        if (ids.length) s.addToMediaPlaylist(playlist.id, ids);
        else void importMediaFiles(Array.from(e.dataTransfer.files), playlist.id);
      }}
      title="Drop media here to add it. Double-click to rename."
    >
      <span className="collection-icon media">
        <Icon name="playlist" size={14} />
      </span>
      <span className="list-label">{playlist.name}</span>
      <span className="count">{playlist.items.length}</span>
    </div>
  );
}

export function MediaSidebar() {
  const filter = useStore((s) => s.mediaFilter);
  const media = useStore(useShallow((s) => s.media.filter(isVisual)));
  const playlists = useStore((s) => s.mediaPlaylists);
  const camera = useStore((s) => !!s.live.videoInput);
  const { setUI } = useStore.getState();
  // Each section folds away under its header, as the Library and Playlist ones do.
  const [mediaOpen, setMediaOpen] = useState(true);
  const [playlistsOpen, setPlaylistsOpen] = useState(true);
  const [inputsOpen, setInputsOpen] = useState(true);
  return (
    // Focusable, so a click in it lets the arrow keys move through its rows (mediaKeys).
    <aside className="media-sidebar" tabIndex={-1}>
      <SectionHeader
        title="Media"
        onAdd={() => void importInto()}
        addTitle="Import media"
        collapsed={!mediaOpen}
        onToggle={() => setMediaOpen(!mediaOpen)}
      />
      {mediaOpen &&
        FILTERS.map((f) => (
          <FilterRow
            key={f.value}
            filter={f}
            selected={filter === f.value}
            count={media.filter((m) => inFilter(m, f.value)).length}
            onSelect={() => setUI({ mediaFilter: f.value })}
          />
        ))}
      <SectionHeader title="Playlists" collapsed={!playlistsOpen} onToggle={() => setPlaylistsOpen(!playlistsOpen)}>
        <button
          type="button"
          className="icon-btn"
          title="New media playlist"
          aria-label="New media playlist"
          onClick={(e) => {
            setPlaylistsOpen(true);
            newMediaPlaylist(e.currentTarget);
          }}
        >
          <Icon name="plus" />
        </button>
      </SectionHeader>
      {playlistsOpen && playlists.map((pl) => <MediaPlaylistRow key={pl.id} playlist={pl} />)}
      <SectionHeader title="Video Inputs" collapsed={!inputsOpen} onToggle={() => setInputsOpen(!inputsOpen)} />
      {inputsOpen && (
        <div className={`collection-row ${filter === 'inputs' ? 'selected' : ''}`} onClick={() => setUI({ mediaFilter: 'inputs' })}>
          <span className="collection-icon media">
            <Icon name="video" size={14} />
          </span>
          <span className="list-label">Cameras & Capture</span>
          {camera && <span className="live-dot" title="Live" />}
        </div>
      )}
    </aside>
  );
}

/** The active outro's or logo's mark: a corner bookmark, like a felt one over a page's corner. */
function CornerBookmark({ icon, title, left }: { icon: 'outro' | 'logo'; title: string; left?: boolean }) {
  return (
    <span className={`corner-bookmark ${left ? 'left' : ''}`} title={title}>
      <span className="corner-bookmark-felt">
        <Icon name={icon} size={11} />
      </span>
    </span>
  );
}

const isTab = (v: string): v is SpecialTab => v in TAB_NAMES;

/**
 * The arrow keys in the media bin, once it's been clicked: in the sidebar, up and down move
 * through its rows (All Media, Images… the playlists, Cameras); in the grid, all four move to the
 * item beside, above or below the one on screen, showing it as clicking it would. False when
 * neither has the focus.
 */
export function mediaKeys(key: string): boolean {
  const active = document.activeElement;
  const side = active?.closest<HTMLElement>('.media-sidebar');
  if (side && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const rows = [...side.querySelectorAll<HTMLElement>('.collection-row')];
    const at = rows.findIndex((r) => r.classList.contains('selected'));
    const next = rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (key === 'ArrowDown' ? 1 : -1)))];
    if (next && next !== rows[at]) {
      next.click();
      next.scrollIntoView({ block: 'nearest' });
    }
    return true;
  }
  const grid = active?.closest<HTMLElement>('.media-grid');
  if (!grid || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return false;
  const tiles = [...grid.querySelectorAll<HTMLElement>('.media-tile')];
  if (!tiles.length) return true;
  const from = tiles.find((t) => t.classList.contains('live'));
  let target: HTMLElement | undefined;
  if (!from) target = tiles[0];
  else if (key === 'ArrowLeft' || key === 'ArrowRight') target = tiles[tiles.indexOf(from) + (key === 'ArrowRight' ? 1 : -1)];
  else {
    // The nearest row in that direction, then the item in it nearest straight above or below.
    const r = from.getBoundingClientRect();
    const middle = r.left + r.width / 2;
    const down = key === 'ArrowDown';
    const ahead = tiles
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r: o }) => (down ? o.top >= r.bottom - 4 : o.bottom <= r.top + 4));
    if (ahead.length) {
      const rowTop = down ? Math.min(...ahead.map((a) => a.r.top)) : Math.max(...ahead.map((a) => a.r.top));
      target = ahead
        .filter((a) => Math.abs(a.r.top - rowTop) < 4)
        .reduce((best, a) =>
          Math.abs(a.r.left + a.r.width / 2 - middle) < Math.abs(best.r.left + best.r.width / 2 - middle) ? a : best,
        ).el;
    }
  }
  if (target && target !== from) {
    target.click();
    target.scrollIntoView({ block: 'nearest' });
  }
  return true;
}

/** Imported straight into one of the media bin's own tabs (and no other). */
const intoTab = (tab: SpecialTab) => ({
  background: tab === 'background',
  countdown: tab === 'countdown',
  outro: tab === 'outro',
  logo: tab === 'logo',
});

/**
 * A row under Media: All Media, Images, Videos, or one of the bin's own tabs. Media dragged onto
 * one of those tabs (or files dropped there) goes in it; right-click it to add items by hand.
 */
function FilterRow({
  filter: f,
  selected,
  count,
  onSelect,
}: {
  filter: (typeof FILTERS)[number];
  selected: boolean;
  count: number;
  onSelect: () => void;
}) {
  const tab = isTab(f.value) ? f.value : null;
  const [drop, setDrop] = useState(false);
  const s = useStore.getState();
  return (
    <div
      className={`collection-row ${selected ? 'selected' : ''} ${drop ? 'drop' : ''}`}
      onClick={onSelect}
      onDragOver={(e) => {
        if (!tab || !(hasDrag(e, DRAG_MEDIA) || hasOutsideFiles(e))) return;
        e.preventDefault();
        setDrop(true);
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        if (!tab) return;
        e.preventDefault();
        setDrop(false);
        const ids = draggedIds(e, DRAG_MEDIA, DRAG_MEDIA_IDS);
        if (ids.length) {
          const items = ids.map((id) => s.media.find((x) => x.id === id)).filter((m): m is MediaItem => !!m);
          const fitting = items.filter((m) => fitsTab(m, tab));
          if (!fitting.length) return void notify(`${TAB_NAMES[tab]} takes videos only.`, 'info');
          // Only the ones not in it already are added.
          s.setInTab(
            tab,
            fitting.filter((m) => !m[tab]).map((m) => m.id),
            true,
          );
        } else void importMediaFiles(Array.from(e.dataTransfer.files), null, intoTab(tab));
      }}
      onContextMenu={(e) => {
        if (!tab) return;
        const row = e.currentTarget;
        openContextMenu(e, [
          { label: 'Add from Media Bin…', action: () => openTabPicker(row, tab) },
          { label: 'Import into ' + TAB_NAMES[tab] + '…', action: () => void importInto(null, tab) },
        ]);
      }}
      title={tab ? `Drag media here to add it to ${TAB_NAMES[tab]} · Right-click to add from the media bin` : undefined}
    >
      <span className={`collection-icon ${tab ? 'special' : 'media'}`}>
        <Icon name={f.icon} size={14} />
      </span>
      <span className="list-label">{f.label}</span>
      <span className="count">{count}</span>
    </div>
  );
}

/** Adding items already in the media bin to one of its tabs: click one to add it. */
function TabPicker({ tab }: { tab: SpecialTab }) {
  const media = useStore((s) => s.media);
  const [query, setQuery] = useState('');
  const s = useStore.getState();
  const q = query.trim().toLowerCase();
  const choices = media.filter((m) => fitsTab(m, tab) && !m[tab] && (!q || m.name.toLowerCase().includes(q)));
  const kinds = tab === 'countdown' || tab === 'outro' ? 'videos' : 'images and videos';
  return (
    <div className="tab-picker">
      <div className="tab-picker-head">Add to {TAB_NAMES[tab]}</div>
      <FilterField value={query} onChange={setQuery} placeholder="Search media" />
      <ul className="tab-picker-list">
        {choices.map((m) => (
          <TabPickerRow key={m.id} item={m} onAdd={() => s.setInTab(tab, [m.id], true)} />
        ))}
        {choices.length === 0 && (
          <li className="empty">{q ? 'No media matches.' : `All your ${kinds} are in ${TAB_NAMES[tab]} already.`}</li>
        )}
      </ul>
      <p className="muted small-print">Click one to add it. Or drag media onto {TAB_NAMES[tab]} in the sidebar.</p>
    </div>
  );
}

function TabPickerRow({ item, onAdd }: { item: MediaItem; onAdd: () => void }) {
  const media = useMedia(item.id);
  return (
    <li>
      <button type="button" className="tab-picker-row" onClick={onAdd} title={`Add “${item.name}”`}>
        <span className="tab-picker-thumb">
          {media && (media.isVideo ? <video src={`${media.url}#t=0.5`} muted preload="metadata" /> : <img src={media.url} alt="" />)}
        </span>
        <span className="list-label">{item.name}</span>
        <Icon name="plus" size={14} />
      </button>
    </li>
  );
}

const openTabPicker = (anchor: Element, tab: SpecialTab) => openPopupBelow(anchor, <TabPicker tab={tab} />);

const length = (seconds: number) => formatDuration(Math.round(seconds) * 1000);

/**
 * A media bin item: a still of it, its name, and for a video its length. Drag it onto a slide or a
 * media playlist, or onto another item to put it there (before or after it, by which half).
 */
function MediaTile({
  item,
  live,
  logo,
  outro,
  playlistId,
  tab,
  next,
  selected,
  order,
  gapLine,
}: {
  item: MediaItem;
  live: boolean;
  /** Media dragged into the open space beside this item would land on this side of it. */
  gapLine?: 'before' | 'after' | null;
  /** Highlighted (click, ⌘-click or ⇧-click). */
  selected: boolean;
  /** The items as shown, for ⇧-click ranges and acting on the highlight. */
  order: string[];
  logo: boolean;
  /** Shown in the Countdowns or Outro tab: removing it there only takes it out of the tab. */
  tab: SpecialTab | null;
  /** The active outro: a bookmark on its corner. */
  outro: boolean;
  playlistId: string | null;
  /** The item after this one, for dropping after it. */
  next: string | null;
}) {
  const media = useMedia(item.id);
  const missing = useIsMissing(item.id);
  const [duration, setDuration] = useState(0);
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const s = useStore.getState();
  const side = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };
  return (
    <div
      data-media-id={item.id}
      className={`media-tile ${live ? 'live' : ''} ${selected ? 'selected' : ''} ${missing ? 'missing' : ''} ${(drop ?? gapLine) ? `drop-${drop ?? gapLine}` : ''}`}
      draggable
      onDragStart={(e) => {
        // A highlighted item takes the rest of the highlight with it.
        const ids = actedOn(useMediaSelection.getState(), order, item.id);
        e.dataTransfer.setData(DRAG_MEDIA, item.id);
        e.dataTransfer.setData(DRAG_MEDIA_IDS, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'copyMove';
        setDragPreview(e, e.currentTarget, ids.length);
      }}
      onDragOver={(e) => {
        if (!hasDrag(e, DRAG_MEDIA)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDrop(side(e));
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const ids = draggedIds(e, DRAG_MEDIA, DRAG_MEDIA_IDS);
        setDrop(null);
        if (!ids.length) return;
        e.preventDefault();
        e.stopPropagation();
        const before = side(e) === 'before' ? item.id : next;
        if (ids.includes(item.id) || (before && ids.includes(before))) return;
        const pl = playlistId ? s.mediaPlaylists.find((x) => x.id === playlistId) : undefined;
        if (!pl) return s.moveMedia(ids, before);
        // Into a playlist from elsewhere, they join the playlist there.
        s.addToMediaPlaylist(pl.id, ids);
        s.moveInMediaPlaylist(pl.id, ids, before);
      }}
      onClick={(e) => {
        const sel = useMediaSelection.getState();
        useMediaSelection.setState(clickSelection(sel, order, item.id, e));
        // ⌘- and ⇧-clicks only highlight; a plain click shows it, as before (or, with its file
        // missing, offers to reconnect it).
        if (isExtending(e)) return;
        if (missing) offerReconnect(e, item);
        else s.setLiveMedia(live ? null : item.id, playlistId);
      }}
      onContextMenu={(e) => {
        const sel = useMediaSelection.getState();
        if (!sel.ids.includes(item.id)) useMediaSelection.setState({ ids: [item.id], anchor: item.id });
        const ids = actedOn(useMediaSelection.getState(), order, item.id);
        const items = ids.map((id) => s.media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m);
        openContextMenu(e, items.length > 1 ? mediaSelectionMenu(items, playlistId, tab) : mediaMenu(item, playlistId, tab));
      }}
      // Its full name, which the tile may cut short.
      title={item.name}
    >
      <div className="media-tile-frame">
        {outro && <CornerBookmark icon="outro" title="The active outro: Play Outro plays it" />}
        {logo && <CornerBookmark icon="logo" title="The active logo: the Logo button shows it" left={outro} />}
        {missing ? (
          <div className="media-thumb-img media-missing" title="Its file is missing: click to reconnect it">
            <Icon name="link" size={20} />
            <span>File missing</span>
          </div>
        ) : !media ? (
          <div className="media-thumb-img" />
        ) : media.isVideo ? (
          <video
            className="media-thumb-img"
            src={`${media.url}#t=0.5`}
            muted
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
        ) : (
          <img className="media-thumb-img" src={media.url} alt="" />
        )}
        {item.kind === 'video' && (
          <span className="media-kind">
            {item.playback && item.playback !== 'loop' ? '' : '⟳ '}
            {duration ? length(duration) : 'VIDEO'}
          </span>
        )}
      </div>
      <div className="media-tile-footer">
        <span className="list-label">{item.name}</span>
        <span className="row-actions">
          <IconButton
            icon="logo"
            title={logo ? 'The active logo: click to have none' : 'Make this the active logo'}
            active={logo}
            onClick={() => s.setActiveMedia('logo', logo ? null : item.id)}
          />
          {tab ? (
            <IconButton
              icon="trash"
              title={`Remove from ${TAB_NAMES[tab]} (it stays in All Media)`}
              danger
              onClick={() => removeFromTab(item, tab)}
            />
          ) : (
            <IconButton icon="trash" title="Delete" danger onClick={() => deleteMedia(item.id)} />
          )}
        </span>
      </div>
    </div>
  );
}

export function MediaContent() {
  const filter = useStore((s) => s.mediaFilter);
  if (filter === 'inputs') return <VideoInputs />;
  return <MediaGrid />;
}

function MediaGrid() {
  const filter = useStore((s) => s.mediaFilter);
  const playlist = useStore((s) => (s.mediaFilter === 'playlist' ? s.mediaPlaylists.find((pl) => pl.id === s.mediaPlaylistId) : undefined));
  const all = useStore((s) => s.media);
  const media = useMemo(() => all.filter(isVisual), [all]);
  const liveMedia = useStore((s) => s.live.mediaId);
  const logoId = useStore((s) => s.settings.logoMediaId);
  const outroId = useStore((s) => s.settings.outroMediaId);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(160);
  const [dropping, setDropping] = useState(false);
  const playlistId = playlist?.id ?? null;
  const selection = useMediaSelection((s) => s.ids);
  // Dragging a box over the open space highlights the items it touches.
  const marquee = useMarqueeSelect({
    items: '.media-tile',
    idOf: (el) => el.dataset.mediaId!,
    selected: () => useMediaSelection.getState().ids,
    select: (ids) => useMediaSelection.setState((s) => ({ ids, anchor: ids.includes(s.anchor ?? '') ? s.anchor : (ids.at(-1) ?? null) })),
  });
  // Media dragged into the open space of the grid (between items, or after the last) goes to the nearest gap.
  const [gap, setGap] = useState<{ id: string; after: boolean } | null>(null);
  const gapAt = (e: DragEvent) => {
    if (!hasDrag(e, DRAG_MEDIA) || (e.target as Element).closest('.media-tile')) return null;
    const found = nearestGap(e.currentTarget as HTMLElement, '.media-tile', e.clientX, e.clientY);
    return found ? { id: found.el.dataset.mediaId!, after: found.after } : null;
  };

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = playlist
      ? playlist.items.map((id) => media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m)
      : media.filter((m) => inFilter(m, filter));
    return shown.filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [media, filter, playlist, query]);
  const order = useMemo(() => items.map((m) => m.id), [items]);
  const empty = playlist
    ? playlist.items.length === 0
    : media.length === 0 ||
      ((filter === 'background' || filter === 'countdown' || filter === 'outro' || filter === 'logo') && items.length === 0 && !query);

  return (
    <section
      className={`media-content ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (hasOutsideFiles(e) || (playlist && hasDrag(e, DRAG_MEDIA))) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const ids = draggedIds(e, DRAG_MEDIA, DRAG_MEDIA_IDS);
        if (ids.length && playlist) useStore.getState().addToMediaPlaylist(playlist.id, ids);
        else if (e.dataTransfer.files.length) void importMediaFiles(Array.from(e.dataTransfer.files), playlistId);
      }}
    >
      <div className="crumbs">
        <Icon name="chevronLeft" size={14} />
        <Icon name="chevronRight" size={14} />
        <span className="crumb">
          <Icon name={playlist ? 'playlist' : 'image'} size={13} /> {playlist ? 'Playlists' : 'Media'}
        </span>
        <span className="crumb-sep">›</span>
        <span className="crumb">{playlist?.name ?? FILTERS.find((f) => f.value === filter)?.label}</span>
        <span className="pane-footer-spacer" />
        {!playlist && isTab(filter) && (
          <button type="button" className="btn small tab-add" onClick={(e) => openTabPicker(e.currentTarget, filter)}>
            <Icon name="plus" size={12} /> Add from Media Bin
          </button>
        )}
        <TransitionButton target="media" className="media-transition" prefix="Media" />
      </div>
      {empty ? (
        <div className="import-empty">
          <button className="import-tile" onClick={() => void importInto(playlistId, !playlist && isTab(filter) ? filter : undefined)}>
            <Icon name="download" size={40} />
          </button>
          <span>
            {filter === 'background'
              ? 'Import Backgrounds'
              : filter === 'countdown'
                ? 'Import Countdowns'
                : filter === 'outro'
                  ? 'Import Outros'
                  : filter === 'logo'
                    ? 'Import Logos'
                    : 'Import Media'}
          </span>
          <span className="muted small-print">
            {filter === 'background'
              ? 'Backgrounds for slides: images and videos to show behind the words. Ones named “background” come here by themselves; or add them from the media bin, drag them onto Backgrounds in the sidebar, or right-click ▸ Tabs.'
              : filter === 'countdown'
                ? 'Countdown videos for before the service. Videos named “countdown” come here by themselves; or add them from the media bin, drag them onto Countdowns in the sidebar, or right-click ▸ Tabs. As a countdown ends, music on the Audio layer fades out with it.'
                : filter === 'outro'
                  ? 'Videos for the end of the service. Videos named “outro” come here by themselves; or add them from the media bin, drag them onto Outro in the sidebar, or right-click ▸ Tabs. The active outro (marked with a bookmark) plays from the Play Outro button beside the clear buttons.'
                  : filter === 'logo'
                    ? 'Logos: images or videos that cover the audience screen. Ones named “logo” come here by themselves; or add them from the media bin, drag them onto Logo in the sidebar, or right-click ▸ Tabs. The active logo (marked with a bookmark) shows from the Logo button beside the clear buttons.'
                    : 'Images (iPhone HEIC photos become JPEG) and videos (MP4, MOV, WebM). Or drop them here.'}
          </span>
          {!playlist && isTab(filter) && media.length > 0 && (
            <button type="button" className="btn" onClick={(e) => openTabPicker(e.currentTarget, filter)}>
              <Icon name="plus" size={13} /> Add from Media Bin
            </button>
          )}
        </div>
      ) : (
        <div
          ref={marquee.ref}
          className="media-grid"
          tabIndex={-1}
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
          // A click between the items takes the highlight away; a drag there draws a box to highlight them.
          onPointerDown={marquee.onPointerDown}
          onDragOver={(e) => {
            const at = gapAt(e);
            if (at) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
            }
            if (at?.id !== gap?.id || at?.after !== gap?.after) setGap(at);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setGap(null)}
          onDrop={(e) => {
            const at = gapAt(e);
            setGap(null);
            if (!at) return;
            e.preventDefault();
            e.stopPropagation();
            const ids = draggedIds(e, DRAG_MEDIA, DRAG_MEDIA_IDS);
            // Before the item after the gap that isn't one of those moving (or at the end).
            const from = order.indexOf(at.id) + (at.after ? 1 : 0);
            const before = order.slice(from).find((id) => !ids.includes(id)) ?? null;
            const s = useStore.getState();
            if (!playlist) return s.moveMedia(ids, before);
            s.addToMediaPlaylist(playlist.id, ids);
            s.moveInMediaPlaylist(playlist.id, ids, before);
          }}
        >
          {marquee.marquee}
          {items.map((m, i) => (
            <MediaTile
              key={m.id}
              item={m}
              live={liveMedia === m.id}
              logo={logoId === m.id}
              outro={outroId === m.id}
              playlistId={playlistId}
              tab={
                !playlist && (filter === 'background' || filter === 'countdown' || filter === 'outro' || filter === 'logo') ? filter : null
              }
              next={items[i + 1]?.id ?? null}
              selected={selection.includes(m.id)}
              order={order}
              gapLine={gap?.id === m.id ? (gap.after ? 'after' : 'before') : null}
            />
          ))}
          {items.length === 0 && <p className="muted">No media matches.</p>}
        </div>
      )}
      <div className="pane-footer">
        <IconButton icon="plus" title="Import media" onClick={() => void importInto(playlistId)} />
        <span className="pane-footer-spacer" />
        <FilterField value={query} onChange={setQuery} />
        <span className="pane-footer-spacer" />
        <input
          type="range"
          className="pink-range"
          min={110}
          max={300}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          aria-label="Thumbnail size"
        />
      </div>
    </section>
  );
}

/**
 * Cameras and capture cards for the Video Input layer. Asking for one the first time lets the
 * browser (or the computer) ask permission, after which their names are known.
 */
function VideoInputs() {
  const live = useStore((s) => s.live.videoInput);
  const s = useStore.getState();
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = !!navigator.mediaDevices?.getUserMedia;

  const find = async (ask: boolean) => {
    try {
      if (ask) {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach((t) => t.stop());
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput' && d.deviceId));
      setError(null);
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Camera access was turned down.' : 'No camera could be opened.');
      setDevices([]);
    }
  };

  useEffect(() => {
    if (!supported) return;
    // Names and ids show without asking once permission was given before.
    void find(false);
    const onChange = () => void find(false);
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [supported]);

  return (
    <section className="media-content">
      <div className="crumbs">
        <span className="crumb">
          <Icon name="video" size={13} /> Video Inputs
        </span>
        <span className="pane-footer-spacer" />
        <TransitionButton target="media" className="media-transition" prefix="Media" />
      </div>
      {!supported ? (
        <p className="muted inputs-note">This window can’t use cameras. Open Lumen from localhost, over HTTPS, or in the desktop app.</p>
      ) : (
        <div className="media-grid inputs-grid">
          {(devices ?? []).map((d, i) => {
            const label = d.label || `Camera ${i + 1}`;
            const on = live?.deviceId === d.deviceId;
            return (
              <div
                key={d.deviceId}
                className={`media-tile ${on ? 'live' : ''}`}
                onClick={() => s.setVideoInput(on ? null : { deviceId: d.deviceId, label })}
                title="Click to show under everything else, click again to clear"
              >
                <div className="media-tile-frame">
                  <CameraFill deviceId={d.deviceId} />
                  <span className="media-kind">LIVE</span>
                </div>
                <div className="media-tile-footer">
                  <span className="list-label">{label}</span>
                </div>
              </div>
            );
          })}
          <div className="inputs-find">
            <button className="btn" onClick={() => void find(true)}>
              {devices?.length ? 'Look Again' : 'Find Cameras'}
            </button>
            <p className="muted small-print">
              {error ??
                (devices?.length === 0
                  ? 'No cameras or capture cards found yet.'
                  : 'Webcams, capture cards and virtual cameras (OBS, NDI) appear here.')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
