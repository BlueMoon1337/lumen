import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { loadMedia, useMedia } from '../media';
import { convertHeicPhotos } from '../heic';
import { dismiss, notify } from '../notices';
import { useStore } from '../store';
import type { MediaItem, MediaPlaylist } from '../types';
import { formatDuration } from '../util';
import { CameraFill } from './Canvas';
import { NamePopup, openContextMenu, openPopupBelow } from './ContextMenu';
import { deleteMedia, deleteMediaPlaylist } from './deleting';
import { mediaMenu } from './menus';
import { TransitionButton } from './TransitionPicker';
import { DRAG_MEDIA, FilterField, Icon, IconButton, pickFiles, SectionHeader } from './ui';

const FILTERS = [
  { value: 'all', label: 'All Media', icon: 'image' },
  { value: 'image', label: 'Images', icon: 'image' },
  { value: 'video', label: 'Videos', icon: 'video' },
  { value: 'countdown', label: 'Countdowns', icon: 'clock' },
] as const;

/** Whether an item belongs under a media bin filter (a countdown is a video too). */
const inFilter = (m: MediaItem, filter: string) =>
  filter === 'all' || filter === 'playlist' || (filter === 'countdown' ? !!m.countdown : m.kind === filter);

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
  options?: { countdown?: boolean },
): Promise<MediaItem[]> {
  // iPhone photos (HEIC) become JPEGs first, so every screen can show them.
  let working: number | null = null;
  const { files, converted, failed } = await convertHeicPhotos(chosen, (count) => {
    working = notify(`Converting ${count === 1 ? 'a HEIC photo' : `${count} HEIC photos`} to JPEG…`, 'info', 0);
  });
  if (working !== null) dismiss(working);
  if (converted) notify(`${converted === 1 ? 'A HEIC photo was' : `${converted} HEIC photos were`} added as JPEG.`, 'success', 3500);
  for (const name of failed) notify(`“${name}” couldn’t be converted from HEIC: the photo may be damaged.`, 'error', 9000);
  // Imported in the Countdowns tab, videos are countdowns.
  const countdown = options?.countdown ?? useStore.getState().mediaFilter === 'countdown';
  const added = await useStore.getState().addMediaFiles(files, playlistId, { countdown });
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

const importInto = (playlistId?: string | null) =>
  pickFiles('image/*,video/*,.heic,.heif,.mp4,.m4v,.mov,.webm').then((files) => importMediaFiles(files, playlistId));

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
        if (hasDrag(e, DRAG_MEDIA) || hasDrag(e, 'Files')) {
          e.preventDefault();
          setDrop(true);
        }
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const id = e.dataTransfer.getData(DRAG_MEDIA);
        if (id) s.addToMediaPlaylist(playlist.id, [id]);
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
    <aside className="media-sidebar">
      <SectionHeader
        title="Media"
        onAdd={() => void importInto()}
        addTitle="Import media"
        collapsed={!mediaOpen}
        onToggle={() => setMediaOpen(!mediaOpen)}
      />
      {mediaOpen &&
        FILTERS.map((f) => (
          <div
            key={f.value}
            className={`collection-row ${filter === f.value ? 'selected' : ''}`}
            onClick={() => setUI({ mediaFilter: f.value })}
          >
            <span className="collection-icon media">
              <Icon name={f.icon} size={14} />
            </span>
            <span className="list-label">{f.label}</span>
            <span className="count">{media.filter((m) => inFilter(m, f.value)).length}</span>
          </div>
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

const length = (seconds: number) => formatDuration(Math.round(seconds) * 1000);

/**
 * A media bin item: a still of it, its name, and for a video its length. Drag it onto a slide or a
 * media playlist, or onto another item to put it there (before or after it, by which half).
 */
function MediaTile({
  item,
  live,
  logo,
  playlistId,
  next,
}: {
  item: MediaItem;
  live: boolean;
  logo: boolean;
  playlistId: string | null;
  /** The item after this one, for dropping after it. */
  next: string | null;
}) {
  const media = useMedia(item.id);
  const [duration, setDuration] = useState(0);
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const s = useStore.getState();
  const side = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
  };
  return (
    <div
      className={`media-tile ${live ? 'live' : ''} ${drop ? `drop-${drop}` : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MEDIA, item.id);
        e.dataTransfer.effectAllowed = 'copyMove';
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
        const id = e.dataTransfer.getData(DRAG_MEDIA);
        setDrop(null);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        const before = side(e) === 'before' ? item.id : next;
        if (id === item.id || id === before) return;
        const pl = playlistId ? s.mediaPlaylists.find((x) => x.id === playlistId) : undefined;
        if (!pl) return s.moveMedia([id], before);
        // Into a playlist from elsewhere, it joins the playlist there.
        if (!pl.items.includes(id)) s.addToMediaPlaylist(pl.id, [id]);
        s.moveInMediaPlaylist(pl.id, [id], before);
      }}
      onClick={() => s.setLiveMedia(live ? null : item.id, playlistId)}
      onContextMenu={(e) => openContextMenu(e, mediaMenu(item, playlistId))}
      title="Click to show on the Media layer, click again to clear. Drag onto a slide to play it with that slide, or between items to reorder."
    >
      <div className="media-tile-frame">
        {!media ? (
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
        {logo && <span className="badge">Logo</span>}
        <span className="row-actions">
          <IconButton
            icon="layers"
            title={logo ? 'Stop using as logo' : 'Use as logo'}
            active={logo}
            onClick={() => s.updateSettings({ logoMediaId: logo ? undefined : item.id })}
          />
          <IconButton icon="trash" title="Delete" danger onClick={() => deleteMedia(item.id)} />
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
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(160);
  const [dropping, setDropping] = useState(false);
  const playlistId = playlist?.id ?? null;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = playlist
      ? playlist.items.map((id) => media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m)
      : media.filter((m) => inFilter(m, filter));
    return shown.filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [media, filter, playlist, query]);
  const empty = playlist ? playlist.items.length === 0 : media.length === 0 || (filter === 'countdown' && items.length === 0 && !query);

  return (
    <section
      className={`media-content ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (hasDrag(e, 'Files') || (playlist && hasDrag(e, DRAG_MEDIA))) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const id = e.dataTransfer.getData(DRAG_MEDIA);
        if (id && playlist) useStore.getState().addToMediaPlaylist(playlist.id, [id]);
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
        <TransitionButton target="media" className="media-transition" prefix="Media" />
      </div>
      {empty ? (
        <div className="import-empty">
          <button className="import-tile" onClick={() => void importInto(playlistId)}>
            <Icon name="download" size={40} />
          </button>
          <span>{filter === 'countdown' ? 'Import Countdowns' : 'Import Media'}</span>
          <span className="muted small-print">
            {filter === 'countdown'
              ? 'Countdown videos for before the service. Videos named “countdown” come here by themselves; right-click any video to make it one. As a countdown ends, music on the Audio layer fades out with it.'
              : 'Images (iPhone HEIC photos become JPEG) and videos (MP4, MOV, WebM). Or drop them here.'}
          </span>
        </div>
      ) : (
        <div className="media-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
          {items.map((m, i) => (
            <MediaTile
              key={m.id}
              item={m}
              live={liveMedia === m.id}
              logo={logoId === m.id}
              playlistId={playlistId}
              next={items[i + 1]?.id ?? null}
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
