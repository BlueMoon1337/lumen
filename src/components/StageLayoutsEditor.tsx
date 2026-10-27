import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { notify } from '../notices';
import { defaultThemes } from '../seed';
import { adjustBox, copyLayout, LAYOUT_SIZES, layoutTemplates, newStageObject, STAGE_KINDS, STAGE_MENUS, type Box } from '../stageLayouts';
import { useStore } from '../store';
import type { StageLayout, StageObject, StageObjectKind } from '../types';
import { NamePopup, openContextMenu, openPopupAtMenu, type ContextEntries } from './ContextMenu';
import { undoHint } from './deleting';
import { Field, HANDLES, RULER, Rulers, Switch, type Handle } from './EditView';
import { FontSelect } from './FontSelect';
import { StageView } from './StageView';
import { AlignButtons } from './Toolbar';
import { Icon, IconButton } from './ui';

const TOOLBAR_SPACE = 64;
const PAD = 36;

/** The editor's glyph for an object kind in the Objects list. */
const GLYPHS: Partial<Record<StageObjectKind, string>> = {
  clock: '◷',
  timer: '⏱',
  videoCountdown: '▶',
  shape: '▭',
  currentSlide: '▣',
  nextSlide: '▣',
};

function useLayout(): StageLayout | undefined {
  const layouts = useStore((s) => s.stageLayouts);
  const id = useStore((s) => s.stageLayoutId);
  return layouts.find((l) => l.id === id) ?? layouts[0];
}

/** Opens a menu under a button, as its dropdown. */
function menuBelow(el: HTMLElement, entries: ContextEntries) {
  const r = el.getBoundingClientRect();
  openContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {}, currentTarget: el }, entries);
}

function renameLayout(l: StageLayout) {
  openPopupAtMenu(
    <NamePopup
      title="Rename Layout"
      colors={false}
      initial={{ name: l.name, color: '' }}
      onSave={(v) => useStore.getState().updateStageLayout(l.id, { name: v.name })}
    />,
  );
}

function deleteLayout(l: StageLayout) {
  const s = useStore.getState();
  if (s.stageLayouts.length <= 1) return notify('A stage screen needs a layout, so the last one stays.');
  s.deleteStageLayout(l.id);
  notify(`Deleted the layout “${l.name}”. ${undoHint()}`);
}

function layoutMenu(l: StageLayout): ContextEntries {
  const s = useStore.getState();
  return [
    { label: 'Rename…', action: () => renameLayout(l) },
    { label: 'Duplicate', action: () => s.addStageLayout(copyLayout(l)) },
    '-',
    { label: 'Delete', danger: true, disabled: s.stageLayouts.length <= 1, action: () => deleteLayout(l) },
  ];
}

function newLayoutMenu(current: StageLayout | undefined): ContextEntries {
  const s = useStore.getState();
  return [
    {
      label: 'Blank Layout',
      action: () => s.addStageLayout({ id: '', name: 'Layout', width: 1920, height: 1080, background: '#000000', objects: [] }),
    },
    current && { label: `Duplicate “${current.name}”`, action: () => s.addStageLayout(copyLayout(current)) },
    '-',
    { header: 'Templates' },
    ...layoutTemplates().map((t) => ({ label: t.name, action: () => s.addStageLayout(t) })),
  ];
}

function LayoutList({ layout }: { layout?: StageLayout }) {
  const layouts = useStore((s) => s.stageLayouts);
  const objectId = useStore((s) => s.stageObjectId);
  const s = useStore.getState();
  return (
    <aside className="outline stage-layouts-list">
      <div className="outline-header">
        <span className="list-label">Layouts</span>
        <button type="button" className="icon-btn" title="New layout" onClick={(e) => menuBelow(e.currentTarget, newLayoutMenu(layout))}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="outline-list" tabIndex={-1}>
        {layouts.map((l, i) => (
          <div
            key={l.id}
            className={`outline-slide stage-layout-row ${l.id === layout?.id ? 'selected editing' : ''}`}
            onClick={() => s.setUI({ stageLayoutId: l.id, stageObjectId: null })}
            onDoubleClick={() => renameLayout(l)}
            onContextMenu={(e) => {
              s.setUI({ stageLayoutId: l.id, stageObjectId: null });
              openContextMenu(e, layoutMenu(l));
            }}
            title="Right-click to rename, duplicate or delete"
          >
            <div className="outline-thumb" style={{ aspectRatio: `${l.width} / ${l.height}` }}>
              <StageView frame={null} layout={l} samples />
            </div>
            <span className="outline-num">
              {i + 1}. {l.name}
            </span>
          </div>
        ))}
      </div>
      {layout && (
        <div className="objects stage-objects">
          <div className="objects-header">Objects</div>
          <div className="stage-objects-list">
            {[...layout.objects].reverse().map((o) => (
              <div
                key={o.id}
                className={`object-row ${o.id === objectId ? 'selected' : ''}`}
                onClick={() => s.setUI({ stageObjectId: o.id })}
                onContextMenu={(e) => {
                  s.setUI({ stageObjectId: o.id });
                  openContextMenu(e, objectMenu(layout, o));
                }}
              >
                <span className="object-glyph">{GLYPHS[o.kind] ?? 'T'}</span>
                <span className="list-label">{o.name}</span>
              </div>
            ))}
            {layout.objects.length === 0 && <p className="empty">Add objects from the toolbar above the layout.</p>}
          </div>
        </div>
      )}
    </aside>
  );
}

function duplicateObject(layout: StageLayout, o: StageObject) {
  const copy = { ...structuredClone(o), id: newStageObject(o.kind, layout).id };
  const moved = adjustBox(copy, 'move', 40, 40, layout);
  useStore.getState().addStageObject(layout.id, { ...copy, ...moved });
}

function objectMenu(layout: StageLayout, o: StageObject): ContextEntries {
  const s = useStore.getState();
  const at = layout.objects.findIndex((x) => x.id === o.id);
  const last = layout.objects.length - 1;
  return [
    { label: 'Duplicate', action: () => duplicateObject(layout, o) },
    '-',
    { label: 'Bring to Front', disabled: at === last, action: () => s.restackStageObject(layout.id, o.id, last - at) },
    { label: 'Bring Forward', disabled: at === last, action: () => s.restackStageObject(layout.id, o.id, 1) },
    { label: 'Send Backward', disabled: at === 0, action: () => s.restackStageObject(layout.id, o.id, -1) },
    { label: 'Send to Back', disabled: at === 0, action: () => s.restackStageObject(layout.id, o.id, -at) },
    '-',
    { label: 'Delete', danger: true, action: () => s.deleteStageObject(layout.id, o.id) },
  ];
}

function LayoutCanvas({ layout }: { layout: StageLayout }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ id: string; box: Box } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selectedId = useStore((s) => s.stageObjectId);
  const s = useStore.getState();

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = area.w - RULER;
  const innerH = area.h - RULER;
  const scale = Math.max(0.02, Math.min((innerW - PAD * 2) / layout.width, (innerH - TOOLBAR_SPACE - PAD) / layout.height));
  const cw = layout.width * scale;
  const ch = layout.height * scale;
  const left = RULER + (innerW - cw) / 2;
  const top = RULER + TOOLBAR_SPACE + Math.max(0, (innerH - TOOLBAR_SPACE - PAD - ch) / 2);
  const shown = draft ? { ...layout, objects: layout.objects.map((o) => (o.id === draft.id ? { ...o, ...draft.box } : o)) } : layout;
  const selected = shown.objects.find((o) => o.id === selectedId);

  const startDrag = (e: ReactPointerEvent, o: StageObject, handle: Handle) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    areaRef.current?.focus();
    s.setUI({ stageObjectId: o.id });
    const start = { x: e.clientX, y: e.clientY, box: { x: o.x, y: o.y, width: o.width, height: o.height } };
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 3) return;
      moved = true;
      setDraft({ id: o.id, box: adjustBox(start.box, handle, (ev.clientX - start.x) / scale, (ev.clientY - start.y) / scale, layout) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = draftRef.current;
      if (moved && d) s.updateStageObject(layout.id, d.id, d.box);
      setDraft(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!selected) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (move && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      s.updateStageObject(layout.id, selected.id, adjustBox(selected, 'move', move[0], move[1], layout));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      s.deleteStageObject(layout.id, selected.id);
    } else if (e.key === 'Escape') {
      s.setUI({ stageObjectId: null });
    } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD') {
      e.preventDefault();
      duplicateObject(layout, selected);
    }
  };

  const add = (kind: StageObjectKind) => s.addStageObject(layout.id, newStageObject(kind, layout));

  return (
    <div
      ref={areaRef}
      className="edit-area stage-edit-area"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.element-frame, .float-toolbar')) s.setUI({ stageObjectId: null });
      }}
    >
      {area.w > 0 && <Rulers left={left} top={top} scale={scale} width={area.w} height={area.h} />}
      <div className="float-toolbar" style={{ left: RULER + innerW / 2 }}>
        {STAGE_MENUS.map((m) => (
          <button
            key={m.label}
            title={`Add ${m.label.toLowerCase()} object`}
            onClick={(e) =>
              m.kinds.length === 1
                ? add(m.kinds[0])
                : menuBelow(
                    e.currentTarget,
                    m.kinds.map((k) => ({ label: STAGE_KINDS[k].label, action: () => add(k) })),
                  )
            }
          >
            <Icon name={m.icon} size={18} />
            {m.kinds.length > 1 && <Icon name="chevronDown" size={10} />}
          </button>
        ))}
      </div>
      <div className="edit-slide" style={{ left, top, width: cw, height: ch }}>
        <StageView frame={null} layout={shown} samples />
      </div>
      {shown.objects.map((o) => (
        <div
          key={o.id}
          className={`element-frame stage-frame ${o.id === selectedId ? 'selected' : ''}`}
          style={{ left: left + o.x * scale, top: top + o.y * scale, width: o.width * scale, height: o.height * scale }}
          onPointerDown={(e) => startDrag(e, o, 'move')}
          onContextMenu={(e) => {
            s.setUI({ stageObjectId: o.id });
            openContextMenu(e, objectMenu(layout, o));
          }}
          title={`${o.name} · Drag to move · Right-click for more`}
        >
          {o.id === selectedId && HANDLES.map((h) => <span key={h} className={`handle ${h}`} onPointerDown={(e) => startDrag(e, o, h)} />)}
        </div>
      ))}
      {draft && selected && (
        <div className="drag-readout" style={{ left: left + selected.x * scale, top: top + (selected.y + selected.height) * scale + 6 }}>
          {selected.x}, {selected.y} · {selected.width} × {selected.height}
        </div>
      )}
    </div>
  );
}

const num = (v: string, fallback: number) => (Number.isFinite(parseFloat(v)) ? Math.round(parseFloat(v)) : fallback);

function LayoutSection({ layout: l }: { layout: StageLayout }) {
  const s = useStore.getState();
  const size = `${l.width}x${l.height}`;
  return (
    <section className="insp-section">
      <div className="insp-heading">Layout</div>
      <Field label="Name">
        <input value={l.name} onChange={(e) => s.updateStageLayout(l.id, { name: e.target.value })} aria-label="Layout name" />
      </Field>
      <Field label="Background">
        <span className="pair">
          <input
            type="checkbox"
            checked={l.background !== null}
            onChange={(e) => s.updateStageLayout(l.id, { background: e.target.checked ? '#000000' : null })}
            aria-label="Background color"
          />
          <input
            type="color"
            disabled={l.background === null}
            value={l.background ?? '#000000'}
            onChange={(e) => s.updateStageLayout(l.id, { background: e.target.value })}
            aria-label="Background"
          />
        </span>
      </Field>
      <Field label="Size">
        <select
          value={size}
          onChange={(e) => {
            const [width, height] = e.target.value.split('x').map(Number);
            s.updateStageLayout(l.id, { width, height });
          }}
          aria-label="Layout size"
        >
          {!LAYOUT_SIZES.some((z) => `${z.width}x${z.height}` === size) && <option value={size}>{`${l.width} x ${l.height}`}</option>}
          {LAYOUT_SIZES.map((z) => (
            <option key={`${z.width}x${z.height}`} value={`${z.width}x${z.height}`}>{`${z.width} x ${z.height}`}</option>
          ))}
        </select>
      </Field>
      <p className="small-print muted">Without a background, the stage screen is black behind the objects.</p>
    </section>
  );
}

function ObjectSection({ layout, o }: { layout: StageLayout; o: StageObject }) {
  const s = useStore.getState();
  const set = (patch: Partial<StageObject>) => s.updateStageObject(layout.id, o.id, patch);
  const kind = STAGE_KINDS[o.kind];
  const words = o.kind !== 'shape' && o.kind !== 'currentSlide' && o.kind !== 'nextSlide';
  const boxField = (key: 'x' | 'y' | 'width' | 'height', label: string) => (
    <label className="stage-num">
      <input type="number" value={o[key]} onChange={(e) => set({ [key]: num(e.target.value, o[key]) })} aria-label={label} />
      <span>{label}</span>
    </label>
  );
  return (
    <section className="insp-section">
      <div className="insp-heading">
        {kind.label}
        <span className="insp-heading-aside">
          <IconButton
            icon="copy"
            title={`Duplicate (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}D)`}
            onClick={() => duplicateObject(layout, o)}
          />
          <IconButton icon="trash" title="Delete (Delete)" onClick={() => s.deleteStageObject(layout.id, o.id)} />
        </span>
      </div>
      <Field label="Name">
        <input value={o.name} onChange={(e) => set({ name: e.target.value })} aria-label="Object name" />
      </Field>
      <div className="stage-nums">
        {boxField('x', 'X')}
        {boxField('y', 'Y')}
        {boxField('width', 'W')}
        {boxField('height', 'H')}
      </div>
      {o.kind === 'text' && (
        <Field label="Text">
          <input value={o.text ?? ''} onChange={(e) => set({ text: e.target.value })} aria-label="Text" />
        </Field>
      )}
      {words && (
        <>
          <Field label="Font">
            <FontSelect value={o.fontFamily ?? defaultThemes[0].fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
          </Field>
          <Field label="Size">
            <span className="pair">
              <input
                type="number"
                className="num-small"
                min={8}
                value={o.fontSize}
                onChange={(e) => set({ fontSize: Math.max(8, num(e.target.value, o.fontSize)) })}
                aria-label="Font size"
              />
              <select value={o.fontWeight ?? 600} onChange={(e) => set({ fontWeight: Number(e.target.value) })} aria-label="Weight">
                {[300, 400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>
                    {{ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy' }[w]}
                  </option>
                ))}
              </select>
            </span>
          </Field>
          <Field label="Color">
            <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} aria-label="Text color" />
          </Field>
          <div className="insp-row">
            <span className="insp-label">Alignment</span>
            <span className="insp-control align-pair">
              <AlignButtons theme={o} onChange={(a) => set(a as Partial<StageObject>)} />
            </span>
          </div>
          <Field label="Uppercase">
            <Switch checked={!!o.uppercase} onChange={(uppercase) => set({ uppercase })} label="Uppercase" />
          </Field>
        </>
      )}
      {o.kind !== 'shape' && (
        <Field label="Show Label">
          <Switch checked={!!o.showLabel} onChange={(showLabel) => set({ showLabel })} label={`Show “${kind.caption}” above it`} />
        </Field>
      )}
      <Field label="Fill">
        <span className="pair">
          <input
            type="checkbox"
            checked={!!o.fill}
            onChange={(e) => set({ fill: e.target.checked ? '#3a3a3a' : undefined })}
            aria-label="Fill the box"
          />
          <input
            type="color"
            disabled={!o.fill}
            value={o.fill || '#3a3a3a'}
            onChange={(e) => set({ fill: e.target.value })}
            aria-label="Fill color"
          />
        </span>
      </Field>
      {o.kind === 'message' && <p className="small-print muted">Shows while a stage message is up (Messages ▸ Stage).</p>}
      {o.kind === 'videoCountdown' && <p className="small-print muted">The time left in the live video.</p>}
    </section>
  );
}

function LayoutInspector({ layout }: { layout?: StageLayout }) {
  const objectId = useStore((s) => s.stageObjectId);
  const o = layout?.objects.find((x) => x.id === objectId);
  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        <button className="active">{o ? 'Object' : 'Layout'}</button>
      </div>
      <div className="inspector-body">
        {layout && (o ? <ObjectSection layout={layout} o={o} /> : <LayoutSection layout={layout} />)}
        <div className="stage-editor-done">
          <button className="btn primary" onClick={() => useStore.getState().setUI({ mode: 'show', stageObjectId: null })}>
            Done
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Screens ▸ Edit Layouts…: the stage layouts, their objects, and a canvas to place them on. */
export function StageLayoutsEditor() {
  const layout = useLayout();
  useEffect(() => {
    const s = useStore.getState();
    if (layout && s.stageLayoutId !== layout.id) s.setUI({ stageLayoutId: layout.id });
  }, [layout]);
  return (
    <>
      <LayoutList layout={layout} />
      <main className="edit-center">{layout && <LayoutCanvas layout={layout} />}</main>
      <LayoutInspector layout={layout} />
    </>
  );
}
