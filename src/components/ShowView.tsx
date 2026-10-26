import { memo, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent, type Ref } from 'react';
import { getSequence } from '../lyrics';
import { layerOf, useStore } from '../store';
import { inkFor, resolveTheme, slideTheme } from '../theme';
import type { ColorLabel, Presentation, SequenceEntry, Slide, Theme } from '../types';
import { SlidePreview } from './Canvas';
import { openContextMenu, openPopupBelow } from './ContextMenu';
import { slideMenu } from './menus';
import { TargetTransitionPicker, TransitionButton, TransitionGlyph } from './TransitionPicker';
import { Icon, IconButton } from './ui';

/** A slide label's tag on a thumbnail or row. */
export function LabelTag({ label }: { label: ColorLabel }) {
  return (
    <span className="slide-label-tag" style={{ background: label.color, color: inkFor(label.color) }} title={`Label: ${label.name}`}>
      {label.name}
    </span>
  );
}

/** Marks a slide with its own transition; click it to change the transition. */
export function TransitionBadge({ presentationId, slide }: { presentationId: string; slide: Slide }) {
  if (!slide.transition) return null;
  return (
    <button
      type="button"
      className="slide-transition-badge"
      title="This slide has its own transition. Click to change it."
      onClick={(e) => {
        e.stopPropagation();
        openPopupBelow(e.currentTarget, <TargetTransitionPicker target={{ presentationId, scope: { slideId: slide.id } }} />);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <TransitionGlyph kind={slide.transition.kind} size={14} />
    </button>
  );
}

/** Opens a slide's right-click menu (Show mode). */
function slideContextMenu(e: ReactMouseEvent, presentationId: string, entry: SequenceEntry, index: number, playlistItemId: string | null) {
  const p = useStore.getState().presentations[presentationId];
  if (p) openContextMenu(e, slideMenu(p, entry.slide, entry.group, { index, playlistItemId }));
}

export function ShowView() {
  const p = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  const view = useStore((s) => s.settings.slideView);
  const gridSize = useStore((s) => s.settings.gridSize);
  const themeName = useStore((s) => (p ? resolveTheme(s, p).name : ''));
  const s = useStore.getState();

  return (
    <div className="show-view">
      <div className="pres-bar">
        {p ? (
          <>
            <Icon name={p.destination === 'announcements' ? 'megaphone' : p.category === 'scripture' ? 'bible' : 'slides'} size={16} />
            <span className="pres-title">{p.title}</span>
            <span className="pres-bar-spacer" />
            {p.destination === 'announcements' && (
              <span className="pres-chip" title="Its slides show on the Announcements layer, over the slides">
                <Icon name="megaphone" size={13} /> Announcements
              </span>
            )}
            {p.autoAdvance && (
              <span
                className="pres-chip"
                title={`Moves to the next slide every ${p.autoAdvance.seconds} seconds${p.autoAdvance.loop ? ', and starts again after the last' : ''}`}
              >
                <Icon name={p.autoAdvance.loop ? 'repeat' : 'clock'} size={13} /> {p.autoAdvance.seconds}s
              </span>
            )}
            <span className="pres-theme" title="Theme">
              <Icon name="theme" size={13} /> {themeName}
            </span>
            <IconButton icon="reflow" title="Reflow (edit as text)" onClick={() => s.setUI({ mode: 'reflow' })} />
            <IconButton icon="edit" title="Edit slides" onClick={() => s.openEditor()} />
          </>
        ) : (
          <span className="pres-title muted">No presentation selected</span>
        )}
      </div>
      {p ? (
        view === 'list' ? (
          <SlideList presentation={p} />
        ) : (
          <SlideGrid presentation={p} />
        )
      ) : (
        <div className="show-empty">
          <p>Select a presentation from the Library or a Playlist.</p>
          <p className="muted">
            <kbd>→</kbd> <kbd>Space</kbd> next slide · <kbd>←</kbd> previous · <kbd>F1</kbd> clear all
          </p>
        </div>
      )}
      <div className="pane-footer">
        <IconButton
          icon="plus"
          title="Add slide"
          disabled={!p}
          onClick={() => {
            if (!p) return;
            const last = p.groups.at(-1)?.slides.at(-1);
            const id = s.addSlide(p.id, last?.id);
            s.openEditor(id);
          }}
        />
        {p && <TransitionButton target={{ presentationId: p.id, scope: 'presentation' }} className="footer-transition" />}
        <span className="pane-footer-spacer" />
        <IconButton icon="grid" title="Grid view" active={view === 'grid'} onClick={() => s.updateSettings({ slideView: 'grid' })} />
        <IconButton icon="list" title="List view" active={view === 'list'} onClick={() => s.updateSettings({ slideView: 'list' })} />
        <input
          type="range"
          className="pink-range"
          min={140}
          max={420}
          value={gridSize}
          disabled={view === 'list'}
          onChange={(e) => s.updateSettings({ gridSize: Number(e.target.value) })}
          aria-label="Slide size"
          title="Slide size"
        />
      </div>
    </div>
  );
}

function useSlides(p: Presentation) {
  const themes = useStore((s) => s.themes);
  const settings = useStore((s) => s.settings);
  // An announcements presentation is live on the Announcements layer.
  const live = useStore((s) => s.live[layerOf(p)]);
  const base = resolveTheme({ themes, settings }, p);
  const seq = useMemo(() => getSequence(p), [p]);
  const liveIndex = live?.presentationId === p.id ? live.index : -1;
  return { base, seq, liveIndex };
}

function SlideGrid({ presentation: p }: { presentation: Presentation }) {
  const gridSize = useStore((s) => s.settings.gridSize);
  const playlistItemId = useStore((s) => s.selectedPlaylistItemId);
  const { base, seq, liveIndex } = useSlides(p);
  const liveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [liveIndex]);

  if (seq.length === 0) return <NoSlides />;

  return (
    <div className="slide-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` }}>
      {seq.map((entry, i) => (
        <SlideThumb
          key={`${entry.group.id}:${entry.slide.id}:${i}`}
          ref={i === liveIndex ? liveRef : undefined}
          entry={entry}
          index={i}
          theme={slideTheme(base, p, entry.slide)}
          live={i === liveIndex}
          presentationId={p.id}
          playlistItemId={playlistItemId}
        />
      ))}
    </div>
  );
}

function NoSlides() {
  return (
    <div className="show-empty">
      <p>This presentation has no slides yet.</p>
      <button className="btn" onClick={() => useStore.getState().setUI({ mode: 'reflow' })}>
        Type lyrics in Reflow
      </button>
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
  ref?: Ref<HTMLDivElement>;
}) {
  const { group, slide } = entry;
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      className={`slide-thumb ${live ? 'live' : ''}`}
      onClick={() => useStore.getState().goLive(presentationId, index, playlistItemId)}
      onDoubleClick={() => useStore.getState().openEditor(slide.id)}
      onContextMenu={(e) => slideContextMenu(e, presentationId, entry, index, playlistItemId)}
      title="Click to show · Double-click to edit · Right-click for more"
    >
      <div className="slide-thumb-canvas">
        <SlidePreview text={slide.text} caption={slide.caption} theme={theme} background={slide.background} />
        <TransitionBadge presentationId={presentationId} slide={slide} />
      </div>
      <div className="slide-thumb-label" style={{ background: group.color, color: inkFor(group.color) }}>
        <span className="slide-number">{index + 1}</span>
        <span className="slide-group">{entry.indexInGroup === 0 ? group.name : ''}</span>
        {slide.label && <LabelTag label={slide.label} />}
      </div>
    </div>
  );
});

function SlideList({ presentation: p }: { presentation: Presentation }) {
  const playlistItemId = useStore((s) => s.selectedPlaylistItemId);
  const { seq, liveIndex } = useSlides(p);
  if (seq.length === 0) return <NoSlides />;
  return (
    <div className="slide-list">
      {seq.map((entry, i) => {
        const { group, slide, indexInGroup } = entry;
        return (
          <div
            key={`${group.id}:${slide.id}:${i}`}
            role="button"
            tabIndex={-1}
            className={`slide-row ${i === liveIndex ? 'live' : ''}`}
            onClick={() => useStore.getState().goLive(p.id, i, playlistItemId)}
            onDoubleClick={() => useStore.getState().openEditor(slide.id)}
            onContextMenu={(e) => slideContextMenu(e, p.id, entry, i, playlistItemId)}
          >
            <span className="slide-row-label" style={{ background: group.color, color: inkFor(group.color) }}>
              <span className="slide-number">{i + 1}</span>
              {indexInGroup === 0 ? group.name : ''}
            </span>
            <span className="slide-row-text">
              {slide.text || <span className="muted">(blank)</span>}
              <span className="slide-row-tags">
                {slide.label && <LabelTag label={slide.label} />}
                <TransitionBadge presentationId={p.id} slide={slide} />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
