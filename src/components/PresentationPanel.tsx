import { memo, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { resolveTheme } from '../frame';
import { getSequence, presentationToText } from '../lyrics';
import { useStore } from '../store';
import type { Category, Presentation, SequenceEntry, Theme } from '../types';
import { SlidePreview } from './Canvas';

export function PresentationPanel() {
  const id = useStore((s) => s.selectedPresentationId);
  const p = useStore((s) => (id ? s.presentations[id] : undefined));
  const mode = useStore((s) => s.centerMode);
  const themes = useStore((s) => s.themes);
  const gridSize = useStore((s) => s.settings.gridSize);
  const { setUI, updatePresentation, updateSettings } = useStore.getState();

  if (!p) {
    return (
      <div className="center-empty">
        <p>Select a presentation from the Library or Playlist.</p>
        <p className="muted">
          Use <kbd>→</kbd> / <kbd>Space</kbd> to advance, <kbd>←</kbd> to go back, and <kbd>F1</kbd> to clear everything.
        </p>
      </div>
    );
  }

  return (
    <div className="presentation">
      <header className="presentation-header">
        <h2 className="presentation-title">{p.title}</h2>
        <div className="segmented" role="tablist">
          <button className={mode === 'show' ? 'active' : ''} onClick={() => setUI({ centerMode: 'show' })}>
            Show
          </button>
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setUI({ centerMode: 'edit' })}>
            Edit
          </button>
        </div>
        <label className="field-inline">
          Theme
          <select value={p.themeId ?? ''} onChange={(e) => updatePresentation(p.id, { themeId: e.target.value || undefined })}>
            <option value="">Default</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {mode === 'show' && (
          <input
            type="range"
            min={140}
            max={420}
            value={gridSize}
            onChange={(e) => updateSettings({ gridSize: Number(e.target.value) })}
            aria-label="Slide size"
            title="Slide size"
          />
        )}
      </header>
      {mode === 'show' ? <SlideGrid presentation={p} /> : <Editor key={p.id} presentation={p} />}
    </div>
  );
}

function SlideGrid({ presentation: p }: { presentation: Presentation }) {
  const themes = useStore((s) => s.themes);
  const settings = useStore((s) => s.settings);
  const gridSize = settings.gridSize;
  const live = useStore((s) => s.live.slide);
  const playlistItemId = useStore((s) => s.selectedPlaylistItemId);
  const theme = resolveTheme({ themes, settings }, p);
  const seq = useMemo(() => getSequence(p), [p]);
  const liveIndex = live?.presentationId === p.id ? live.index : -1;
  const liveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [liveIndex]);

  if (seq.length === 0) {
    return (
      <div className="center-empty">
        <p>This presentation has no slides yet.</p>
        <button className="btn" onClick={() => useStore.getState().setUI({ centerMode: 'edit' })}>
          Add lyrics
        </button>
      </div>
    );
  }

  return (
    <div className="slide-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` }}>
      {seq.map((entry, i) => (
        <SlideThumb
          key={`${entry.group.id}:${entry.slide.id}:${i}`}
          ref={i === liveIndex ? liveRef : undefined}
          entry={entry}
          index={i}
          theme={theme}
          live={i === liveIndex}
          presentationId={p.id}
          playlistItemId={playlistItemId}
        />
      ))}
    </div>
  );
}

const SlideThumb = memo(function SlideThumb({
  entry,
  index,
  theme,
  live,
  presentationId,
  playlistItemId,
  ref,
}: {
  entry: SequenceEntry;
  index: number;
  theme: Theme;
  live: boolean;
  presentationId: string;
  playlistItemId: string | null;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      className={`slide-thumb ${live ? 'live' : ''}`}
      onClick={() => useStore.getState().goLive(presentationId, index, playlistItemId)}
    >
      <div className="slide-thumb-canvas">
        <SlidePreview text={entry.slide.text} caption={entry.slide.caption} theme={theme} />
      </div>
      <div className="slide-thumb-label" style={{ background: entry.group.color }}>
        <span>{entry.indexInGroup === 0 ? entry.group.name : ''}</span>
        <span className="slide-number">{index + 1}</span>
      </div>
    </button>
  );
});

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'song', label: 'Song' },
  { value: 'scripture', label: 'Scripture' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'other', label: 'Other' },
];

function Editor({ presentation: p }: { presentation: Presentation }) {
  const { setPresentationText, updatePresentation } = useStore.getState();
  const [text, setText] = useState(() => presentationToText(p));
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Commit shortly after typing stops; flush on unmount so nothing is lost.
  const latest = useRef(text);
  latest.current = text;
  const dirty = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(pending.current);
      if (dirty.current) setPresentationText(p.id, latest.current);
    },
    [p.id, setPresentationText],
  );

  const onChange = (value: string) => {
    setText(value);
    dirty.current = true;
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      setPresentationText(p.id, value);
      dirty.current = false;
    }, 300);
  };

  const slideCount = useMemo(() => getSequence(p).length, [p]);

  return (
    <div className="editor">
      <div className="editor-main">
        <textarea
          className="lyrics-input"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
          placeholder={'[Verse 1]\nFirst line of the first slide\nSecond line\n\nNext slide…\n\n[Chorus]\n…'}
        />
        <div className="editor-status muted">
          {p.groups.length} groups · {slideCount} slides in arrangement
        </div>
      </div>
      <aside className="editor-side">
        <label className="field">
          Title
          <input value={p.title} onChange={(e) => updatePresentation(p.id, { title: e.target.value })} />
        </label>
        <label className="field">
          Category
          <select value={p.category} onChange={(e) => updatePresentation(p.id, { category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Author
          <input value={p.author ?? ''} onChange={(e) => updatePresentation(p.id, { author: e.target.value })} />
        </label>
        <label className="field">
          Copyright
          <input value={p.copyright ?? ''} onChange={(e) => updatePresentation(p.id, { copyright: e.target.value })} />
        </label>
        <label className="field">
          CCLI song #
          <input value={p.ccli ?? ''} onChange={(e) => updatePresentation(p.id, { ccli: e.target.value })} />
        </label>
        <div className="help">
          <h4>Formatting</h4>
          <dl>
            <dt>[Chorus]</dt>
            <dd>Starts a group</dd>
            <dt>blank line</dt>
            <dd>Starts a new slide</dd>
            <dt>[Chorus] again</dt>
            <dd>With no lines under it, repeats the group in the arrangement</dd>
            <dt>~ text</dt>
            <dd>Caption under the slide, e.g. a verse reference</dd>
            <dt>&gt; text</dt>
            <dd>Note for the stage display only</dd>
          </dl>
        </div>
      </aside>
    </div>
  );
}
