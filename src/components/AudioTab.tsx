import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { countdownFade } from '../countdowns';
import { loadMedia } from '../media';
import { notify } from '../notices';
import { useStore } from '../store';
import type { MediaItem, MediaPlaylist } from '../types';
import { formatDuration } from '../util';
import { NamePopup, openContextMenu, openPopupAtMenu, openPopupBelow, type ContextEntries } from './ContextMenu';
import { deleteAudioPlaylist, deleteMedia } from './deleting';
import { Dialog, DRAG_AUDIO, FilterField, Icon, IconButton, pickFiles, SectionHeader } from './ui';

const st = () => useStore.getState();

/** Imports audio files into the Audio Library, and into a playlist if one is given. */
const importAudio = async (files?: File[], playlistId?: string) => {
  const chosen = files ?? (await pickFiles('audio/*'));
  const audio = chosen.filter((f) => f.type.startsWith('audio/'));
  if (chosen.length && !audio.length) return notify('Those files aren’t audio.', 'error');
  const added = await st().addMediaFiles(audio);
  if (playlistId && added.length)
    st().addToAudioPlaylist(
      playlistId,
      added.map((m) => m.id),
    );
};

const hasDrag = (e: DragEvent, type: string) => e.dataTransfer.types.includes(type);

function startDrag(e: DragEvent, ids: string[], from: string | null) {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData(DRAG_AUDIO, JSON.stringify({ ids, from }));
}

function dropped(e: DragEvent): { ids: string[]; from: string | null } | null {
  try {
    const v = JSON.parse(e.dataTransfer.getData(DRAG_AUDIO)) as { ids?: unknown; from?: unknown };
    return Array.isArray(v.ids)
      ? { ids: v.ids.filter((x): x is string => typeof x === 'string'), from: typeof v.from === 'string' ? v.from : null }
      : null;
  } catch {
    return null;
  }
}

/** Plays a track (from a playlist, so the next one follows), or stops it if it's the one playing. */
function toggle(id: string, playlistId: string | null = null) {
  const { live } = st();
  if (live.audioId === id && live.audioFrom === playlistId) st().clearLayers(['audio']);
  else st().playAudio(id, playlistId);
}

const newAudioPlaylist = (anchor: Element, then?: (id: string) => void) =>
  openPopupBelow(
    anchor,
    <NamePopup
      title="New Audio Playlist"
      colors={false}
      action="Create"
      initial={{ name: 'Playlist', color: '' }}
      onSave={(v) => {
        const id = st().createAudioPlaylist(v.name);
        then?.(id);
      }}
    />,
  );

const renameTrack = (m: MediaItem) =>
  openPopupAtMenu(
    <NamePopup
      title="Rename"
      colors={false}
      initial={{ name: m.name, color: '' }}
      onSave={(v) => st().updateMedia(m.id, { name: v.name })}
    />,
  );

/** "Add to Playlist ▸": each audio playlist, and a new one. */
function addToPlaylistMenu(ids: string[]): ContextEntries {
  const playlists = st().audioPlaylists;
  return [
    ...playlists.map((pl) => ({ label: pl.name, action: () => st().addToAudioPlaylist(pl.id, ids) })),
    playlists.length > 0 && ('-' as const),
    {
      label: 'New Playlist…',
      action: () =>
        openPopupAtMenu(
          <NamePopup
            title="New Audio Playlist"
            colors={false}
            action="Create"
            initial={{ name: 'Playlist', color: '' }}
            onSave={(v) => st().addToAudioPlaylist(st().createAudioPlaylist(v.name), ids)}
          />,
        ),
    },
  ];
}

function audioMenu(m: MediaItem, playing: boolean): ContextEntries {
  const s = st();
  return [
    { label: playing ? 'Stop' : 'Play', action: () => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id)) },
    { label: 'Loop', checked: !!m.loop, action: () => s.updateMedia(m.id, { loop: !m.loop }) },
    { label: 'Add to Playlist', submenu: () => addToPlaylistMenu([m.id]) },
    '-',
    { label: 'Rename…', action: () => renameTrack(m) },
    { label: 'Delete…', danger: true, action: () => deleteMedia(m.id) },
  ];
}

/** A menu that drops down from a button. */
function menuBelow(e: MouseEvent<HTMLElement>, entries: ContextEntries) {
  const r = e.currentTarget.getBoundingClientRect();
  openContextMenu(
    {
      clientX: r.left,
      clientY: r.bottom + 2,
      preventDefault: () => {},
      stopPropagation: () => e.stopPropagation(),
      currentTarget: e.currentTarget,
    },
    entries,
  );
}

const durations = new Map<string, Promise<number>>();

/** How long a track is (0 until its file is read). */
function useDuration(id: string): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    let found = durations.get(id);
    if (!found) {
      found = loadMedia(id).then(
        (m) =>
          new Promise<number>((resolve) => {
            if (!m) return resolve(0);
            const a = new Audio();
            a.preload = 'metadata';
            a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0);
            a.onerror = () => resolve(0);
            a.src = m.url;
          }),
      );
      durations.set(id, found);
    }
    let alive = true;
    void found.then((d) => alive && setSeconds(d));
    return () => {
      alive = false;
    };
  }, [id]);
  return seconds;
}

/** Tracks by name, as people read them: "Song 2" before "Song 10", accents and case aside. */
const byName = (a: MediaItem, b: MediaItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

const length = (seconds: number) => (seconds > 0 ? formatDuration(Math.round(seconds) * 1000) : '');

/**
 * Countdown Fade: music on the Audio layer fades out as a countdown ends, starting this many
 * seconds before. A countdown video, the Timers tab's countdown, or both can set it off.
 */
export function CountdownFade() {
  const fade = useStore(useShallow((s) => countdownFade(s.settings)));
  const s = st();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (Number.isFinite(v)) s.updateSettings({ countdownFadeSeconds: Math.max(0, Math.min(600, Math.round(v))) });
    setDraft(null);
  };
  return (
    <>
      <SectionHeader title="Countdown Fade" />
      <div className="countdown-fade">
        <label className="countdown-fade-when">
          <span>Start fading</span>
          <input
            type="number"
            min={0}
            max={600}
            value={draft ?? String(fade.seconds)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            aria-label="Seconds before the end that the music starts to fade"
          />
          <span>seconds before the end</span>
        </label>
        <div className="countdown-fade-with">
          <label className="check-row inline">
            <input type="checkbox" checked={fade.videos} onChange={(e) => s.updateSettings({ countdownFadeVideos: e.target.checked })} />
            Countdown videos
          </label>
          <label className="check-row inline">
            <input type="checkbox" checked={fade.timer} onChange={(e) => s.updateSettings({ countdownFadeTimer: e.target.checked })} />
            Timer
          </label>
        </div>
        {fade.seconds === 0 && <p className="muted small-print">0 seconds: the music stops at the end without fading.</p>}
      </div>
    </>
  );
}

/** A track in a playlist: click to play from here (the rest follow), drag to reorder. */
function PlaylistTrack({ playlist, m, index }: { playlist: MediaPlaylist; m: MediaItem; index: number }) {
  const playing = useStore((s) => s.live.audioId === m.id && s.live.audioFrom === playlist.id);
  const seconds = useDuration(m.id);
  const [drop, setDrop] = useState(false);
  const s = st();
  return (
    <li
      className={`audio-row track ${playing ? 'live' : ''} ${drop ? 'drop-before' : ''}`}
      draggable
      onDragStart={(e) => startDrag(e, [m.id], playlist.id)}
      onDragOver={(e) => {
        if (!hasDrag(e, DRAG_AUDIO)) return;
        e.preventDefault();
        e.stopPropagation();
        setDrop(true);
      }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => {
        const d = dropped(e);
        setDrop(false);
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        s.addToAudioPlaylist(playlist.id, d.ids, m.id);
      }}
      onClick={() => toggle(m.id, playlist.id)}
      onContextMenu={(e) =>
        openContextMenu(e, [
          { label: playing ? 'Stop' : 'Play from Here', action: () => toggle(m.id, playlist.id) },
          { label: 'Loop Track', checked: !!m.loop, action: () => s.updateMedia(m.id, { loop: !m.loop }) },
          '-',
          { label: 'Rename…', action: () => renameTrack(m) },
          { label: 'Remove from Playlist', action: () => s.removeFromAudioPlaylist(playlist.id, m.id) },
        ])
      }
      title={playing ? 'Click to stop' : 'Click to play from here'}
    >
      <span className="track-number">{playing ? <Icon name="stop" size={12} /> : index + 1}</span>
      <span className="list-label">{m.name}</span>
      <span className="track-length">{length(seconds)}</span>
      <span className="row-actions">
        <IconButton icon="close" title="Remove from playlist" onClick={() => s.removeFromAudioPlaylist(playlist.id, m.id)} />
      </span>
    </li>
  );
}

/** An audio playlist: tracks that play one after another. Drop tracks or audio files on it to add them. */
function AudioPlaylistRow({ playlist, open, onToggle }: { playlist: MediaPlaylist; open: boolean; onToggle: () => void }) {
  const media = useStore((s) => s.media);
  const tracks = useMemo(
    () => playlist.items.map((id) => media.find((m) => m.id === id && m.kind === 'audio')).filter((m): m is MediaItem => !!m),
    [playlist.items, media],
  );
  const playing = useStore((s) => s.live.audioFrom === playlist.id && !!s.live.audioId);
  const [drop, setDrop] = useState(false);
  const s = st();
  const rename = (anchor: Element) =>
    openPopupBelow(
      anchor,
      <NamePopup
        title="Rename Audio Playlist"
        colors={false}
        initial={{ name: playlist.name, color: '' }}
        onSave={(v) => s.renameAudioPlaylist(playlist.id, v.name)}
      />,
    );
  const play = () => (playing ? s.clearLayers(['audio']) : tracks[0] && s.playAudio(tracks[0].id, playlist.id));
  return (
    <div className="audio-playlist">
      <div
        className={`collection-row audio-playlist-row ${drop ? 'drop' : ''} ${playing ? 'playing' : ''}`}
        onClick={onToggle}
        onDoubleClick={(e) => rename(e.currentTarget)}
        onContextMenu={(e) => {
          const row = e.currentTarget;
          openContextMenu(e, [
            { label: playing ? 'Stop' : 'Play Playlist', disabled: !playing && !tracks.length, action: play },
            {
              label: 'Loop Playlist',
              checked: !!playlist.loop,
              action: () => s.updateAudioPlaylist(playlist.id, { loop: !playlist.loop }),
            },
            '-',
            { label: 'Add from Audio Library…', action: () => s.setUI({ dialog: 'audioLibrary' }) },
            { label: 'Import Audio…', action: () => void importAudio(undefined, playlist.id) },
            { label: 'Rename…', action: () => rename(row) },
            '-',
            { label: 'Delete Playlist…', danger: true, action: () => deleteAudioPlaylist(playlist.id) },
          ]);
        }}
        onDragOver={(e) => {
          if (hasDrag(e, DRAG_AUDIO) || hasDrag(e, 'Files')) {
            e.preventDefault();
            e.stopPropagation();
            setDrop(true);
          }
        }}
        onDragLeave={() => setDrop(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrop(false);
          const d = dropped(e);
          if (d) s.addToAudioPlaylist(playlist.id, d.ids);
          else void importAudio(Array.from(e.dataTransfer.files), playlist.id);
        }}
        title="Drop tracks here to add them. Double-click to rename."
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="collection-icon playlist">
          <Icon name="music" size={13} />
        </span>
        <span className="list-label">{playlist.name}</span>
        {playing && <span className="live-dot" title="Playing" />}
        <span className="row-actions">
          <IconButton
            icon="repeat"
            title={playlist.loop ? 'Looping: click to stop after the last track' : 'Click to start over after the last track'}
            active={!!playlist.loop}
            onClick={() => s.updateAudioPlaylist(playlist.id, { loop: !playlist.loop })}
          />
          <IconButton icon={playing ? 'stop' : 'play'} title={playing ? 'Stop' : 'Play playlist'} onClick={() => play()} />
        </span>
        <span className="count">{tracks.length}</span>
      </div>
      {open && (
        <ul
          className="audio-list tracks"
          onDragOver={(e) => hasDrag(e, DRAG_AUDIO) && e.preventDefault()}
          onDrop={(e) => {
            const d = dropped(e);
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            s.addToAudioPlaylist(playlist.id, d.ids);
          }}
        >
          {tracks.map((m, i) => (
            <PlaylistTrack key={m.id} playlist={playlist} m={m} index={i} />
          ))}
          {tracks.length === 0 && <li className="empty">Drag tracks here, or add them from the Audio Library.</li>}
        </ul>
      )}
    </div>
  );
}

/** A track in the Audio tab's list of all audio: click to play it, again to stop. */
function AudioRow({ m }: { m: MediaItem }) {
  const playing = useStore((s) => s.live.audioId === m.id);
  const s = st();
  return (
    <li
      className={`audio-row ${playing ? 'live' : ''}`}
      draggable
      onDragStart={(e) => startDrag(e, [m.id], null)}
      onClick={() => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id))}
      onContextMenu={(e) => openContextMenu(e, audioMenu(m, playing))}
      title={playing ? 'Click to stop' : 'Click to play. Drag onto a playlist to add it.'}
    >
      <Icon name={playing ? 'stop' : 'play'} size={13} />
      <span className="list-label">{m.name}</span>
      <span className="row-actions">
        <IconButton
          icon="repeat"
          title={m.loop ? 'Looping: click to play once' : 'Play once: click to loop'}
          active={!!m.loop}
          onClick={() => s.updateMedia(m.id, { loop: !m.loop })}
        />
      </span>
    </li>
  );
}

/**
 * ProPresenter's audio bin: music and sound effects that play on the Audio layer, from this
 * computer's speakers or sound card. Playlists play their tracks one after another; the Audio
 * Library window has every audio file.
 */
export function AudioTab() {
  // In alphabetical order.
  const audio = useStore(useShallow((s) => s.media.filter((m) => m.kind === 'audio').sort(byName)));
  const playlists = useStore((s) => s.audioPlaylists);
  const s = st();
  const [dropping, setDropping] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(true);
  const [audioOpen, setAudioOpen] = useState(true);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) =>
    setClosed((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div
      className={`audio-tab ${dropping ? 'dropping' : ''}`}
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
        if (e.dataTransfer.files.length) void importAudio(Array.from(e.dataTransfer.files));
      }}
    >
      <CountdownFade />
      <SectionHeader title="Playlists" collapsed={!playlistsOpen} onToggle={() => setPlaylistsOpen(!playlistsOpen)}>
        <IconButton
          icon="plus"
          title="New audio playlist"
          onClick={(e) => {
            setPlaylistsOpen(true);
            newAudioPlaylist(e.currentTarget);
          }}
        />
      </SectionHeader>
      {playlistsOpen && (
        <div className="audio-playlists">
          {playlists.map((pl) => (
            <AudioPlaylistRow key={pl.id} playlist={pl} open={!closed.has(pl.id)} onToggle={() => toggleOpen(pl.id)} />
          ))}
          {playlists.length === 0 && <div className="audio-empty">Press + to make a playlist, then drag tracks onto it.</div>}
        </div>
      )}
      <SectionHeader title="Audio" collapsed={!audioOpen} onToggle={() => setAudioOpen(!audioOpen)}>
        <button
          type="button"
          className="audio-library-button"
          onClick={() => s.setUI({ dialog: 'audioLibrary' })}
          title="Every audio file in Lumen"
        >
          <Icon name="library" size={12} />
          Audio Library
        </button>
        <IconButton icon="plus" title="Import audio" onClick={() => void importAudio()} />
      </SectionHeader>
      {audioOpen && (
        <ul className="audio-list">
          {audio.map((m) => (
            <AudioRow key={m.id} m={m} />
          ))}
          {audio.length === 0 && <li className="empty">Drop music or sound files here, or press + to add them.</li>}
        </ul>
      )}
    </div>
  );
}

type Sort = 'added' | 'name' | 'length';

/** A row of the Audio Library: select it (⌘ or ⇧ for more), double-click or press play to play it. */
function LibraryRow({
  m,
  selected,
  onSelect,
  selection,
  playlists,
  onLength,
}: {
  m: MediaItem;
  selected: boolean;
  onSelect: (e: MouseEvent) => void;
  selection: string[];
  playlists: string[];
  onLength: (id: string, seconds: number) => void;
}) {
  const playing = useStore((s) => s.live.audioId === m.id);
  const seconds = useDuration(m.id);
  useEffect(() => onLength(m.id, seconds), [m.id, seconds, onLength]);
  const s = st();
  const ids = selected ? selection : [m.id];
  return (
    <li
      className={`audio-library-row ${selected ? 'selected' : ''} ${playing ? 'live' : ''}`}
      onMouseDown={(e) => e.button === 0 && onSelect(e)}
      onDoubleClick={() => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id))}
      onContextMenu={(e) => {
        if (!selected) onSelect(e);
        openContextMenu(e, [
          { label: playing ? 'Stop' : 'Play', action: () => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id)) },
          { label: 'Loop', checked: !!m.loop, action: () => s.updateMedia(m.id, { loop: !m.loop }) },
          { label: ids.length > 1 ? `Add ${ids.length} Tracks to Playlist` : 'Add to Playlist', submenu: () => addToPlaylistMenu(ids) },
          '-',
          { label: 'Rename…', action: () => renameTrack(m) },
          { label: 'Delete…', danger: true, action: () => deleteMedia(m.id) },
        ]);
      }}
    >
      <IconButton
        icon={playing ? 'stop' : 'play'}
        title={playing ? 'Stop' : 'Play'}
        active={playing}
        onClick={() => (playing ? s.clearLayers(['audio']) : s.playAudio(m.id))}
      />
      <span className="list-label" title={m.name}>
        {m.name}
      </span>
      <span className="audio-library-in" title={playlists.join(', ')}>
        {playlists.join(', ')}
      </span>
      <span className="track-length">{length(seconds)}</span>
      <IconButton
        icon="repeat"
        title={m.loop ? 'Looping: click to play once' : 'Play once: click to loop'}
        active={!!m.loop}
        onClick={() => s.updateMedia(m.id, { loop: !m.loop })}
      />
      <IconButton icon="plus" title="Add to playlist" onClick={(e) => menuBelow(e, addToPlaylistMenu(ids))} />
    </li>
  );
}

/** Every audio file in Lumen, to search, play, and add to playlists. */
export function AudioLibraryDialog({ onClose }: { onClose: () => void }) {
  const audio = useStore(useShallow((s) => s.media.filter((m) => m.kind === 'audio')));
  const playlists = useStore((s) => s.audioPlaylists);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const [dropping, setDropping] = useState(false);
  const onLength = useMemo(() => (id: string, seconds: number) => setLengths((l) => (l[id] === seconds ? l : { ...l, [id]: seconds })), []);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q ? audio.filter((m) => m.name.toLowerCase().includes(q)) : audio;
    if (sort === 'name') return [...found].sort(byName);
    if (sort === 'length') return [...found].sort((a, b) => (lengths[a.id] ?? 0) - (lengths[b.id] ?? 0));
    return found;
  }, [audio, query, sort, lengths]);
  const inPlaylists = (id: string) => playlists.filter((pl) => pl.items.includes(id)).map((pl) => pl.name);
  const live = selection.filter((id) => audio.some((m) => m.id === id));
  const total = audio.reduce((n, m) => n + (lengths[m.id] ?? 0), 0);

  const select = (id: string, e: MouseEvent) => {
    if (e.shiftKey && anchor) {
      const ids = shown.map((m) => m.id);
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) return setSelection(ids.slice(a, b + 1));
    }
    if (e.metaKey || e.ctrlKey) setSelection((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
    else setSelection([id]);
    setAnchor(id);
  };

  return (
    <Dialog title="Audio Library" onClose={onClose} wide className="audio-library">
      <div
        className={`audio-library-body ${dropping ? 'dropping' : ''}`}
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
          void importAudio(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="audio-library-bar">
          <FilterField value={query} onChange={setQuery} placeholder="Search audio" />
          <label className="audio-library-sort">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
              <option value="name">Name</option>
              <option value="added">Date Added</option>
              <option value="length">Length</option>
            </select>
          </label>
          <button type="button" className="btn" onClick={() => void importAudio()}>
            <Icon name="upload" size={13} /> Import…
          </button>
        </div>
        <ul className="audio-library-list" onMouseDown={(e) => e.target === e.currentTarget && setSelection([])}>
          {shown.map((m) => (
            <LibraryRow
              key={m.id}
              m={m}
              selected={live.includes(m.id)}
              selection={live}
              onSelect={(e) => select(m.id, e)}
              playlists={inPlaylists(m.id)}
              onLength={onLength}
            />
          ))}
          {audio.length === 0 && <li className="empty">No audio yet. Drop music or sound files here, or press Import.</li>}
          {audio.length > 0 && shown.length === 0 && <li className="empty">No audio matches “{query}”.</li>}
        </ul>
        <footer className="audio-library-footer">
          <span className="muted">
            {audio.length} {audio.length === 1 ? 'file' : 'files'}
            {total > 0 && ` · ${formatDuration(Math.round(total) * 1000)}`}
            {live.length > 1 && ` · ${live.length} selected`}
          </span>
          <button type="button" className="btn" disabled={!live.length} onClick={(e) => menuBelow(e, addToPlaylistMenu(live))}>
            Add to Playlist <Icon name="chevronDown" size={12} />
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
