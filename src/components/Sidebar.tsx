import { useMemo, useState, type DragEvent } from 'react';
import { importFiles } from '../commands';
import { useStore } from '../store';
import type { Category } from '../types';
import { slideWords } from '../slideshows';
import { openContextMenu, type ContextEntries } from './ContextMenu';
import { deleteLibrary, deletePlaylist, deletePresentation, removePlaylistItem } from './deleting';
import { importFileCommand, newLibrary, newPlaylist, newPresentationNamed } from './fileCommands';
import { libraryMenu, playlistHeaderMenu, playlistMenu, presentationMenu } from './menus';
import { DRAG_PLAYLIST_ITEM, DRAG_PRESENTATION, FilterField, Icon, IconButton, pickFiles, SectionHeader, type IconName } from './ui';

/** The libraries as options, for a library menu. */
export function LibraryOptions() {
  const libraries = useStore((s) => s.libraries);
  return (
    <>
      {libraries.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </>
  );
}

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
  const libraries = useStore((s) => s.libraries);
  const playlists = useStore((s) => s.playlists);
  const activeId = useStore((s) => s.activePlaylistId);
  const s = useStore.getState();
  const [libOpen, setLibOpen] = useState(true);
  const [plOpen, setPlOpen] = useState(true);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    // Edit ▸ Delete (and the Delete key) here deletes the open library or playlist, after asking.
    <div className="collections" tabIndex={-1} data-edit-scope="collections">
      <SectionHeader
        title="Library"
        onAdd={() => void newLibrary()}
        addTitle="New library"
        collapsed={!libOpen}
        onToggle={() => setLibOpen(!libOpen)}
      >
        <IconButton
          icon="download"
          title="Import ProPresenter songs (.pro), playlists (.proplaylist), lyrics (.txt) or Bibles (.rvbible)"
          onClick={() => void importFileCommand()}
        />
      </SectionHeader>
      {libOpen &&
        libraries.map((lib) => (
          <CollectionRow
            key={lib.id}
            icon={lib.id === 'scripture' ? 'bible' : 'library'}
            kind="library"
            name={lib.name}
            selected={sidebar === 'library' && category === lib.id}
            drop={dropTarget === lib.id}
            renaming={renaming === lib.id}
            setRenaming={(on) => setRenaming(on ? lib.id : null)}
            onOpen={() => s.setUI({ sidebar: 'library', libraryCategory: lib.id })}
            onRename={(name) => s.renameLibrary(lib.id, name)}
            onDelete={libraries.length > 1 ? () => deleteLibrary(lib.id) : undefined}
            menu={() => libraryMenu(lib, () => setRenaming(lib.id))}
            title="Double-click to rename. Drop presentations or files here to add them."
            onDragOver={(e) => {
              if (hasDrag(e, DRAG_PRESENTATION) || hasDrag(e, 'Files')) {
                e.preventDefault();
                setDropTarget(lib.id);
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const id = e.dataTransfer.getData(DRAG_PRESENTATION);
              if (id) s.updatePresentation(id, { category: lib.id });
              else void importFiles(Array.from(e.dataTransfer.files), lib.id);
            }}
          />
        ))}
      <SectionHeader
        title="Playlist"
        onAdd={() => void newPlaylist()}
        addTitle="New playlist"
        collapsed={!plOpen}
        onToggle={() => setPlOpen(!plOpen)}
      >
        <IconButton
          icon="download"
          title="Import a ProPresenter playlist (.proplaylist)"
          onClick={() => pickFiles('.proplaylist').then((files) => importFiles(files))}
        />
      </SectionHeader>
      {plOpen &&
        playlists.map((pl) => (
          <CollectionRow
            key={pl.id}
            icon="playlist"
            kind="playlist"
            name={pl.name}
            selected={sidebar === 'playlist' && activeId === pl.id}
            drop={dropTarget === pl.id}
            renaming={renaming === pl.id}
            setRenaming={(on) => setRenaming(on ? pl.id : null)}
            onOpen={() => {
              s.setActivePlaylist(pl.id);
              s.setUI({ sidebar: 'playlist' });
            }}
            onRename={(name) => s.renamePlaylist(pl.id, name)}
            onDelete={playlists.length > 1 ? () => deletePlaylist(pl.id) : undefined}
            menu={() => playlistMenu(pl, () => setRenaming(pl.id))}
            title="Double-click to rename. Drop presentations here to add them."
            onDragOver={(e) => {
              if (hasDrag(e, DRAG_PRESENTATION)) {
                e.preventDefault();
                setDropTarget(pl.id);
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const id = e.dataTransfer.getData(DRAG_PRESENTATION);
              if (id) s.addToPlaylist(id, undefined, pl.id);
            }}
          />
        ))}
    </div>
  );
}

/** A library or playlist in the sidebar: click to open, double-click to rename, right-click for more. */
function CollectionRow({
  icon,
  kind,
  name,
  selected,
  drop,
  renaming,
  setRenaming,
  onOpen,
  onRename,
  onDelete,
  menu,
  title,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  icon: IconName;
  kind: 'library' | 'playlist';
  name: string;
  selected: boolean;
  drop: boolean;
  renaming: boolean;
  setRenaming: (on: boolean) => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete?: () => void;
  menu: () => ContextEntries;
  title: string;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    <div
      className={`collection-row ${selected ? 'selected' : ''} ${drop ? 'drop' : ''}`}
      onClick={onOpen}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={(e) => {
        onOpen();
        openContextMenu(e, menu());
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={title}
    >
      <span className={`collection-icon ${kind}`}>
        <Icon name={icon} size={14} />
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={name}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            if (e.target.value.trim()) onRename(e.target.value.trim());
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          aria-label={`${kind === 'library' ? 'Library' : 'Playlist'} name`}
        />
      ) : (
        <span className="list-label">{name}</span>
      )}
      {onDelete && !renaming && (
        <span className="row-actions">
          <IconButton icon="trash" title={`Delete ${kind}`} danger onClick={onDelete} />
        </span>
      )}
    </div>
  );
}

function ItemIcon({ category, announcements }: { category?: Category; announcements?: boolean }) {
  return (
    <span className="item-icon">
      <Icon name={announcements ? 'megaphone' : category === 'scripture' ? 'bible' : 'slides'} size={14} />
    </span>
  );
}

function LibraryItems() {
  const category = useStore((s) => s.libraryCategory);
  const presentations = useStore((s) => s.presentations);
  const selectedId = useStore((s) => s.selectedPresentationId);
  const selectedItem = useStore((s) => s.selectedPlaylistItemId);
  const liveId = useStore((s) => s.live.slide?.presentationId);
  const announcementId = useStore((s) => s.live.announcement?.presentationId);
  const s = useStore.getState();
  const [filter, setFilter] = useState('');
  const [dropping, setDropping] = useState(false);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.values(presentations)
      .filter((p) => p.category === category && !p.hidden)
      .filter(
        (p) =>
          !q || p.title.toLowerCase().includes(q) || p.groups.some((g) => g.slides.some((sl) => slideWords(sl).toLowerCase().includes(q))),
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
        onAdd={() => void newPresentationNamed(category)}
        addTitle="New presentation"
      />
      <ul className="item-list" tabIndex={-1} data-edit-scope="library">
        {list.map((p) => (
          <li
            key={p.id}
            className={`item-row ${selectedId === p.id && !selectedItem ? 'selected' : ''}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_PRESENTATION, p.id)}
            onClick={() => s.select(p.id)}
            onContextMenu={(e) => {
              s.select(p.id);
              openContextMenu(e, presentationMenu(p));
            }}
          >
            <ItemIcon category={p.category} announcements={p.destination === 'announcements'} />
            <span className="list-label">{p.title}</span>
            {(liveId === p.id || announcementId === p.id) && <span className="live-dot" title="Live" />}
            <span className="row-actions">
              <IconButton icon="plus" title="Add to playlist" onClick={() => s.addToPlaylist(p.id)} />
              <IconButton icon="copy" title="Duplicate" onClick={() => s.duplicatePresentation(p.id)} />
              <IconButton icon="trash" title="Delete" danger onClick={() => deletePresentation(p.id)} />
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
  const announcementItem = useStore((s) => s.live.announcement?.playlistItemId);
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
    if (hasDrag(e, 'Files')) return e.preventDefault();
    if (!hasDrag(e, DRAG_PRESENTATION) && !hasDrag(e, DRAG_PLAYLIST_ITEM)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY > rect.top + rect.height / 2 ? index + 1 : index);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) return void importFiles(Array.from(e.dataTransfer.files));
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
      {/* Delete takes the selected entry out of the playlist; the presentation stays in the library. */}
      <ul className="item-list" tabIndex={-1} data-edit-scope="playlist">
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
              <li
                key={item.id}
                className={`item-row playlist-header ${drop}`}
                {...common}
                onDoubleClick={() => setEditingHeader(item.id)}
                onContextMenu={(e) =>
                  openContextMenu(
                    e,
                    playlistHeaderMenu(item, () => setEditingHeader(item.id)),
                  )
                }
              >
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
                  <IconButton icon="close" title="Remove header" onClick={() => removePlaylistItem(item.id)} />
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
              onContextMenu={(e) => {
                s.select(item.presentationId, item.id);
                openContextMenu(
                  e,
                  p ? presentationMenu(p, item.id) : [{ label: 'Remove from Playlist', action: () => removePlaylistItem(item.id) }],
                );
              }}
            >
              <ItemIcon category={p?.category} announcements={p?.destination === 'announcements'} />
              <span className="list-label">{p?.title ?? 'Missing presentation'}</span>
              {(liveItem === item.id || announcementItem === item.id) && <span className="live-dot" title="Live" />}
              <span className="row-actions">
                <IconButton icon="close" title="Remove from playlist" onClick={() => removePlaylistItem(item.id)} />
              </span>
            </li>
          );
        })}
        {items.length === 0 && <li className="empty">Drag presentations here, or drop a ProPresenter .proplaylist file.</li>}
      </ul>
      <FilterField value={filter} onChange={setFilter} />
    </div>
  );
}
