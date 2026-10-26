import { useMemo, useState } from 'react';
import { useMedia } from '../media';
import { useStore } from '../store';
import type { MediaItem } from '../types';
import { openContextMenu } from './ContextMenu';
import { mediaMenu } from './menus';
import { FilterField, Icon, IconButton, pickFiles, SectionHeader } from './ui';

const FILTERS = [
  { value: 'all', label: 'All Media', icon: 'image' },
  { value: 'image', label: 'Images', icon: 'image' },
  { value: 'video', label: 'Videos', icon: 'video' },
] as const;

const importMedia = () => pickFiles('image/*,video/*').then((files) => useStore.getState().addMediaFiles(files));

export function MediaSidebar() {
  const filter = useStore((s) => s.mediaFilter);
  const media = useStore((s) => s.media);
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
  const media = useStore((s) => s.media);
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
        void s.addMediaFiles(Array.from(e.dataTransfer.files));
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
