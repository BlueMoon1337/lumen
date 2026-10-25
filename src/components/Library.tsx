import { useMemo, useState, type DragEvent } from 'react';
import { activePlaylist, useStore } from '../store';
import type { Category } from '../types';
import { DRAG_PLAYLIST_ITEM, DRAG_PRESENTATION, Icon, IconButton, pickFiles } from './ui';

const CATEGORY_LABELS: Record<Category | 'all', string> = {
  all: 'All',
  song: 'Songs',
  scripture: 'Scripture',
  announcement: 'Announcements',
  other: 'Other',
};

/** Imports plain-text lyric files, one presentation per file. */
export async function importTextFiles(files: File[]) {
  const { createPresentation, select } = useStore.getState();
  let last: string | null = null;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.txt') && file.type !== 'text/plain') continue;
    last = createPresentation({ title: file.name.replace(/\.[^.]+$/, '') }, await file.text());
  }
  if (last) select(last);
}

export function LibraryPanel() {
  const presentations = useStore((s) => s.presentations);
  const selectedId = useStore((s) => s.selectedPresentationId);
  const selectedItem = useStore((s) => s.selectedPlaylistItemId);
  const liveId = useStore((s) => s.live.slide?.presentationId);
  const { select, addToPlaylist, duplicatePresentation, deletePresentation } = useStore.getState();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [dropping, setDropping] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(presentations)
      .filter((p) => category === 'all' || p.category === category)
      .filter(
        (p) => !q || p.title.toLowerCase().includes(q) || p.groups.some((g) => g.slides.some((s) => s.text.toLowerCase().includes(q))),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [presentations, query, category]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    void importTextFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className={`panel library ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <header className="panel-header">
        <h3>Library</h3>
        <div className="panel-actions">
          <IconButton icon="upload" title="Import lyrics (.txt)" onClick={() => pickFiles('.txt,text/plain').then(importTextFiles)} />
        </div>
      </header>
      <div className="library-filters">
        <label className="search">
          <Icon name="search" size={14} />
          <input placeholder="Search titles and lyrics" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category | 'all')} aria-label="Category">
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <ul className="list">
        {list.map((p) => (
          <li
            key={p.id}
            className={`list-item ${selectedId === p.id && !selectedItem ? 'selected' : ''}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_PRESENTATION, p.id)}
            onClick={() => select(p.id)}
            onDoubleClick={() => addToPlaylist(p.id)}
            title="Double-click to add to the playlist"
          >
            <Icon name={p.category === 'scripture' ? 'book' : p.category === 'song' ? 'music' : 'list'} size={14} />
            <span className="list-label">{p.title}</span>
            {liveId === p.id && <span className="live-dot" title="Live" />}
            <span className="row-actions">
              <IconButton icon="plus" title="Add to playlist" onClick={() => addToPlaylist(p.id)} />
              <IconButton icon="copy" title="Duplicate" onClick={() => duplicatePresentation(p.id)} />
              <IconButton
                icon="trash"
                title="Delete"
                danger
                onClick={() => confirm(`Delete "${p.title}"? This cannot be undone.`) && deletePresentation(p.id)}
              />
            </span>
          </li>
        ))}
        {list.length === 0 && <li className="empty">No presentations match.</li>}
      </ul>
    </section>
  );
}

export function PlaylistPanel() {
  const playlists = useStore((s) => s.playlists);
  const playlist = useStore(activePlaylist);
  const presentations = useStore((s) => s.presentations);
  const selectedItem = useStore((s) => s.selectedPlaylistItemId);
  const liveItem = useStore((s) => s.live.slide?.playlistItemId);
  const s = useStore.getState();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);

  if (!playlist) return null;
  const items = playlist.items;

  const onDragOver = (e: DragEvent, index: number) => {
    const types = e.dataTransfer.types;
    if (!types.includes(DRAG_PRESENTATION) && !types.includes(DRAG_PLAYLIST_ITEM)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY > rect.top + rect.height / 2 ? index + 1 : index);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const to = dropIndex ?? items.length;
    setDropIndex(null);
    const presentationId = e.dataTransfer.getData(DRAG_PRESENTATION);
    if (presentationId) return s.addToPlaylist(presentationId, to);
    const from = items.findIndex((it) => it.id === e.dataTransfer.getData(DRAG_PLAYLIST_ITEM));
    if (from >= 0) s.movePlaylistItem(from, to);
  };

  return (
    <section
      className="panel playlist"
      onDragOver={(e) => onDragOver(e, items.length - 1)}
      onDragLeave={() => setDropIndex(null)}
      onDrop={onDrop}
    >
      <header className="panel-header">
        <select className="playlist-select" value={playlist.id} onChange={(e) => s.setActivePlaylist(e.target.value)} aria-label="Playlist">
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="panel-actions">
          <IconButton icon="heading" title="Add section header" onClick={() => s.addPlaylistHeader('Section')} />
          <IconButton
            icon="edit"
            title="Rename playlist"
            onClick={() => {
              const name = prompt('Playlist name', playlist.name);
              if (name?.trim()) s.renamePlaylist(playlist.id, name.trim());
            }}
          />
          <IconButton
            icon="plus"
            title="New playlist"
            onClick={() => {
              const name = prompt('New playlist name', 'New Service');
              if (name?.trim()) s.createPlaylist(name.trim());
            }}
          />
          {playlists.length > 1 && (
            <IconButton
              icon="trash"
              title="Delete playlist"
              danger
              onClick={() => confirm(`Delete playlist "${playlist.name}"?`) && s.deletePlaylist(playlist.id)}
            />
          )}
        </div>
      </header>
      <ul className="list">
        {items.map((item, index) => {
          const dropClass = dropIndex === index ? 'drop-before' : dropIndex === index + 1 && index === items.length - 1 ? 'drop-after' : '';
          const common = {
            draggable: true,
            onDragStart: (e: DragEvent) => e.dataTransfer.setData(DRAG_PLAYLIST_ITEM, item.id),
            onDragOver: (e: DragEvent) => onDragOver(e, index),
          };
          if (item.type === 'header') {
            return (
              <li
                key={item.id}
                className={`list-item playlist-header ${dropClass}`}
                {...common}
                onDoubleClick={() => setEditingHeader(item.id)}
              >
                {editingHeader === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.label}
                    onBlur={(e) => {
                      s.updatePlaylistItem(item.id, { label: e.target.value || 'Section' });
                      setEditingHeader(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="list-label">{item.label}</span>
                )}
                <span className="row-actions">
                  <IconButton icon="close" title="Remove" onClick={() => s.removePlaylistItem(item.id)} />
                </span>
              </li>
            );
          }
          const p = presentations[item.presentationId];
          return (
            <li
              key={item.id}
              className={`list-item ${selectedItem === item.id ? 'selected' : ''} ${dropClass}`}
              {...common}
              onClick={() => s.select(item.presentationId, item.id)}
            >
              <Icon name={p?.category === 'scripture' ? 'book' : p?.category === 'song' ? 'music' : 'list'} size={14} />
              <span className="list-label">{p?.title ?? 'Missing presentation'}</span>
              {liveItem === item.id && <span className="live-dot" title="Live" />}
              <span className="row-actions">
                <IconButton icon="close" title="Remove from playlist" onClick={() => s.removePlaylistItem(item.id)} />
              </span>
            </li>
          );
        })}
        {items.length === 0 && <li className="empty">Drag presentations here from the library.</li>}
      </ul>
    </section>
  );
}
