import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { DeckElement, DeckShape, DeckSlide, DeckText, EditableSlide } from '../deck';
import {
  addElement,
  deleteElement,
  duplicateElement,
  elementAt,
  formatText,
  hexOf,
  moveElement,
  newPicture,
  newShape,
  newTextBox,
  paragraphOf,
  placeElement,
  resizeBox,
  restackElement,
  rgba,
  rotateElement,
  setFill,
  setStroke,
  SHAPE_PRESETS,
  textFormat,
  updateElement,
  type HandleDir,
  type TextFormat,
} from '../deckEdit';
import { drawDeckSlide, deckImagePaths, type Images } from '../deckRender';
import { imagesFor, loadEditable, makeKeynoteEditable, NeedsKeynote, saveEditable, storeSlideImage } from '../deckSlides';
import { htmlToText, textToHtml } from '../deckTextDom';
import { getMediaBlob, useMedia } from '../media';
import { notify } from '../notices';
import { deckFileOf } from '../slideshows';
import { useStore } from '../store';
import type { Group, MediaItem, Presentation, Slide } from '../types';
import { openContextMenu, type ContextEntries } from './ContextMenu';
import { setCanvasCommands, type EditCommand } from './editCommands';
import { Field, HANDLES, PAD, PresentationTab, RULER, Rulers, SlideTab, TOOLBAR_SPACE, type Handle } from './EditView';
import { FontSelect } from './FontSelect';
import { Icon, pickFiles, Popover, shortcut } from './ui';

const DIRS: Record<Exclude<Handle, 'move'>, HandleDir> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
};

/** Shapes copied in the slide editor, with the PowerPoint file their pictures come from. */
let elementClipboard: { element: DeckElement; file: string | undefined } | null = null;

const usesFileImages = (e: DeckElement) =>
  [...deckImagePaths([{ background: null, elements: [e], text: '', notes: '', hidden: false }])].some((p) => !p.startsWith('media:'));

const TEXT_COLORS = ['#ffffff', '#000000', '#d93025', '#f29900', '#fbbc04', '#188038', '#1a73e8', '#a142f4'];

type Tab = 'shape' | 'slide' | 'presentation';

/**
 * Edit mode for a PowerPoint or Keynote slide: its shapes, pictures and text boxes on a canvas,
 * as PowerPoint draws them. Click to select, drag to move, the handles to resize and turn,
 * double-click to type. Each change is one step for Undo, and redraws the slide's picture.
 */
export function DeckEditor({ presentation: p, slide, group }: { presentation: Presentation; slide: Slide; group: Group }) {
  const file = deckFileOf(p, slide);
  const [base, setBase] = useState<EditableSlide | null>(null);
  const [problem, setProblem] = useState<{ message: string; keynote: boolean } | null>(null);
  const [work, setWork] = useState<DeckSlide | null>(null);
  const [drag, setDrag] = useState<DeckSlide | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [editingText, setEditingText] = useState(false);
  const [images, setImages] = useState<Images>(new Map());
  const [tab, setTab] = useState<Tab>('shape');
  const [making, setMaking] = useState(false);
  const pending = useRef(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });

  // The slide's model: loaded again when Undo (or anything else) changes it, but not after our own saves.
  const modelKey = `${slide.source?.model ?? ''}|${file ?? ''}`;
  useEffect(() => {
    if (pending.current > 0) return;
    let alive = true;
    loadEditable(p, slide).then(
      (loaded) => {
        if (!alive) return;
        setBase(loaded);
        setWork(null);
        setProblem(null);
      },
      (e: unknown) => alive && setProblem({ message: e instanceof Error ? e.message : String(e), keynote: e instanceof NeedsKeynote }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, p.source?.pptxId]);

  const shown = drag ?? work ?? base?.slide ?? null;
  const width = base?.width ?? 1920;
  const height = base?.height ?? 1080;
  const element = shown && selected !== null ? shown.elements[selected] : undefined;

  // Its pictures, decoded once.
  const imageKey = shown ? [...deckImagePaths([shown])].join('|') : '';
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    void imagesFor(file, shown).then((imgs) => alive && setImages(imgs));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, file]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the slide (the text being typed is the text editor's, not the canvas's).
  useLayoutEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !shown) return;
    const drawn =
      editingText && selected !== null
        ? updateElement(shown, selected, (e) => (e.kind === 'shape' ? { ...e, text: undefined } : e))
        : shown;
    ctx.clearRect(0, 0, width, height);
    drawDeckSlide(ctx, { width, height }, drawn, images);
  }, [shown, images, editingText, selected, width, height]);

  // Fonts arriving later redraw the slide in them.
  useEffect(() => {
    const redraw = () => setImages((m) => new Map(m));
    document.fonts?.addEventListener?.('loadingdone', redraw);
    return () => document.fonts?.removeEventListener?.('loadingdone', redraw);
  }, []);

  const commit = (next: DeckSlide) => {
    setWork(next);
    setDrag(null);
    if (!base) return;
    pending.current++;
    void saveEditable(p.id, slide.id, { ...base, slide: next })
      .catch((e: unknown) => notify(`Couldn’t save the slide: ${e instanceof Error ? e.message : String(e)}`, 'error'))
      .finally(() => pending.current--);
  };
  const change = (fn: (e: DeckElement) => DeckElement) => shown && selected !== null && commit(updateElement(shown, selected, fn));

  // ---- Edit's commands on the selected shape --------------------------------------------------
  const latest = useRef({ shown, selected, file, commit, editingText });
  latest.current = { shown, selected, file, commit, editingText };
  const remove = () => {
    const { shown: sl, selected: i } = latest.current;
    if (!sl || i === null) return;
    latest.current.commit(deleteElement(sl, i));
    setSelected(null);
  };
  const duplicate = () => {
    const { shown: sl, selected: i } = latest.current;
    if (!sl || i === null) return;
    const r = duplicateElement(sl, i);
    latest.current.commit(r.slide);
    setSelected(r.index);
  };
  const copy = () => {
    const { shown: sl, selected: i, file: f } = latest.current;
    const e = sl && i !== null ? sl.elements[i] : undefined;
    if (e) elementClipboard = { element: structuredClone({ ...e, template: undefined }), file: f };
  };
  const canPaste = () => !!elementClipboard && (elementClipboard.file === latest.current.file || !usesFileImages(elementClipboard.element));
  const paste = () => {
    const sl = latest.current.shown;
    if (!sl || !elementClipboard || !canPaste()) return;
    const r = addElement(sl, moveElement(structuredClone(elementClipboard.element), 30, 30));
    latest.current.commit(r.slide);
    setSelected(r.index);
  };
  useEffect(() => {
    if (selected === null || editingText) return setCanvasCommands(null);
    setCanvasCommands({
      enabled: (): EditCommand[] => ['cut', 'copy', 'duplicate', 'delete', 'deselect-all', ...(canPaste() ? (['paste'] as const) : [])],
      run: (cmd) => {
        if (cmd === 'delete') remove();
        else if (cmd === 'duplicate') duplicate();
        else if (cmd === 'copy') copy();
        else if (cmd === 'cut') (copy(), remove());
        else if (cmd === 'paste') paste();
        else if (cmd === 'deselect-all') setSelected(null);
      },
    });
    return () => setCanvasCommands(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, editingText]);

  // ---- Layout -------------------------------------------------------------------------------------
  const innerW = area.w - RULER;
  const innerH = area.h - RULER;
  const scale = Math.max(0.05, Math.min((innerW - PAD * 2) / width, (innerH - TOOLBAR_SPACE - PAD) / height));
  const cw = width * scale;
  const ch = height * scale;
  const left = RULER + (innerW - cw) / 2;
  const top = RULER + TOOLBAR_SPACE + Math.max(0, (innerH - TOOLBAR_SPACE - PAD - ch) / 2);
  const toSlide = (clientX: number, clientY: number) => {
    const r = areaRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - left) / scale, y: (clientY - r.top - top) / scale };
  };

  // ---- Dragging ----------------------------------------------------------------------------------
  const startDrag = (e: ReactPointerEvent, i: number, how: 'move' | 'rotate' | HandleDir) => {
    if (!shown || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    areaRef.current?.focus();
    const from = shown;
    const el = from.elements[i];
    if (!el || el.template) return;
    const start = toSlide(e.clientX, e.clientY);
    let moved = false;
    let next: DeckSlide | null = null;
    const onMove = (ev: PointerEvent) => {
      const at = toSlide(ev.clientX, ev.clientY);
      const dx = at.x - start.x;
      const dy = at.y - start.y;
      if (!moved && Math.hypot(dx, dy) * scale < 3) return;
      moved = true;
      let changed: DeckElement;
      if (how === 'move') changed = moveElement(el, Math.round(dx), Math.round(dy));
      else if (how === 'rotate') {
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        let deg = (Math.atan2(at.y - cy, at.x - cx) * 180) / Math.PI + 90;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        changed = rotateElement(el, Math.round(deg));
      } else changed = placeElement(el, resizeBox(el, how, dx, dy, ev.shiftKey || el.kind === 'picture'));
      next = updateElement(from, i, () => changed);
      setDrag(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved && next) commit(next);
      else setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onCanvasDown = (e: ReactPointerEvent) => {
    if (!shown || e.button !== 0) return;
    const at = toSlide(e.clientX, e.clientY);
    const hit =
      selected !== null && element && !element.template && containsSelected(element, at) ? selected : elementAt(shown, at.x, at.y);
    setEditingText(false);
    setSelected(hit);
    if (hit !== null) {
      setTab('shape');
      startDrag(e, hit, 'move');
    } else areaRef.current?.focus();
  };

  const startTextEditing = () => {
    if (!element || element.kind !== 'shape' || selected === null || !shown) return;
    if (!element.text) {
      // A shape without text gets an empty paragraph to type into.
      const look = { ...newTextBox(shown, width, height).text!.paragraphs[0].runs[0], text: '' };
      const { text: _t, ...rest } = look;
      const text: DeckText = {
        paragraphs: [paragraphOf('', rest, 'center')],
        insets: { l: 19, t: 10, r: 19, b: 10 },
        anchor: 'middle',
        wrap: true,
        fontScale: 1,
        lineReduction: 0,
      };
      setWork(updateElement(shown, selected, (x) => ({ ...(x as DeckShape), text })));
    }
    setEditingText(true);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (editingText || selected === null || !element) return;
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
      change((x) => moveElement(x, move[0], move[1]));
    } else if (e.key === 'Enter' && element.kind === 'shape') {
      e.preventDefault();
      startTextEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSelected(null);
    }
  };

  const elementMenu = (): ContextEntries => [
    element?.kind === 'shape' && { label: 'Edit Text', shortcut: '↩', action: startTextEditing },
    element?.kind === 'shape' && '-',
    { label: 'Cut', shortcut: shortcut('X'), action: () => (copy(), remove()) },
    { label: 'Copy', shortcut: shortcut('C'), action: copy },
    { label: 'Paste', shortcut: shortcut('V'), disabled: !canPaste(), action: paste },
    { label: 'Duplicate', shortcut: shortcut('D'), action: duplicate },
    { label: 'Delete', shortcut: '⌫', danger: true, action: remove },
    '-',
    { label: 'Bring to Front', action: () => restack(Infinity) },
    { label: 'Bring Forward', action: () => restack(1) },
    { label: 'Send Backward', action: () => restack(-1) },
    { label: 'Send to Back', action: () => restack(-Infinity) },
  ];
  const restack = (by: number) => {
    if (!shown || selected === null) return;
    const r = restackElement(shown, selected, by);
    commit(r.slide);
    setSelected(r.index);
  };

  const add = (e: DeckElement) => {
    if (!shown) return;
    const r = addElement(shown, e);
    commit(r.slide);
    setSelected(r.index);
    setTab('shape');
    areaRef.current?.focus();
  };

  const addPicture = async (blob: Blob) => {
    try {
      const stored = await storeSlideImage(blob);
      if (shown) add(newPicture(stored.id, stored, width, height));
    } catch (e) {
      notify(`Couldn’t add the picture: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  const [pop, setPop] = useState<'shape' | 'picture' | null>(null);

  const keynoteFirstEdit = p.source?.kind === 'keynote' && !slide.source?.model;

  return (
    <>
      <main className="edit-center">
        <div
          ref={areaRef}
          className="edit-area deck-edit-area"
          tabIndex={0}
          data-edit-scope="canvas"
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('.float-toolbar, .deck-text-edit')) return;
            if (!(e.target as HTMLElement).closest('.deck-overlay, .element-frame')) {
              setSelected(null);
              setEditingText(false);
            }
          }}
        >
          {area.w > 0 && <Rulers left={left} top={top} scale={scale} width={area.w} height={area.h} />}
          <div className="float-toolbar" style={{ left: RULER + innerW / 2 }}>
            <button title="Add a text box" disabled={!shown} onClick={() => shown && add(newTextBox(shown, width, height))}>
              <span className="ft-glyph">T</span>
            </button>
            <div className="popover-anchor">
              <button
                title="Add a shape"
                disabled={!shown}
                className={pop === 'shape' ? 'active' : ''}
                onClick={() => setPop(pop === 'shape' ? null : 'shape')}
              >
                <Icon name="slides" size={18} />
              </button>
              <Popover open={pop === 'shape'} onClose={() => setPop(null)} align="center" className="deck-shape-pop">
                {SHAPE_PRESETS.map((s) => (
                  <button
                    key={s.preset}
                    className="deck-shape-choice"
                    onClick={() => {
                      setPop(null);
                      add(newShape(s.preset, width, height));
                    }}
                  >
                    <ShapeGlyph preset={s.preset} />
                    {s.label}
                  </button>
                ))}
              </Popover>
            </div>
            <div className="popover-anchor">
              <button
                title="Add a picture"
                disabled={!shown}
                className={pop === 'picture' ? 'active' : ''}
                onClick={() => setPop(pop === 'picture' ? null : 'picture')}
              >
                <Icon name="image" size={18} />
              </button>
              <Popover open={pop === 'picture'} onClose={() => setPop(null)} align="center" className="picker-pop">
                <PicturePicker
                  onFile={() => {
                    setPop(null);
                    void pickFiles('image/*', false, 'Pictures').then(([f]) => f && addPicture(f));
                  }}
                  onMedia={(m) => {
                    setPop(null);
                    void getMediaBlob(m.id).then((b) => b && addPicture(b));
                  }}
                />
              </Popover>
            </div>
          </div>
          {problem ? (
            <div className="edit-slide empty deck-problem" style={{ left, top, width: cw, height: ch }}>
              <div>
                <p>{problem.message}</p>
                {problem.keynote && (
                  <button
                    className="btn primary"
                    disabled={making}
                    onClick={() => {
                      setMaking(true);
                      makeKeynoteEditable(p.id)
                        .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), 'error'))
                        .finally(() => setMaking(false));
                    }}
                  >
                    {making ? 'Asking Keynote…' : 'Make Editable with Keynote'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="edit-slide" style={{ left, top, width: cw, height: ch }}>
                <canvas ref={canvasRef} width={width} height={height} style={{ width: cw, height: ch, display: 'block' }} />
              </div>
              <div
                className="deck-overlay"
                style={{ left, top, width: cw, height: ch }}
                onPointerDown={onCanvasDown}
                onDoubleClick={() => element?.kind === 'shape' && startTextEditing()}
                onContextMenu={(e) => {
                  const at = toSlide(e.clientX, e.clientY);
                  const hit = shown ? elementAt(shown, at.x, at.y) : null;
                  if (hit === null) return;
                  e.preventDefault();
                  setSelected(hit);
                  openContextMenu(e, elementMenu());
                }}
              />
              {element && !element.template && !editingText && (
                <div
                  className="element-frame selected deck-frame"
                  style={{
                    left: left + element.x * scale,
                    top: top + element.y * scale,
                    width: Math.max(1, element.w * scale),
                    height: Math.max(1, element.h * scale),
                    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                  }}
                  onPointerDown={(e) => startDrag(e, selected!, 'move')}
                  onDoubleClick={() => element.kind === 'shape' && startTextEditing()}
                  onContextMenu={(e) => openContextMenu(e, elementMenu())}
                >
                  {HANDLES.map((h) => (
                    <span key={h} className={`handle ${h}`} onPointerDown={(e) => startDrag(e, selected!, DIRS[h])} />
                  ))}
                  <span
                    className="handle rotate"
                    title="Turn (Shift: 15° steps)"
                    onPointerDown={(e) => startDrag(e, selected!, 'rotate')}
                  />
                </div>
              )}
              {element && editingText && element.kind === 'shape' && element.text && (
                <DeckTextEditor
                  element={element}
                  scale={scale}
                  left={left}
                  top={top}
                  onDone={(text) => {
                    setEditingText(false);
                    areaRef.current?.focus();
                    if (JSON.stringify(text) !== JSON.stringify(element.text)) change((x) => ({ ...(x as DeckShape), text }));
                  }}
                />
              )}
              {drag && element && (
                <div className="drag-readout" style={{ left: left + element.x * scale, top: top + (element.y + element.h) * scale + 8 }}>
                  {Math.round(element.x)}, {Math.round(element.y)} · {Math.round(element.w)} × {Math.round(element.h)}
                  {element.rotation ? ` · ${Math.round(element.rotation)}°` : ''}
                </div>
              )}
              {!base && (
                <div className="deck-loading" style={{ left, top, width: cw, height: ch }}>
                  Opening the slide…
                </div>
              )}
              {keynoteFirstEdit && base && (
                <p className="deck-note" style={{ left, top: top + ch + 8, width: cw }}>
                  Editing draws this slide from Keynote’s PowerPoint copy, so it may look a little different from Keynote’s own picture once
                  changed.
                </p>
              )}
            </>
          )}
        </div>
      </main>
      <aside className="inspector">
        <div className="inspector-tabs">
          {(['shape', 'slide', 'presentation'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'shape' ? (element ? KIND_NAMES[element.kind] : 'Slide Design') : t === 'slide' ? 'Slide' : 'Presentation'}
            </button>
          ))}
        </div>
        <div className="inspector-body">
          {tab === 'shape' &&
            (element && shown ? (
              <ElementInspector
                element={element}
                editingText={editingText}
                onChange={(fn) => change(fn)}
                onRestack={restack}
                onDuplicate={duplicate}
                onDelete={remove}
                onEditText={startTextEditing}
              />
            ) : shown ? (
              <SlideDesign slide={shown} onChange={commit} />
            ) : null)}
          {tab === 'slide' && <SlideTab presentation={p} slide={slide} group={group} />}
          {tab === 'presentation' && <PresentationTab presentation={p} />}
        </div>
      </aside>
    </>
  );
}

const KIND_NAMES: Record<DeckElement['kind'], string> = { shape: 'Shape', picture: 'Picture', group: 'Group' };

/** Hit-testing the selected element first, so a selected shape under another can still be dragged. */
function containsSelected(e: DeckElement, at: { x: number; y: number }) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const a = (-e.rotation * Math.PI) / 180;
  const lx = (at.x - cx) * Math.cos(a) - (at.y - cy) * Math.sin(a);
  const ly = (at.x - cx) * Math.sin(a) + (at.y - cy) * Math.cos(a);
  return Math.abs(lx) <= e.w / 2 + 6 && Math.abs(ly) <= e.h / 2 + 6;
}

function ShapeGlyph({ preset }: { preset: string }) {
  const d: Record<string, string> = {
    rect: 'M3 5h18v14H3z',
    roundRect: 'M7 5h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z',
    ellipse: 'M12 5a9 7 0 1 0 0.01 0z',
    triangle: 'M12 4l9 16H3z',
    rtTriangle: 'M4 4v16h16z',
    line: 'M4 20L20 4',
  };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d={d[preset] ?? d.rect} />
    </svg>
  );
}

function PictureChoice({ item, onPick }: { item: MediaItem; onPick: () => void }) {
  const media = useMedia(item.id);
  return (
    <button className="media-choice" onClick={onPick} title={item.name}>
      {media && <img src={media.url} alt="" />}
      <span>{item.name}</span>
    </button>
  );
}

function PicturePicker({ onFile, onMedia }: { onFile: () => void; onMedia: (m: MediaItem) => void }) {
  const images = useStore((s) => s.media.filter((m) => m.kind === 'image'));
  return (
    <>
      <button className="btn insp-wide" onClick={onFile}>
        Choose a Picture File…
      </button>
      {images.length > 0 && <p className="small-print muted">Or one from the media bin:</p>}
      <div className="media-choices">
        {images.map((m) => (
          <PictureChoice key={m.id} item={m} onPick={() => onMedia(m)} />
        ))}
      </div>
    </>
  );
}

// ---- Typing in a text box -----------------------------------------------------------------------

function DeckTextEditor({
  element,
  scale,
  left,
  top,
  onDone,
}: {
  element: DeckShape;
  scale: number;
  left: number;
  top: number;
  onDone: (text: DeckText) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const text = element.text!;
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = textToHtml(text);
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.execCommand('styleWithCSS', false, 'true');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = () => {
    if (done.current || !ref.current) return;
    done.current = true;
    onDone(htmlToText(ref.current, text));
  };
  const justify = text.anchor === 'top' ? 'flex-start' : text.anchor === 'bottom' ? 'flex-end' : 'center';
  return (
    <div
      className="deck-text-edit"
      style={{
        left: left + element.x * scale,
        top: top + element.y * scale,
        width: element.w * scale,
        height: element.h * scale,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
      }}
    >
      <div
        className="deck-text-box"
        style={{
          width: element.w,
          height: element.h,
          transform: `scale(${scale})`,
          justifyContent: justify,
          padding: `${text.insets.t}px ${text.insets.r}px ${text.insets.b}px ${text.insets.l}px`,
        }}
      >
        <div
          ref={ref}
          className="deck-text-content"
          contentEditable
          suppressContentEditableWarning
          spellCheck={useStore.getState().settings.spellcheck !== false}
          style={{ whiteSpace: text.wrap ? 'pre-wrap' : 'pre' }}
          onBlur={finish}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              ref.current?.blur();
            }
          }}
        />
      </div>
    </div>
  );
}

// ---- Inspector -------------------------------------------------------------------------------------

function NumberField({ label, value, onCommit, step = 1 }: { label: string; value: number; onCommit: (v: number) => void; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * 10) / 10);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <label className="deck-num">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label={label}
      />
    </label>
  );
}

function ColorField({
  label,
  color,
  onChange,
  none,
  onNone,
}: {
  label: string;
  color: string | null;
  onChange: (c: string) => void;
  none?: string;
  onNone?: () => void;
}) {
  const { hex, alpha } = color ? hexOf(color) : { hex: '#000000', alpha: 1 };
  return (
    <Field label={label}>
      <span className="pair">
        {onNone && (
          <select
            value={color ? 'on' : 'none'}
            onChange={(e) => (e.target.value === 'none' ? onNone() : onChange(rgba(hex, alpha)))}
            aria-label={`${label} on or off`}
          >
            <option value="none">{none ?? 'None'}</option>
            <option value="on">Color</option>
          </select>
        )}
        {color && <input type="color" value={hex} onChange={(e) => onChange(rgba(e.target.value, alpha))} aria-label={label} />}
      </span>
    </Field>
  );
}

/** While typing, a button changes the selected words (keeping the selection), not the whole box. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

function ElementInspector({
  element: e,
  editingText,
  onChange,
  onRestack,
  onDuplicate,
  onDelete,
  onEditText,
}: {
  element: DeckElement;
  editingText: boolean;
  onChange: (fn: (e: DeckElement) => DeckElement) => void;
  onRestack: (by: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEditText: () => void;
}) {
  const text = e.kind === 'shape' ? e.text : undefined;
  const fmt = text ? textFormat(text) : null;
  const setText = (patch: Partial<TextFormat>) =>
    onChange((x) => (x.kind === 'shape' && x.text ? { ...x, text: formatText(x.text, patch) } : x));
  const style = (cmd: 'bold' | 'italic' | 'underline', key: 'bold' | 'italic' | 'underline') =>
    editingText ? document.execCommand(cmd) : fmt && setText({ [key]: !fmt[key] });
  const color = (c: string) => (editingText ? document.execCommand('foreColor', false, c) : setText({ color: rgba(c) }));
  const fill = e.kind === 'shape' ? e.fill : null;
  const stroke = e.kind === 'shape' || e.kind === 'picture' ? e.stroke : null;
  return (
    <>
      <section className="insp-section">
        <div className="insp-heading">Position and Size</div>
        <div className="deck-nums">
          <NumberField label="X" value={e.x} onCommit={(v) => onChange((x) => moveElement(x, v - x.x, 0))} />
          <NumberField label="Y" value={e.y} onCommit={(v) => onChange((x) => moveElement(x, 0, v - x.y))} />
          <NumberField label="W" value={e.w} onCommit={(v) => onChange((x) => placeElement(x, { ...x, w: Math.max(1, v) }))} />
          <NumberField label="H" value={e.h} onCommit={(v) => onChange((x) => placeElement(x, { ...x, h: Math.max(0, v) }))} />
          <NumberField label="°" value={e.rotation} onCommit={(v) => onChange((x) => rotateElement(x, v))} />
        </div>
        <div className="seg deck-arrange">
          <button onClick={() => onRestack(Infinity)} title="Bring to Front">
            Front
          </button>
          <button onClick={() => onRestack(1)} title="Bring Forward">
            Forward
          </button>
          <button onClick={() => onRestack(-1)} title="Send Backward">
            Backward
          </button>
          <button onClick={() => onRestack(-Infinity)} title="Send to Back">
            Back
          </button>
        </div>
      </section>
      {e.kind === 'shape' && (
        <section className="insp-section">
          <div className="insp-heading">Text</div>
          {fmt ? (
            <>
              <Field label="Font">
                <FontSelect value={fmt.font} onChange={(font) => setText({ font })} />
              </Field>
              <Field label="Size">
                <span className="pair">
                  <NumberField label="Size" value={fmt.size} onCommit={(size) => setText({ size: Math.max(4, size) })} />
                  <div className="seg">
                    <button onMouseDown={keepFocus} className={fmt.bold ? 'on' : ''} onClick={() => style('bold', 'bold')} title="Bold">
                      <b>B</b>
                    </button>
                    <button
                      onMouseDown={keepFocus}
                      className={fmt.italic ? 'on' : ''}
                      onClick={() => style('italic', 'italic')}
                      title="Italic"
                    >
                      <i>I</i>
                    </button>
                    <button
                      onMouseDown={keepFocus}
                      className={fmt.underline ? 'on' : ''}
                      onClick={() => style('underline', 'underline')}
                      title="Underline"
                    >
                      <u>U</u>
                    </button>
                  </div>
                </span>
              </Field>
              <Field label="Color">
                <span className="pair deck-swatches">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      className="swatch"
                      style={{ background: c }}
                      onMouseDown={keepFocus}
                      onClick={() => color(c)}
                      title={c}
                    />
                  ))}
                  <input
                    type="color"
                    value={hexOf(fmt.color).hex}
                    onChange={(ev) => setText({ color: rgba(ev.target.value) })}
                    aria-label="Text color"
                  />
                </span>
              </Field>
              <Field label="Align">
                <span className="pair">
                  <div className="seg">
                    {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                      <button key={a} className={fmt.align === a ? 'on' : ''} onClick={() => setText({ align: a })} title={`Align ${a}`}>
                        <Icon
                          name={a === 'left' || a === 'justify' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight'}
                          size={14}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="seg">
                    {(['top', 'middle', 'bottom'] as const).map((a) => (
                      <button key={a} className={fmt.anchor === a ? 'on' : ''} onClick={() => setText({ anchor: a })} title={`Align ${a}`}>
                        <Icon name={a === 'top' ? 'alignTop' : a === 'middle' ? 'alignMiddle' : 'alignBottom'} size={14} />
                      </button>
                    ))}
                  </div>
                </span>
              </Field>
              <p className="small-print muted">
                {editingText
                  ? 'Bold, italic, underline and the swatches change the selected words.'
                  : 'Double-click the box to type in it.'}
              </p>
            </>
          ) : (
            <button className="btn insp-wide" onClick={onEditText}>
              Add Text
            </button>
          )}
        </section>
      )}
      {(e.kind === 'shape' || e.kind === 'picture') && (
        <section className="insp-section">
          <div className="insp-heading">Fill and Line</div>
          {e.kind === 'shape' && (
            <ColorField
              label="Fill"
              color={fill?.kind === 'solid' ? fill.color : null}
              none={fill && fill.kind !== 'solid' ? (fill.kind === 'gradient' ? 'Gradient' : 'Picture') : 'None'}
              onChange={(c) => onChange((x) => setFill(x, { kind: 'solid', color: c }))}
              onNone={() => onChange((x) => setFill(x, null))}
            />
          )}
          <ColorField
            label="Line"
            color={stroke?.color ?? null}
            onChange={(c) => onChange((x) => setStroke(x, { width: stroke?.width ?? 4, ...stroke, color: c }))}
            onNone={() => onChange((x) => setStroke(x, null))}
          />
          {stroke && (
            <Field label="Width">
              <NumberField
                label="Line width"
                value={stroke.width}
                onCommit={(w) => onChange((x) => setStroke(x, { ...stroke, width: Math.max(0.5, w) }))}
              />
            </Field>
          )}
        </section>
      )}
      <div className="button-row">
        <button className="btn" onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </>
  );
}

/** With nothing selected: the slide's own background. */
function SlideDesign({ slide, onChange }: { slide: DeckSlide; onChange: (s: DeckSlide) => void }) {
  const bg = slide.background;
  return (
    <section className="insp-section">
      <div className="insp-heading">Background</div>
      <ColorField
        label="Color"
        color={bg?.kind === 'solid' ? bg.color : null}
        none={bg?.kind === 'gradient' ? 'Gradient' : bg?.kind === 'image' ? 'Picture' : 'None'}
        onChange={(c) => onChange({ ...slide, background: { kind: 'solid', color: c } })}
        onNone={() => onChange({ ...slide, background: null })}
      />
      <p className="small-print muted">
        Click a shape, picture or text box to change it; the slide’s design (its master and layout) stays as it is. Add text, shapes and
        pictures with the buttons above the slide.
      </p>
    </section>
  );
}
