import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useMedia } from '../media';
import { useStore } from '../store';
import { applyStyles, FONT_CHOICES, inkFor, resolveTheme, slideTheme, toFrameBackground } from '../theme';
import type { Category, Group, MediaItem, Presentation, Slide, TextStyle, Theme, ThemeBackground } from '../types';
import { BackgroundFill, CANVAS_H, CANVAS_W, slideBoxStyle, SlidePreview, SlideText, slideTextStyle } from './Canvas';
import { LIBRARIES } from './Sidebar';
import { AlignButtons } from './Toolbar';
import { Icon, IconButton, Popover } from './ui';

export function findSlide(p: Presentation, id: string | null): { group: Group; slide: Slide } | null {
  for (const group of p.groups) {
    const slide = group.slides.find((s) => s.id === id);
    if (slide) return { group, slide };
  }
  return null;
}

function useBaseTheme(p: Presentation) {
  const themes = useStore((s) => s.themes);
  const settings = useStore((s) => s.settings);
  return resolveTheme({ themes, settings }, p);
}

export function NoPresentation() {
  return (
    <div className="edit-empty">
      <p>Select a presentation in Show mode first.</p>
      <button className="btn" onClick={() => useStore.getState().setUI({ mode: 'show' })}>
        Back to Show
      </button>
    </div>
  );
}

export function EditView() {
  const p = useStore((s) => (s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined));
  const editSlideId = useStore((s) => s.editSlideId);
  const found = p ? findSlide(p, editSlideId) : null;
  const first = p?.groups[0]?.slides[0];

  // Land on the first slide when nothing (or a slide that no longer exists) is selected.
  useEffect(() => {
    if (!found && first) useStore.getState().setUI({ editSlideId: first.id });
  }, [found, first]);

  if (!p) return <NoPresentation />;
  return (
    <>
      <EditOutline presentation={p} showObjects />
      <main className="edit-center">
        <EditCanvas presentation={p} slide={found?.slide ?? null} />
      </main>
      <Inspector presentation={p} slide={found?.slide} group={found?.group} />
    </>
  );
}

// ---- Left: slide outline -------------------------------------------------

export function EditOutline({ presentation: p, showObjects }: { presentation: Presentation; showObjects?: boolean }) {
  const selectedId = useStore((s) => s.editSlideId);
  const mode = useStore((s) => s.mode);
  const textSelected = useStore((s) => s.editTextSelected);
  const base = useBaseTheme(p);
  const s = useStore.getState();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let counter = 0;
  return (
    <aside className="outline">
      <div className="outline-header">
        <span className="list-label">{p.title}</span>
        <IconButton
          icon="plus"
          title="Add slide"
          onClick={() => {
            const id = s.addSlide(p.id, selectedId);
            s.openEditor(id);
          }}
        />
      </div>
      <div className="outline-list">
        {p.groups.map((g) => {
          const start = counter;
          counter += g.slides.length;
          const open = !collapsed.has(g.id);
          return (
            <section key={g.id} className="outline-group" style={{ '--group': g.color, '--ink': inkFor(g.color) } as CSSProperties}>
              <button className="outline-group-header" onClick={() => toggle(g.id)}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
                <span className="list-label">{g.name}</span>
              </button>
              {open &&
                g.slides.map((sl, i) => (
                  <div
                    key={sl.id}
                    ref={sl.id === selectedId ? selectedRef : undefined}
                    className={`outline-slide ${sl.id === selectedId && mode === 'edit' ? 'selected' : ''}`}
                    onClick={() => s.setUI({ mode: 'edit', editSlideId: sl.id, editTextSelected: false })}
                  >
                    <div className="outline-thumb">
                      <SlidePreview text={sl.text} caption={sl.caption} theme={slideTheme(base, p, sl)} background={sl.background} />
                    </div>
                    <span className="outline-num">{start + i + 1}.</span>
                  </div>
                ))}
            </section>
          );
        })}
        {p.groups.length === 0 && <p className="empty">No slides yet. Press + to add one.</p>}
      </div>
      {showObjects && (
        <div className="objects">
          <div className="objects-header">Objects</div>
          <div className={`object-row ${textSelected ? 'selected' : ''}`} onClick={() => s.setUI({ editTextSelected: true })}>
            <span className="object-glyph">T</span>
            TextElement
          </div>
        </div>
      )}
    </aside>
  );
}

// ---- Center: canvas ------------------------------------------------------

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const RULER = 20;
const TOOLBAR_SPACE = 64;
const PAD = 36;
const MIN_SIZE = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

/** New insets (percent of the canvas) after dragging `handle` by dx/dy percent. */
export function adjustInset(i: Theme['inset'], handle: Handle, dx: number, dy: number): Theme['inset'] {
  let { top, right, bottom, left } = i;
  if (handle === 'move') {
    const mx = clamp(dx, -left, right);
    const my = clamp(dy, -top, bottom);
    return { top: round(top + my), bottom: round(bottom - my), left: round(left + mx), right: round(right - mx) };
  }
  if (handle.includes('n')) top = clamp(top + dy, 0, 100 - bottom - MIN_SIZE);
  if (handle.includes('s')) bottom = clamp(bottom - dy, 0, 100 - top - MIN_SIZE);
  if (handle.includes('w')) left = clamp(left + dx, 0, 100 - right - MIN_SIZE);
  if (handle.includes('e')) right = clamp(right - dx, 0, 100 - left - MIN_SIZE);
  return { top: round(top), right: round(right), bottom: round(bottom), left: round(left) };
}

function Rulers({ left, top, scale, width, height }: { left: number; top: number; scale: number; width: number; height: number }) {
  const minor = 50 * scale >= 6 ? 50 : 100;
  const major = 500 * scale >= 60 ? 500 : 1000;
  const ticks = (origin: number, length: number) => {
    const out: { pos: number; v: number; label: boolean }[] = [];
    const from = Math.ceil((RULER - origin) / scale / minor) * minor;
    const to = (length - origin) / scale;
    for (let v = from; v <= to; v += minor) out.push({ pos: origin + v * scale, v, label: v % major === 0 });
    return out;
  };
  return (
    <>
      <svg className="ruler ruler-top" width={width} height={RULER}>
        {ticks(left, width).map((t) => (
          <g key={t.v}>
            <line x1={t.pos} x2={t.pos} y1={t.label ? 4 : RULER - 5} y2={RULER} />
            {t.label && (
              <text x={t.pos + 3} y={11}>
                {t.v.toLocaleString()}
              </text>
            )}
          </g>
        ))}
      </svg>
      <svg className="ruler ruler-left" width={RULER} height={height}>
        {ticks(top, height).map((t) => (
          <g key={t.v}>
            <line y1={t.pos} y2={t.pos} x1={t.label ? 4 : RULER - 5} x2={RULER} />
            {t.label && (
              <text transform={`translate(11 ${t.pos + 3}) rotate(-90)`} textAnchor="end">
                {t.v.toLocaleString()}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="ruler-corner" />
    </>
  );
}

/** Plain-text editing directly on the slide, styled exactly like the rendered text. */
function TextEditor({
  theme,
  fontSize,
  initial,
  onDone,
}: {
  theme: Theme;
  fontSize: number;
  initial: string;
  onDone: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = initial;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [initial]);
  return (
    <div className="slide-box" style={slideBoxStyle(theme)}>
      <div
        ref={ref}
        className="slide-content text-editing"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        style={slideTextStyle(theme, fontSize)}
        onBlur={() => onDone(cancelled.current ? initial : (ref.current?.innerText ?? initial).replace(/\n+$/, ''))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            cancelled.current = true;
            ref.current?.blur();
          }
        }}
      />
    </div>
  );
}

function MediaChoice({ item, onPick }: { item: MediaItem; onPick: () => void }) {
  const media = useMedia(item.id);
  return (
    <button className="media-choice" onClick={onPick} title={item.name}>
      {media && (item.kind === 'video' ? <video src={`${media.url}#t=0.5`} muted preload="metadata" /> : <img src={media.url} alt="" />)}
      <span>{item.name}</span>
    </button>
  );
}

function BackgroundPicker({
  kind,
  presentationId,
  slide,
  onDone,
}: {
  kind: 'image' | 'video' | 'color';
  presentationId: string;
  slide: Slide;
  onDone: () => void;
}) {
  const media = useStore((s) => s.media.filter((m) => m.kind === kind));
  const s = useStore.getState();
  const set = (background: ThemeBackground | undefined) => {
    s.updateSlide(presentationId, slide.id, { background });
    if (kind !== 'color') onDone();
  };
  return (
    <div className="bg-picker">
      <div className="pop-title">{kind === 'color' ? 'Slide background color' : `Slide background ${kind}`}</div>
      {kind === 'color' ? (
        <label className="pop-row">
          <input
            type="color"
            value={slide.background?.type === 'color' ? slide.background.color : '#202124'}
            onChange={(e) => set({ type: 'color', color: e.target.value, color2: e.target.value })}
          />
          <span className="muted">Pick a color for this slide</span>
        </label>
      ) : media.length ? (
        <div className="media-choices">
          {media.map((m) => (
            <MediaChoice key={m.id} item={m} onPick={() => set({ type: 'media', mediaId: m.id, color: '#000000', color2: '#000000' })} />
          ))}
        </div>
      ) : (
        <p className="pop-empty">Import {kind === 'image' ? 'images' : 'videos'} in the Media bin (Show mode) first.</p>
      )}
      <div className="pop-foot">
        <button className="btn small" disabled={!slide.background} onClick={() => set(undefined)}>
          Use theme background
        </button>
      </div>
    </div>
  );
}

export function EditCanvas({ presentation: p, slide }: { presentation: Presentation; slide: Slide | null }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [editing, setEditing] = useState(false);
  const [editSize, setEditSize] = useState(0);
  const [draft, setDraft] = useState<Theme['inset'] | null>(null);
  const [picker, setPicker] = useState<'image' | 'video' | 'color' | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selected = useStore((s) => s.editTextSelected);
  const base = useBaseTheme(p);
  const s = useStore.getState();
  const theme = slideTheme(base, p, slide ?? undefined);
  const shown = draft ? { ...theme, inset: draft } : theme;

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setPicker(null);
  }, [slide?.id]);

  const innerW = area.w - RULER;
  const innerH = area.h - RULER;
  const scale = Math.max(0.05, Math.min((innerW - PAD * 2) / CANVAS_W, (innerH - TOOLBAR_SPACE - PAD) / CANVAS_H));
  const cw = CANVAS_W * scale;
  const ch = CANVAS_H * scale;
  const left = RULER + (innerW - cw) / 2;
  const top = RULER + TOOLBAR_SPACE + Math.max(0, (innerH - TOOLBAR_SPACE - PAD - ch) / 2);
  const inset = shown.inset;
  const box = {
    left: left + (inset.left / 100) * cw,
    top: top + (inset.top / 100) * ch,
    width: ((100 - inset.left - inset.right) / 100) * cw,
    height: ((100 - inset.top - inset.bottom) / 100) * ch,
  };

  const commitInset = (next: Theme['inset']) => slide && s.updateSlide(p.id, slide.id, { style: { ...slide.style, inset: next } });

  const startEditing = () => {
    if (!slide) return;
    const rendered = slideRef.current?.querySelector<HTMLElement>('.slide-content');
    setEditSize(parseFloat(rendered?.style.fontSize ?? '') || theme.fontSize);
    s.setUI({ editTextSelected: true });
    setEditing(true);
  };

  const startDrag = (e: ReactPointerEvent, handle: Handle) => {
    if (!slide || editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    areaRef.current?.focus();
    s.setUI({ editTextSelected: true });
    const start = { x: e.clientX, y: e.clientY, inset: { ...theme.inset } };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return;
      moved = true;
      setDraft(adjustInset(start.inset, handle, ((ev.clientX - start.x) / cw) * 100, ((ev.clientY - start.y) / ch) * 100));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved && draftRef.current) commitInset(draftRef.current);
      setDraft(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!slide || editing || !selected) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      commitInset(adjustInset(theme.inset, 'move', (move[0] / CANVAS_W) * 100, (move[1] / CANVAS_H) * 100));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      startEditing();
    } else if (e.key === 'Escape') {
      s.setUI({ editTextSelected: false });
    }
  };

  const fill = slide ? toFrameBackground(slide.background ?? theme.background) : null;

  return (
    <div
      ref={areaRef}
      className="edit-area"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.element-frame, .float-toolbar')) s.setUI({ editTextSelected: false });
      }}
    >
      {area.w > 0 && <Rulers left={left} top={top} scale={scale} width={area.w} height={area.h} />}
      <div className="float-toolbar" style={{ left: RULER + innerW / 2 }}>
        <button title="Edit text (Enter)" disabled={!slide} onClick={startEditing}>
          <span className="ft-glyph">T</span>
        </button>
        {(['image', 'video', 'color'] as const).map((kind) => (
          <div key={kind} className="popover-anchor">
            <button
              title={kind === 'color' ? 'Slide background color' : `Slide background ${kind}`}
              disabled={!slide}
              className={picker === kind ? 'active' : ''}
              onClick={() => setPicker(picker === kind ? null : kind)}
            >
              <Icon name={kind === 'color' ? 'fill' : kind} size={18} />
            </button>
            {slide && (
              <Popover open={picker === kind} onClose={() => setPicker(null)} align="center" className="picker-pop">
                <BackgroundPicker kind={kind} presentationId={p.id} slide={slide} onDone={() => setPicker(null)} />
              </Popover>
            )}
          </div>
        ))}
      </div>
      {slide ? (
        <>
          <div ref={slideRef} className="edit-slide" style={{ left, top, width: cw, height: ch }}>
            <div className="edit-slide-inner" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}>
              <div className="fill" style={{ background: '#202124' }} />
              {fill && <BackgroundFill bg={fill} />}
              <div className="fill" style={{ visibility: editing ? 'hidden' : 'visible' }}>
                <SlideText text={slide.text} caption={slide.caption} theme={shown} />
              </div>
              {editing && (
                <TextEditor
                  theme={theme}
                  fontSize={editSize}
                  initial={slide.text}
                  onDone={(text) => {
                    setEditing(false);
                    if (text !== slide.text) s.updateSlide(p.id, slide.id, { text });
                  }}
                />
              )}
            </div>
          </div>
          {!editing && (
            <div
              className={`element-frame ${selected ? 'selected' : ''}`}
              style={box}
              onPointerDown={(e) => startDrag(e, 'move')}
              onDoubleClick={startEditing}
              title="Drag to move · Double-click to edit text"
            >
              {!slide.text && <span className="element-placeholder">Double-click to add text</span>}
              {selected && HANDLES.map((h) => <span key={h} className={`handle ${h}`} onPointerDown={(e) => startDrag(e, h)} />)}
            </div>
          )}
          {draft && (
            <div className="drag-readout" style={{ left: box.left, top: box.top + box.height + 6 }}>
              {Math.round((inset.left / 100) * CANVAS_W)}, {Math.round((inset.top / 100) * CANVAS_H)} ·{' '}
              {Math.round((box.width / cw) * CANVAS_W)} × {Math.round((box.height / ch) * CANVAS_H)}
            </div>
          )}
        </>
      ) : (
        <div className="edit-slide empty" style={{ left, top, width: cw, height: ch }}>
          <span>No slide selected</span>
        </div>
      )}
    </div>
  );
}

// ---- Right: inspector ----------------------------------------------------

type InspectorTab = 'presentation' | 'slide' | 'text';
const TAB_LABELS: Record<InspectorTab, string> = { presentation: 'Presentation', slide: 'Slide', text: 'Text' };

export function Inspector({
  presentation: p,
  slide,
  group,
  tabs = ['presentation', 'slide', 'text'],
  footer,
}: {
  presentation: Presentation;
  slide?: Slide;
  group?: Group;
  tabs?: InspectorTab[];
  footer?: ReactNode;
}) {
  const textSelected = useStore((s) => s.editTextSelected);
  const [tab, setTab] = useState<InspectorTab>(tabs[0]);
  const hasTextTab = tabs.includes('text');

  // Selecting the text element on the canvas brings up its formatting, as in ProPresenter.
  useEffect(() => {
    if (textSelected && hasTextTab) setTab('text');
  }, [textSelected, hasTextTab]);

  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {tabs.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'presentation' && <PresentationTab presentation={p} />}
        {tab === 'slide' &&
          (slide && group ? <SlideTab presentation={p} slide={slide} group={group} /> : <p className="insp-empty">Select a slide.</p>)}
        {tab === 'text' && (slide ? <TextTab presentation={p} slide={slide} /> : <p className="insp-empty">Select a slide.</p>)}
        {footer}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="insp-row">
      <span className="insp-label">{label}</span>
      <span className="insp-control">{children}</span>
    </label>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

const TRANSITIONS = [
  { value: '', label: 'Default (Settings)' },
  { value: '0', label: 'Cut' },
  { value: '250', label: 'Fade · 0.25s' },
  { value: '500', label: 'Fade · 0.5s' },
  { value: '1000', label: 'Fade · 1s' },
  { value: '2000', label: 'Fade · 2s' },
];

function PresentationTab({ presentation: p }: { presentation: Presentation }) {
  const themes = useStore((s) => s.themes);
  const s = useStore.getState();
  const update = (patch: Partial<Presentation>) => s.updatePresentation(p.id, patch);
  const text = (key: 'title' | 'artist' | 'author' | 'album' | 'publisher' | 'year' | 'ccli' | 'copyright', label: string) => (
    <Field label={label}>
      <input value={p[key] ?? ''} onChange={(e) => update({ [key]: e.target.value })} />
    </Field>
  );
  return (
    <>
      <section className="insp-section">
        <Field label="Theme">
          <select value={p.themeId ?? ''} onChange={(e) => update({ themeId: e.target.value || undefined })}>
            <option value="">Default</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => s.setUI({ editingThemeId: resolveTheme(s, p).id })}>
            Edit
          </button>
        </Field>
        <Field label="Library">
          <select value={p.category} onChange={(e) => update({ category: e.target.value as Category })}>
            {LIBRARIES.map((l) => (
              <option key={l.category} value={l.category}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Size">
          <input value="1920 × 1080" disabled />
        </Field>
      </section>
      <section className="insp-section">
        <div className="insp-heading">Transition</div>
        <select
          className="insp-wide"
          value={p.transitionMs == null ? '' : String(p.transitionMs)}
          onChange={(e) => update({ transitionMs: e.target.value === '' ? undefined : Number(e.target.value) })}
        >
          {TRANSITIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </section>
      <section className="insp-section">
        <div className="insp-heading">
          Copyright
          <span className="insp-heading-aside">
            Show On Screen
            <Switch checked={!!p.showCopyright} onChange={(v) => update({ showCopyright: v })} label="Show copyright on screen" />
          </span>
        </div>
        {text('title', 'Title')}
        {text('artist', 'Artist')}
        {text('author', 'Author')}
        {text('album', 'Album')}
        {text('publisher', 'Publisher')}
        {text('year', 'Year')}
        {text('ccli', 'CCLI #')}
        {text('copyright', 'Copyright')}
        <p className="small-print muted">Shown at the bottom of the first and last slides. Set your CCLI license number in Settings.</p>
      </section>
    </>
  );
}

const GROUP_SWATCHES = ['#3b82f6', '#d9485f', '#d4a72c', '#9b5de5', '#14b8a6', '#6b7280', '#1a1a1a', '#e5e5e5'];

function SlideTab({ presentation: p, slide, group }: { presentation: Presentation; slide: Slide; group: Group }) {
  const media = useStore((s) => s.media);
  const base = useBaseTheme(p);
  const s = useStore.getState();
  const updateSlide = (patch: Partial<Slide>) => s.updateSlide(p.id, slide.id, patch);
  const bg = slide.background;
  const setBg = (patch: Partial<ThemeBackground>) => bg && updateSlide({ background: { ...bg, ...patch } });

  return (
    <>
      <section className="insp-section">
        <div className="insp-heading">Group</div>
        <Field label="Name">
          <input value={group.name} onChange={(e) => s.updateGroup(p.id, group.id, { name: e.target.value })} />
        </Field>
        <Field label="Color">
          <span className="swatches">
            {GROUP_SWATCHES.map((c) => (
              <button
                key={c}
                className={`swatch ${group.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => s.updateGroup(p.id, group.id, { color: c })}
                title={c}
              />
            ))}
            <input
              type="color"
              value={group.color}
              onChange={(e) => s.updateGroup(p.id, group.id, { color: e.target.value })}
              aria-label="Custom color"
            />
          </span>
        </Field>
      </section>
      <section className="insp-section">
        <div className="insp-heading">
          Background
          <span className="insp-heading-aside">
            Override theme
            <Switch
              checked={!!bg}
              onChange={(on) =>
                updateSlide({
                  background: on
                    ? base.background.type === 'none'
                      ? { type: 'color', color: '#202124', color2: '#202124' }
                      : { ...base.background }
                    : undefined,
                })
              }
              label="Override the theme background"
            />
          </span>
        </div>
        {bg ? (
          <>
            <Field label="Type">
              <select value={bg.type} onChange={(e) => setBg({ type: e.target.value as ThemeBackground['type'] })}>
                <option value="none">None (transparent)</option>
                <option value="color">Color</option>
                <option value="gradient">Gradient</option>
                <option value="media">Image / video</option>
              </select>
            </Field>
            {(bg.type === 'color' || bg.type === 'gradient') && (
              <Field label="Colors">
                <span className="pair">
                  <input type="color" value={bg.color} onChange={(e) => setBg({ color: e.target.value })} />
                  {bg.type === 'gradient' && <input type="color" value={bg.color2} onChange={(e) => setBg({ color2: e.target.value })} />}
                </span>
              </Field>
            )}
            {bg.type === 'media' && (
              <Field label="Media">
                <select value={bg.mediaId ?? ''} onChange={(e) => setBg({ mediaId: e.target.value || undefined })}>
                  <option value="">Choose…</option>
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        ) : (
          <p className="small-print muted">This slide uses the theme background.</p>
        )}
      </section>
      <section className="insp-section">
        <div className="insp-heading">Caption</div>
        <input
          className="insp-wide"
          value={slide.caption ?? ''}
          placeholder="e.g. John 3:16"
          onChange={(e) => updateSlide({ caption: e.target.value || undefined })}
        />
        <div className="insp-heading">Stage notes</div>
        <textarea
          className="insp-wide"
          rows={3}
          value={slide.notes ?? ''}
          placeholder="Shown on the stage display only"
          onChange={(e) => updateSlide({ notes: e.target.value || undefined })}
        />
      </section>
      <div className="button-row">
        <button className="btn" onClick={() => s.openEditor(s.duplicateSlide(p.id, slide.id))}>
          Duplicate Slide
        </button>
        <button className="btn danger" onClick={() => confirm('Delete this slide?') && s.deleteSlide(p.id, slide.id)}>
          Delete Slide
        </button>
      </div>
    </>
  );
}

function TextTab({ presentation: p, slide }: { presentation: Presentation; slide: Slide }) {
  const base = useBaseTheme(p);
  const s = useStore.getState();
  const eff = applyStyles(base, p.style, slide.style);
  const set = (patch: TextStyle) => s.updateSlide(p.id, slide.id, { style: { ...slide.style, ...patch } });
  const fontKnown = FONT_CHOICES.some((f) => f.value === eff.fontFamily);
  const { inset } = eff;
  const px = {
    x: Math.round((inset.left / 100) * CANVAS_W),
    y: Math.round((inset.top / 100) * CANVAS_H),
    w: Math.round(((100 - inset.left - inset.right) / 100) * CANVAS_W),
    h: Math.round(((100 - inset.top - inset.bottom) / 100) * CANVAS_H),
  };
  const setBox = (next: typeof px) => {
    const w = Math.max(MIN_SIZE, (next.w / CANVAS_W) * 100);
    const h = Math.max(MIN_SIZE, (next.h / CANVAS_H) * 100);
    const left = (next.x / CANVAS_W) * 100;
    const top = (next.y / CANVAS_H) * 100;
    set({ inset: { left: round(left), top: round(top), right: round(100 - left - w), bottom: round(100 - top - h) } });
  };
  const num = (key: keyof typeof px, label: string) => (
    <label className="num-field">
      <input type="number" value={px[key]} onChange={(e) => setBox({ ...px, [key]: Number(e.target.value) || 0 })} />
      <span>{label}</span>
    </label>
  );

  return (
    <>
      <section className="insp-section">
        <div className="insp-heading">Font</div>
        <select className="insp-wide" value={fontKnown ? eff.fontFamily : ''} onChange={(e) => set({ fontFamily: e.target.value })}>
          {!fontKnown && <option value="">{eff.fontFamily}</option>}
          {FONT_CHOICES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <Field label="Max size">
          <input type="number" min={12} max={300} value={eff.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) || 12 })} />
        </Field>
        <Field label="Weight">
          <select value={eff.fontWeight} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Color">
          <input type="color" value={eff.color} onChange={(e) => set({ color: e.target.value })} />
        </Field>
        <div className="insp-tools">
          <div className="seg">
            <button className={eff.italic ? 'on' : ''} onClick={() => set({ italic: !eff.italic })} title="Italic">
              <i>I</i>
            </button>
            <button className={eff.uppercase ? 'on' : ''} onClick={() => set({ uppercase: !eff.uppercase })} title="All caps">
              AA
            </button>
          </div>
          <AlignButtons theme={eff} onChange={set} />
        </div>
      </section>
      <section className="insp-section">
        <div className="insp-heading">Position</div>
        <div className="num-grid">
          {num('x', 'X')}
          {num('y', 'Y')}
          {num('w', 'Width')}
          {num('h', 'Height')}
        </div>
        <p className="small-print muted">Drag the text box on the canvas, or nudge it with the arrow keys (Shift for 10px).</p>
      </section>
      <div className="button-row">
        <button
          className="btn"
          disabled={!slide.style}
          onClick={() => {
            s.updatePresentation(p.id, { style: { ...p.style, ...slide.style } });
            s.updateSlide(p.id, slide.id, { style: undefined });
          }}
          title="Use this slide's formatting for every slide in the presentation"
        >
          Apply to All Slides
        </button>
        <button className="btn" disabled={!slide.style} onClick={() => s.updateSlide(p.id, slide.id, { style: undefined })}>
          Reset to Theme
        </button>
      </div>
    </>
  );
}
