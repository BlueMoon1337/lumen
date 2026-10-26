import { useMemo, useState, type DragEvent } from 'react';
import { IMPORT_ACCEPT, importFiles, newPresentation } from '../commands';
import { useStore } from '../store';
import type { Category, Playlist } from '../types';
import { DRAG_PLAYLIST_ITEM, DRAG_PRESENTATION, FilterField, Icon, IconButton, pickFiles, SectionHeader } from './ui';

export const LIBRARIES: { category: Category; label: string }[] = [
  { category: 'song', label: 'Songs' },
  { category: 'scripture', label: 'Scripture' },
  { category: 'announcement', label: 'Announcements' },
  { category: 'other', label: 'Other' },
];

const hasDrag = (e: DragEvent, type: string) => e.dataTransfer.types.includes(type);

/** ProPresenter's left column: collections on top, the selected collection's items below. */
export function Sidebar() {
  const sidebar = useStore((s) => s.sidebar);
  return (
    <aside className="sidebar">
      <Collections />
      {sidebar === 'library' ? <LibraryItems /> : <PlaylistItems />}
    </aside>
  );
}

function Collections() {
  const sidebar = useStore((s) => s.sidebar);
  const category = useStore((s) => s.libraryCategory);
  const playlists = useStore((s) => s.playlists);
  const activeId = useStore((s) => s.activePlaylistId);
  const s = useStore.getState();
  const [libOpen, setLibOpen] = useState(true);
  const [plOpen, setPlOpen] = useState(true);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  return (
    <div className="collections">
      <SectionHeader
        title="Library"
        onAdd={() => newPresentation(category)}
        addTitle="New presentation"
        collapsed={!libOpen}
        onToggle={() => setLibOpen(!libOpen)}
      >
        <IconButton
          icon="download"
          title="Import ProPresenter (.pro), lyrics (.txt) or Bible (.rvbible) files"
          onClick={() => pickFiles(IMPORT_ACCEPT).then((files) => importFiles(files))}
        />
      </SectionHeader>
      {libOpen &&
        LIBRARIES.map((lib) => (
          <div
            key={lib.category}
            className={`collection-row ${sidebar === 'library' && category === lib.category ? 'selected' : ''} ${dropTarget === lib.category ? 'drop' : ''}`}
            onClick={() => s.setUI({ sidebar: 'library', libraryCategory: lib.category })}
            onDragOver={(e) => {
              if (hasDrag(e, DRAG_PRESENTATION) || hasDrag(e, 'Files')) {
                e.preventDefault();
                setDropTarget(lib.category);
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const id = e.dataTransfer.getData(DRAG_PRESENTATION);
              if (id) s.updatePresentation(id, { category: lib.category });
              else void importFiles(Array.from(e.dataTransfer.files), lib.category);
            }}
          >
            <span className="collection-icon library">
              <Icon name={lib.category === 'scripture' ? 'bible' : 'library'} size={14} />
            </span>
            <span className="list-label">{lib.label}</span>
          </div>
        ))}
      <SectionHeader
        title="Playlist"
        onAdd={() => {
          const name = prompt('New playlist name', 'New Service');
          if (name?.trim()) {
            s.createPlaylist(name.trim());
            s.setUI({ sidebar: 'playlist' });
          }
        }}
        addTitle="New playlist"
        collapsed={!plOpen}
        onToggle={() => setPlOpen(!plOpen)}
      />
      {plOpen &&
        playlists.map((pl) => (
          <PlaylistRow
            key={pl.id}
            playlist={pl}
            selected={sidebar === 'playlist' && activeId === pl.id}
            drop={dropTarget === pl.id}
            setDrop={(on) => setDropTarget(on ? pl.id : null)}
            canDelete={playlists.length > 1}
          />
        ))}
    </div>
  );
}

function PlaylistRow({
  playlist,
  selected,
  drop,
  setDrop,
  canDelete,
}: {
  playlist: Playlist;
  selected: boolean;
  drop: boolean;
  setDrop: (on: boolean) => void;
  canDelete: boolean;
}) {
  const s = useStore.getState();
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      className={`collection-row ${selected ? 'selected' : ''} ${drop ? 'drop' : ''}`}
      onClick={() => {
        s.setActivePlaylist(playlist.id);
        s.setUI({ sidebar: 'playlist' });
      }}
      onDoubleClick={() => setRenaming(true)}
      onDragOver={(e) => {
        if (hasDrag(e, DRAG_PRESENTATION)) {
          e.preventDefault();
          setDrop(true);
        }
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const id = e.dataTransfer.getData(DRAG_PRESENTATION);
        if (id) s.addToPlaylist(id, undefined, playlist.id);
      }}
      title="Double-click to rename. Drop presentations here to add them."
    >
      <span className="collection-icon playlist">
        <Icon name="playlist" size={14} />
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={playlist.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.target.value.trim()) s.renamePlaylist(playlist.id, e.target.value.trim());
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span className="list-label">{playlist.name}</span>
      )}
      {canDelete && (
        <span className="row-actions">
          <IconButton
            icon="trash"
            title="Delete playlist"
            danger
            onClick={() => confirm(`Delete playlist "${playlist.name}"?`) && s.deletePlaylist(playlist.id)}
          />
        </span>
      )}
    </div>
  );
}

function ItemIcon({ category }: { category?: Category }) {
  return (
    <span className="item-icon">
      <Icon name={category === 'scripture' ? 'bible' : 'slides'} size={14} />
    </span>
  );
}

function LibraryItems() {
  const category = useStore((s) => s.libraryCategory);
  const presentations = useStore((s) => s.presentations);
  const selectedId = useStore((s) => s.selectedPresentationId);
  const selectedItem = useStore((s) => s.selectedPlaylistItemId);
  const liveId = useStore((s) => s.live.slide?.presentationId);
  const s = useStore.getState();
  const [filter, setFilter] = useState('');
  const [dropping, setDropping] = useState(false);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.values(presentations)
      .filter((p) => p.category === category)
      .filter(
        (p) => !q || p.title.toLowerCase().includes(q) || p.groups.some((g) => g.slides.some((sl) => sl.text.toLowerCase().includes(q))),
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [presentations, category, filter]);

  return (
    <div
      className={`items ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (hasDrag(e, 'Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void importFiles(Array.from(e.dataTransfer.files), category);
      }}
    >
      <SectionHeader
        title={`${list.length} ${list.length === 1 ? 'item' : 'items'}`}
        onAdd={() => newPresentation(category)}
        addTitle="New presentation"
      />
      <ul className="item-list">
        {list.map((p) => (
          <li
            key={p.id}
            className={`item-row ${selectedId === p.id && !selectedItem ? 'selected' : ''}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_PRESENTATION, p.id)}
            onClick={() => s.select(p.id)}
          >
            <ItemIcon category={p.category} />
            <span className="list-label">{p.title}</span>
            {liveId === p.id && <span className="live-dot" title="Live" />}
            <span className="row-actions">
              <IconButton icon="plus" title="Add to playlist" onClick={() => s.addToPlaylist(p.id)} />
              <IconButton icon="copy" title="Duplicate" onClick={() => s.duplicatePresentation(p.id)} />
              <IconButton
                icon="trash"
                title="Delete"
                danger
                onClick={() => confirm(`Delete "${p.title}"? This cannot be undone.`) && s.deletePresentation(p.id)}
              />
            </span>
          </li>
        ))}
        {list.length === 0 && (
          <li className="empty">{filter ? 'No matches.' : 'Drop ProPresenter .pro or .txt lyric files here, or press + to add.'}</li>
        )}
      </ul>
      <FilterField value={filter} onChange={setFilter} />
    </div>
  );
}

function PlaylistItems() {
  const playlist = useStore((s) => s.playlists.find((p) => p.id === s.activePlaylistId) ?? s.playlists[0]);
  const presentations = useStore((s) => s.presentations);
  const selectedItem = useStore((s) => s.selectedPlaylistItemId);
  const liveItem = useStore((s) => s.live.slide?.playlistItemId);
  const s = useStore.getState();
  const [filter, setFilter] = useState('');
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);

  if (!playlist) return null;
  const items = playlist.items;
  const q = filter.trim().toLowerCase();
  const visible = (index: number) => {
    if (!q) return true;
    const it = items[index];
    return it.type === 'header' ? it.label.toLowerCase().includes(q) : !!presentations[it.presentationId]?.title.toLowerCase().includes(q);
  };
  const count = items.filter((it) => it.type === 'presentation').length;

  const onDragOver = (e: DragEvent, index: number) => {
    if (!hasDrag(e, DRAG_PRESENTATION) && !hasDrag(e, DRAG_PLAYLIST_ITEM)) return;
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
    <div className="items" onDragOver={(e) => onDragOver(e, items.length - 1)} onDragLeave={() => setDropIndex(null)} onDrop={onDrop}>
      <SectionHeader
        title={`${count} ${count === 1 ? 'item' : 'items'}`}
        onAdd={() => s.addPlaylistHeader('Header')}
        addTitle="Add header"
      />
      <ul className="item-list">
        {items.map((item, index) => {
          if (!visible(index)) return null;
          const drop = dropIndex === index ? 'drop-before' : dropIndex === index + 1 && index === items.length - 1 ? 'drop-after' : '';
          const common = {
            draggable: true,
            onDragStart: (e: DragEvent) => e.dataTransfer.setData(DRAG_PLAYLIST_ITEM, item.id),
            onDragOver: (e: DragEvent) => onDragOver(e, index),
          };
          if (item.type === 'header') {
            return (
              <li key={item.id} className={`item-row playlist-header ${drop}`} {...common} onDoubleClick={() => setEditingHeader(item.id)}>
                {editingHeader === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.label}
                    onBlur={(e) => {
                      s.updatePlaylistItem(item.id, { label: e.target.value || 'Header' });
                      setEditingHeader(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="list-label">{item.label}</span>
                )}
                <span className="row-actions">
                  <IconButton icon="close" title="Remove header" onClick={() => s.removePlaylistItem(item.id)} />
                </span>
              </li>
            );
          }
          const p = presentations[item.presentationId];
          return (
            <li
              key={item.id}
              className={`item-row ${selectedItem === item.id ? 'selected' : ''} ${drop}`}
              {...common}
              onClick={() => s.select(item.presentationId, item.id)}
            >
              <ItemIcon category={p?.category} />
              <span className="list-label">{p?.title ?? 'Missing presentation'}</span>
              {liveItem === item.id && <span className="live-dot" title="Live" />}
              <span className="row-actions">
                <IconButton icon="close" title="Remove from playlist" onClick={() => s.removePlaylistItem(item.id)} />
              </span>
            </li>
          );
        })}
        {items.length === 0 && <li className="empty">Drag presentations here, or onto the playlist name above.</li>}
      </ul>
      <FilterField value={filter} onChange={setFilter} />
    </div>
  );
}
