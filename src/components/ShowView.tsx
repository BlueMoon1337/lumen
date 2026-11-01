import { moveSlides } from '../slideOps';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { getSequence } from '../lyrics';
import { layerOf, useStore } from '../store';
import { inkFor, resolveTheme, slideTheme } from '../theme';
import type { ColorLabel, Playlist, Presentation, SequenceEntry, Slide, Theme } from '../types';
import { isSlideshow, slideWords } from '../slideshows';
import { SlidePreview } from './Canvas';
import { openContextMenu, openPopupBelow } from './ContextMenu';
import { clickSlide, selectForMenu } from './editCommands';
import { slideMenu } from './menus';
import { TargetTransitionPicker, TransitionButton, TransitionGlyph } from './TransitionPicker';
import { importMediaFiles } from './MediaBin';
import { DRAG_MEDIA, Icon, IconButton, setDragPreview } from './ui';

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

const dragged = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_MEDIA) || e.dataTransfer.types.includes('Files');

/** Drag payload type for slides being moved within their presentation: `{ presentationId, ids }` as JSON. */
const DRAG_SLIDES = 'application/x-lumen-slides';
/** The presentation slides are being dragged from (drag data can't be read until the drop). */
let draggingFrom: string | null = null;

/**
 * A slide's drag and drop. Drag it (with the other selected slides, if it's one of them) onto
 * another slide of the same presentation to move it there: before or after it, by which half
 * (left or right in the grid, top or bottom in a list). An image or video dropped on it, from the
 * media bin or as a file, becomes its media cue: showing the slide then starts it on the Media
 * layer, as in ProPresenter.
 */
export function useMediaDrop(presentationId: string, slideId: string, axis: 'x' | 'y' = 'x') {
  const [over, setOver] = useState(false);
  const [moveAt, setMoveAt] = useState<'before' | 'after' | null>(null);
  const set = (media: string) => useStore.getState().updateSlide(presentationId, slideId, { media });
  const side = (e: DragEvent): 'before' | 'after' => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return (axis === 'x' ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) ? 'before' : 'after';
  };
  const slidesDragged = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_SLIDES) && draggingFrom === presentationId;
  return {
    over,
    moveAt,
    draggable: true,
    onDragStart: (e: DragEvent) => {
      const s = useStore.getState();
      const ids = s.selectedPresentationId === presentationId && s.selectedSlideIds.includes(slideId) ? s.selectedSlideIds : [slideId];
      draggingFrom = presentationId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_SLIDES, JSON.stringify({ presentationId, ids }));
      setDragPreview(e, e.currentTarget as HTMLElement, ids.length);
    },
    onDragEnd: () => {
      draggingFrom = null;
    },
    onDragOver: (e: DragEvent) => {
      if (slidesDragged(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setMoveAt(side(e));
        return;
      }
      if (!dragged(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(true);
    },
    onDragLeave: () => {
      setOver(false);
      setMoveAt(null);
    },
    onDrop: (e: DragEvent) => {
      if (slidesDragged(e)) {
        e.preventDefault();
        e.stopPropagation();
        setMoveAt(null);
        draggingFrom = null;
        try {
          const data = JSON.parse(e.dataTransfer.getData(DRAG_SLIDES)) as { presentationId: string; ids: string[] };
          const p = useStore.getState().presentations[presentationId];
          if (p && data.presentationId === presentationId)
            useStore.getState().updatePresentation(presentationId, moveSlides(p, data.ids, slideId, side(e) === 'after'));
        } catch {
          // Not slides from here.
        }
        return;
      }
      if (!dragged(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const id = e.dataTransfer.getData(DRAG_MEDIA);
      if (id) return set(id);
      void importMediaFiles(Array.from(e.dataTransfer.files)).then((added) => {
        const first = added.find((m) => m.kind !== 'audio');
        if (first) set(first.id);
      });
    },
  };
}

/**
 * Slides dragged into the open space after the last slide (to its right, or below it) go to the
 * end, as in ProPresenter: the last slide shows the line after it while they're over that space.
 */
function useEndDrop(presentationId: string, lastSlideId: string | undefined, axis: 'x' | 'y') {
  const [atEnd, setAtEnd] = useState(false);
  const beyondLast = (e: DragEvent) => {
    const slides = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-slide-id]');
    const last = slides[slides.length - 1];
    if (!last || (e.target as Element).closest('[data-slide-id]')) return false;
    const r = last.getBoundingClientRect();
    return e.clientY > r.bottom || (axis === 'x' && e.clientY >= r.top && e.clientX > r.right);
  };
  const slidesHere = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_SLIDES) && draggingFrom === presentationId;
  return {
    atEnd,
    onDragOver: (e: DragEvent) => {
      const end = slidesHere(e) && beyondLast(e);
      if (end) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
      if (end !== atEnd) setAtEnd(end);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setAtEnd(false);
    },
    onDrop: (e: DragEvent) => {
      if (!slidesHere(e) || !beyondLast(e) || !lastSlideId) return;
      e.preventDefault();
      setAtEnd(false);
      draggingFrom = null;
      try {
        const data = JSON.parse(e.dataTransfer.getData(DRAG_SLIDES)) as { presentationId: string; ids: string[] };
        const p = useStore.getState().presentations[presentationId];
        if (p && data.presentationId === presentationId) {
          // The last slide moving too: the rest go after the last one that isn't.
          const order = p.groups.flatMap((g) => g.slides.map((sl) => sl.id));
          const target = [...order].reverse().find((id) => !data.ids.includes(id));
          if (target) useStore.getState().updatePresentation(presentationId, moveSlides(p, data.ids, target, true));
        }
      } catch {
        // Not slides from here.
      }
    },
  };
}

/** Marks a slide with a media cue; click it to see which, or take it off. */
export function MediaBadge({ presentationId, slide }: { presentationId: string; slide: Slide }) {
  const item = useStore((s) => s.media.find((m) => m.id === slide.media));
  if (!slide.media || !item) return null;
  return (
    <button
      type="button"
      className="slide-media-badge"
      title={`Plays “${item.name}” on the Media layer when this slide is shown`}
      onClick={(e) => {
        e.stopPropagation();
        openContextMenu(e, [
          { header: item.name },
          { label: 'Show Now', action: () => useStore.getState().setLiveMedia(item.id) },
          { label: 'Remove from Slide', action: () => useStore.getState().updateSlide(presentationId, slide.id, { media: undefined }) },
        ]);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Icon name={item.kind === 'video' ? 'film' : 'image'} size={13} />
    </button>
  );
}

/** Opens a slide's right-click menu (Show mode). */
function slideContextMenu(e: ReactMouseEvent, presentationId: string, entry: SequenceEntry, index: number, playlistItemId: string | null) {
  const p = useStore.getState().presentations[presentationId];
  if (!p) return;
  selectForMenu(entry.slide.id);
  // Panels from the menu (Label ▸ Edit…) open under the slide.
  const anchor = e.currentTarget as Element;
  openContextMenu(e, slideMenu(p, entry.slide, entry.group, { index, playlistItemId, anchor }));
}

/** Show mode's slides: the selected presentation's, or with View ▸ Continuous Playlist, every presentation in the playlist. */
export function ShowView() {
  const p = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  const view = useStore((s) => s.settings.slideView);
  const gridSize = useStore((s) => s.settings.gridSize);
  const playlist = useStore((s) =>
    s.settings.continuousPlaylist && s.sidebar === 'playlist' ? s.playlists.find((pl) => pl.id === s.activePlaylistId) : undefined,
  );
  const s = useStore.getState();

  return (
    <div className="show-view">
      {playlist ? (
        <ContinuousPlaylist playlist={playlist} />
      ) : (
        <>
          {p ? (
            <PresentationBar presentation={p} />
          ) : (
            <div className="pres-bar">
              <span className="pres-title muted">No presentation selected</span>
            </div>
          )}
          {p ? (
            <Slides presentation={p} />
          ) : (
            <div className="show-empty">
              <p>Select a presentation from the Library or a Playlist.</p>
              <p className="muted">
                <kbd>→</kbd> <kbd>Space</kbd> next slide · <kbd>←</kbd> previous · <kbd>F1</kbd> clear all
              </p>
            </div>
          )}
        </>
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
        <IconButton icon="grid" title="Grid View" active={view === 'grid'} onClick={() => s.updateSettings({ slideView: 'grid' })} />
        <IconButton icon="text" title="Easy View" active={view === 'easy'} onClick={() => s.updateSettings({ slideView: 'easy' })} />
        <IconButton icon="list" title="Table View" active={view === 'list'} onClick={() => s.updateSettings({ slideView: 'list' })} />
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

function PresentationBar({ presentation: p, playlistItemId }: { presentation: Presentation; playlistItemId?: string }) {
  const themeName = useStore((s) => resolveTheme(s, p).name);
  const selected = useStore((s) => playlistItemId !== undefined && s.selectedPlaylistItemId === playlistItemId);
  const s = useStore.getState();
  // In a continuous playlist, the bar picks its presentation (for Edit, the Text and Theme panels…).
  const pick = () => playlistItemId !== undefined && s.select(p.id, playlistItemId);
  return (
    <div className={`pres-bar ${playlistItemId !== undefined ? 'cp-bar' : ''} ${selected ? 'selected' : ''}`} onClick={pick}>
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
      {isSlideshow(p) ? (
        <span className="pres-chip" title={`Imported from ${p.source?.fileName}`}>
          <Icon name="slides" size={13} /> {p.source?.kind === 'keynote' ? 'Keynote' : 'PowerPoint'}
        </span>
      ) : (
        <IconButton icon="reflow" title="Reflow (edit as text)" onClick={() => (pick(), s.setUI({ mode: 'reflow' }))} />
      )}
      <IconButton icon="edit" title="Edit slides" onClick={() => (pick(), s.openEditor())} />
    </div>
  );
}

/** A presentation's slides in the chosen Slide View. In a continuous playlist they're one section of a longer list. */
function Slides({ presentation: p, playlistItemId }: { presentation: Presentation; playlistItemId?: string }) {
  const view = useStore((s) => s.settings.slideView);
  return view === 'list' ? (
    <SlideList presentation={p} playlistItemId={playlistItemId} />
  ) : (
    <SlideGrid presentation={p} playlistItemId={playlistItemId} easy={view === 'easy'} />
  );
}

/**
 * View ▸ Continuous Playlist: the playlist's presentations one after another, each under its own
 * bar, with the playlist's headers between them. Picking an item in the sidebar scrolls to it.
 */
function ContinuousPlaylist({ playlist }: { playlist: Playlist }) {
  const presentations = useStore((s) => s.presentations);
  const selectedItem = useStore((s) => s.selectedPlaylistItemId);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedItem) return;
    const section = ref.current?.querySelector(`[data-item="${CSS.escape(selectedItem)}"]`);
    // Unless a slide in it is already showing (clicking a slide selects its item too).
    if (section && !section.contains(document.activeElement)) section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedItem]);
  const items = playlist.items.filter(
    (it) => it.type === 'header' || (presentations[it.presentationId] && !presentations[it.presentationId].hidden),
  );
  return (
    <div ref={ref} className="continuous-playlist">
      {items.map((it) =>
        it.type === 'header' ? (
          <div key={it.id} className="cp-header">
            {it.label}
          </div>
        ) : (
          <section key={it.id} className="cp-item" data-item={it.id}>
            <PresentationBar presentation={presentations[it.presentationId]} playlistItemId={it.id} />
            <Slides presentation={presentations[it.presentationId]} playlistItemId={it.id} />
          </section>
        ),
      )}
      {items.length === 0 && (
        <div className="show-empty">
          <p>This playlist is empty. Drag presentations onto it from the Library.</p>
        </div>
      )}
    </div>
  );
}

/** The playlist item a section's slides go live from: its own in a continuous playlist, else the selected one. */
function useItemId(own: string | undefined) {
  const selected = useStore((s) => s.selectedPlaylistItemId);
  return own ?? selected;
}

/**
 * Selecting slides by dragging a box over them from the space around them, as in ProPresenter.
 * ⌘ or ⇧ adds to the slides already selected; a click on empty space selects none.
 */
function useMarquee(presentationId: string, playlistItemId: string | null, continuous: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0 || (e.target as Element).closest('[data-slide-id], button, input')) return;
    e.preventDefault();
    const s = useStore.getState();
    if (s.selectedPresentationId !== presentationId) s.select(presentationId, continuous ? playlistItemId : s.selectedPlaylistItemId);
    const adding = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = adding ? useStore.getState().selectedSlideIds : [];
    // Positions inside the list, so the box stays put on the slides when the list scrolls.
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { x: x - r.left + el.scrollLeft, y: y - r.top + el.scrollTop };
    };
    const start = local(e.clientX, e.clientY);
    let last = { x: e.clientX, y: e.clientY };
    let moved = false;
    const update = () => {
      const now = local(last.x, last.y);
      const rect = {
        left: Math.min(start.x, now.x),
        top: Math.min(start.y, now.y),
        width: Math.abs(now.x - start.x),
        height: Math.abs(now.y - start.y),
      };
      setBox(rect);
      const hits: string[] = [];
      for (const slide of el.querySelectorAll<HTMLElement>('[data-slide-id]')) {
        const r = slide.getBoundingClientRect();
        const a = local(r.left, r.top);
        if (a.x < rect.left + rect.width && a.x + r.width > rect.left && a.y < rect.top + rect.height && a.y + r.height > rect.top)
          hits.push(slide.dataset.slideId!);
      }
      const ids = [...new Set([...base, ...hits])];
      const current = useStore.getState().selectedSlideIds;
      if (ids.length !== current.length || ids.some((id, i) => id !== current[i])) useStore.getState().setUI({ selectedSlideIds: ids });
    };
    // Near the top or bottom edge, the list scrolls along.
    const scroller = (el.scrollHeight > el.clientHeight ? el : el.closest('.continuous-playlist')) as HTMLElement | null;
    const timer = window.setInterval(() => {
      if (!moved || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const dy = last.y < r.top + 30 ? -12 : last.y > r.bottom - 30 ? 12 : 0;
      if (dy) {
        scroller.scrollTop += dy;
        update();
      }
    }, 30);
    const onMove = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true;
      update();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.clearInterval(timer);
      setBox(null);
      if (!moved && !adding) useStore.getState().setUI({ selectedSlideIds: [] });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const marquee = box && <div className="marquee" style={box} />;
  return { ref, onPointerDown, marquee };
}

/** Clicking a slide: shows it, and in a continuous playlist selects its presentation too. */
function clickToShow(
  e: ReactMouseEvent,
  presentationId: string,
  slideId: string,
  index: number,
  playlistItemId: string | null,
  continuous: boolean,
) {
  const s = useStore.getState();
  if (continuous && (s.selectedPresentationId !== presentationId || s.selectedPlaylistItemId !== playlistItemId))
    s.select(presentationId, playlistItemId);
  if (clickSlide(e, presentationId, slideId)) useStore.getState().goLive(presentationId, index, playlistItemId);
}

function useSlides(p: Presentation, playlistItemId?: string) {
  const themes = useStore((s) => s.themes);
  const settings = useStore((s) => s.settings);
  // An announcements presentation is live on the Announcements layer.
  const live = useStore((s) => s.live[layerOf(p)]);
  const base = resolveTheme({ themes, settings }, p);
  const seq = useMemo(() => getSequence(p), [p]);
  // In a continuous playlist the same song can be in it twice: only the item it was shown from is live.
  const here = live?.presentationId === p.id && (!playlistItemId || !live.playlistItemId || live.playlistItemId === playlistItemId);
  const liveIndex = here && live ? live.index : -1;
  const liveId = seq[liveIndex]?.slide.id;
  useEffect(() => {
    // The selection follows the slide on screen as it changes, unless several are selected.
    const s = useStore.getState();
    if (liveId && s.selectedPresentationId === p.id && s.selectedSlideIds.length <= 1 && s.selectedSlideIds[0] !== liveId)
      s.setUI({ selectedSlideIds: [liveId] });
  }, [liveId, p.id]);
  return { base, seq, liveIndex };
}

function SlideGrid({ presentation: p, playlistItemId: own, easy }: { presentation: Presentation; playlistItemId?: string; easy: boolean }) {
  const gridSize = useStore((s) => s.settings.gridSize);
  const playlistItemId = useItemId(own);
  const { base, seq, liveIndex } = useSlides(p, own);
  const liveRef = useRef<HTMLDivElement>(null);
  const marquee = useMarquee(p.id, playlistItemId, !!own);
  const { atEnd, ...endDrop } = useEndDrop(p.id, seq.at(-1)?.slide.id, 'x');

  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [liveIndex]);

  if (seq.length === 0) return <NoSlides />;

  return (
    <div
      ref={marquee.ref}
      className={`slide-grid ${easy ? 'easy' : ''} ${own ? 'inline' : ''}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` }}
      onPointerDown={marquee.onPointerDown}
      {...endDrop}
    >
      {marquee.marquee}
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
          continuous={!!own}
          easy={easy}
          lineAfter={atEnd && i === seq.length - 1}
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
  continuous,
  easy,
  lineAfter,
  ref,
}: {
  entry: SequenceEntry;
  index: number;
  theme: Theme;
  live: boolean;
  presentationId: string;
  playlistItemId: string | null;
  continuous: boolean;
  /** Easy View: just the words, large, white on black. */
  easy: boolean;
  /** Slides are being dragged into the open space after this, the last slide. */
  lineAfter?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  const { group, slide } = entry;
  const { over, moveAt: dropAt, ...drop } = useMediaDrop(presentationId, slide.id);
  const moveAt = dropAt ?? (lineAfter ? 'after' : null);
  const selected = useStore((s) => s.selectedSlideIds.includes(slide.id));
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      data-slide-id={slide.id}
      className={`slide-thumb ${live ? 'live' : ''} ${selected ? 'selected' : ''} ${over ? 'drop-media' : ''} ${moveAt ? `move-${moveAt}` : ''}`}
      {...drop}
      onClick={(e) => clickToShow(e, presentationId, slide.id, index, playlistItemId, continuous)}
      onDoubleClick={() => useStore.getState().openEditor(slide.id)}
      onContextMenu={(e) => slideContextMenu(e, presentationId, entry, index, playlistItemId)}
      title="Click to show · ⌘-click or ⇧-click to select more · Drag to reorder · Double-click to edit · Right-click for more"
    >
      <div className="slide-thumb-canvas">
        {easy ? (
          <div className="easy-text">{slideWords(slide) || slide.caption}</div>
        ) : (
          <SlidePreview
            text={slide.text}
            caption={slide.caption}
            theme={theme}
            background={slide.background}
            media={slide.media}
            picture={slide.source?.picture}
          />
        )}
        <MediaBadge presentationId={presentationId} slide={slide} />
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

function SlideList({ presentation: p, playlistItemId: own }: { presentation: Presentation; playlistItemId?: string }) {
  const playlistItemId = useItemId(own);
  const { base, seq, liveIndex } = useSlides(p, own);
  const marquee = useMarquee(p.id, playlistItemId, !!own);
  const { atEnd, ...endDrop } = useEndDrop(p.id, seq.at(-1)?.slide.id, 'y');
  if (seq.length === 0) return <NoSlides />;
  return (
    <div ref={marquee.ref} className={`slide-list ${own ? 'inline' : ''}`} onPointerDown={marquee.onPointerDown} {...endDrop}>
      {marquee.marquee}
      {seq.map((entry, i) => (
        <SlideRow
          key={`${entry.group.id}:${entry.slide.id}:${i}`}
          presentationId={p.id}
          entry={entry}
          index={i}
          theme={slideTheme(base, p, entry.slide)}
          live={i === liveIndex}
          playlistItemId={playlistItemId}
          continuous={!!own}
          lineAfter={atEnd && i === seq.length - 1}
        />
      ))}
    </div>
  );
}

function SlideRow({
  presentationId,
  entry,
  index,
  theme,
  live,
  playlistItemId,
  continuous,
  lineAfter,
}: {
  presentationId: string;
  entry: SequenceEntry;
  index: number;
  theme: Theme;
  live: boolean;
  playlistItemId: string | null;
  continuous: boolean;
  /** Slides are being dragged into the open space after this, the last slide. */
  lineAfter?: boolean;
}) {
  const { group, slide, indexInGroup } = entry;
  const { over, moveAt: dropAt, ...drop } = useMediaDrop(presentationId, slide.id, 'y');
  const moveAt = dropAt ?? (lineAfter ? 'after' : null);
  const selected = useStore((s) => s.selectedSlideIds.includes(slide.id));
  return (
    <div
      role="button"
      tabIndex={-1}
      data-slide-id={slide.id}
      className={`slide-row ${live ? 'live' : ''} ${selected ? 'selected' : ''} ${over ? 'drop-media' : ''} ${moveAt ? `move-${moveAt}` : ''}`}
      {...drop}
      onClick={(e) => clickToShow(e, presentationId, slide.id, index, playlistItemId, continuous)}
      onDoubleClick={() => useStore.getState().openEditor(slide.id)}
      onContextMenu={(e) => slideContextMenu(e, presentationId, entry, index, playlistItemId)}
    >
      <span className="slide-row-label" style={{ background: group.color, color: inkFor(group.color) }}>
        <span className="slide-number">{index + 1}.</span>
        {indexInGroup === 0 ? group.name : ''}
      </span>
      <span className="slide-row-thumb">
        <SlidePreview
          text={slide.text}
          caption={slide.caption}
          theme={theme}
          background={slide.background}
          media={slide.media}
          picture={slide.source?.picture}
        />
      </span>
      <span className="slide-row-text">
        {slideWords(slide) || <span className="muted">(blank)</span>}
        <span className="slide-row-tags">
          {slide.label && <LabelTag label={slide.label} />}
          <MediaBadge presentationId={presentationId} slide={slide} />
          <TransitionBadge presentationId={presentationId} slide={slide} />
        </span>
      </span>
    </div>
  );
}
