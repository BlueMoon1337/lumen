import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMedia } from '../media';
import { useStore } from '../store';
import { notify } from '../notices';
import type { MediaItem } from '../types';
import { openContextMenu } from './ContextMenu';
import { mediaMenu } from './menus';
import { CameraFill } from './Canvas';
import { TransitionButton } from './TransitionPicker';
import { FilterField, Icon, IconButton, pickFiles, SectionHeader } from './ui';

const FILTERS = [
  { value: 'all', label: 'All Media', icon: 'image' },
  { value: 'image', label: 'Images', icon: 'image' },
  { value: 'video', label: 'Videos', icon: 'video' },
] as const;

const importMedia = () => pickFiles('image/*,video/*').then((files) => useStore.getState().addMediaFiles(files));

/** The media bin holds images and videos; audio lives in the Audio tab. */
const isVisual = (m: MediaItem) => m.kind !== 'audio';

export function MediaSidebar() {
  const filter = useStore((s) => s.mediaFilter);
  const media = useStore(useShallow((s) => s.media.filter(isVisual)));
  const camera = useStore((s) => !!s.live.videoInput);
  const { setUI } = useStore.getState();
  return (
    <aside className="media-sidebar">
      <SectionHeader title="Media" onAdd={importMedia} addTitle="Import media" />
      {FILTERS.map((f) => (
        <div
          key={f.value}
          className={`collection-row ${filter === f.value ? 'selected' : ''}`}
          onClick={() => setUI({ mediaFilter: f.value })}
        >
          <span className="collection-icon media">
            <Icon name={f.icon} size={14} />
          </span>
          <span className="list-label">{f.label}</span>
          <span className="count">{f.value === 'all' ? media.length : media.filter((m) => m.kind === f.value).length}</span>
        </div>
      ))}
      <SectionHeader title="Video Inputs" />
      <div className={`collection-row ${filter === 'inputs' ? 'selected' : ''}`} onClick={() => setUI({ mediaFilter: 'inputs' })}>
        <span className="collection-icon media">
          <Icon name="video" size={14} />
        </span>
        <span className="list-label">Cameras & Capture</span>
        {camera && <span className="live-dot" title="Live" />}
      </div>
    </aside>
  );
}

function MediaThumb({ item }: { item: MediaItem }) {
  const media = useMedia(item.id);
  if (!media) return <div className="media-thumb-img" />;
  return media.isVideo ? (
    <video className="media-thumb-img" src={`${media.url}#t=0.5`} muted preload="metadata" />
  ) : (
    <img className="media-thumb-img" src={media.url} alt="" />
  );
}

export function MediaContent() {
  const filter = useStore((s) => s.mediaFilter);
  if (filter === 'inputs') return <VideoInputs />;
  return <MediaGrid />;
}

function MediaGrid() {
  const filter = useStore((s) => s.mediaFilter);
  const all = useStore((s) => s.media);
  const media = useMemo(() => all.filter(isVisual), [all]);
  const liveMedia = useStore((s) => s.live.mediaId);
  const logoId = useStore((s) => s.settings.logoMediaId);
  const s = useStore.getState();
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(160);
  const [dropping, setDropping] = useState(false);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter((m) => (filter === 'all' || m.kind === filter) && (!q || m.name.toLowerCase().includes(q)));
  }, [media, filter, query]);

  return (
    <section
      className={`media-content ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const files = Array.from(e.dataTransfer.files);
        void s.addMediaFiles(files);
        if (files.some((f) => f.type.startsWith('audio/'))) notify('Audio files went to the Audio tab, in the live panel.', 'info');
      }}
    >
      <div className="crumbs">
        <Icon name="chevronLeft" size={14} />
        <Icon name="chevronRight" size={14} />
        <span className="crumb">
          <Icon name="image" size={13} /> Media
        </span>
        <span className="crumb-sep">›</span>
        <span className="crumb">{FILTERS.find((f) => f.value === filter)?.label}</span>
        <span className="pane-footer-spacer" />
        <TransitionButton target="media" className="media-transition" prefix="Media" />
      </div>
      {media.length === 0 ? (
        <div className="import-empty">
          <button className="import-tile" onClick={importMedia}>
            <Icon name="download" size={40} />
          </button>
          <span>Import Media</span>
        </div>
      ) : (
        <div className="media-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
          {items.map((m) => (
            <div
              key={m.id}
              className={`media-tile ${liveMedia === m.id ? 'live' : ''}`}
              onClick={() => s.setLiveMedia(liveMedia === m.id ? null : m.id)}
              onContextMenu={(e) => openContextMenu(e, mediaMenu(m))}
              title="Click to show behind your slides, click again to clear"
            >
              <div className="media-tile-frame">
                <MediaThumb item={m} />
                {m.kind === 'video' && <span className="media-kind">VIDEO</span>}
              </div>
              <div className="media-tile-footer">
                <span className="list-label">{m.name}</span>
                {logoId === m.id && <span className="badge">Logo</span>}
                <span className="row-actions">
                  <IconButton
                    icon="layers"
                    title={logoId === m.id ? 'Stop using as logo' : 'Use as logo'}
                    active={logoId === m.id}
                    onClick={() => s.updateSettings({ logoMediaId: logoId === m.id ? undefined : m.id })}
                  />
                  <IconButton icon="trash" title="Delete" danger onClick={() => confirm(`Delete "${m.name}"?`) && s.deleteMedia(m.id)} />
                </span>
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="muted">No media matches.</p>}
        </div>
      )}
      <div className="pane-footer">
        <IconButton icon="plus" title="Import media" onClick={importMedia} />
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
