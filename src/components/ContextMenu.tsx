import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { create } from 'zustand';
import { LABEL_SWATCHES } from '../labels';
import type { ColorLabel } from '../types';
import { MenuList, type MenuEntry } from './MenuSelect';
import { Icon, type IconName } from './ui';

/**
 * A right-click menu entry: an action, a submenu, a section header, or "-" for a separator.
 * Falsy entries are skipped, so menus can be built with `cond && {…}`.
 */
export type ContextEntry =
  | {
      label: string;
      action: () => void;
      disabled?: boolean;
      checked?: boolean;
      shortcut?: string;
      swatch?: string;
      /** An icon before the label. */
      icon?: IconName;
      danger?: boolean;
      title?: string;
    }
  | { label: string; submenu: ContextEntries | (() => ContextEntries); disabled?: boolean; swatch?: string }
  | { header: string }
  | '-';
export type ContextEntries = (ContextEntry | false | null | undefined)[];

/** Turns context entries into MenuList entries, registering each action under the value MenuList reports back. */
function toMenu(entries: ContextEntries, actions: Map<string, () => void>): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === '-') {
      if (out.length && out[out.length - 1].type !== 'separator') out.push({ type: 'separator' });
    } else if ('header' in e) out.push({ type: 'header', label: e.header });
    else if ('submenu' in e) {
      const sub = e.submenu;
      out.push({
        type: 'submenu',
        label: e.label,
        disabled: e.disabled,
        swatch: e.swatch,
        entries: () => toMenu(typeof sub === 'function' ? sub() : sub, actions),
      });
    } else {
      const value = `action-${actions.size}`;
      actions.set(value, e.action);
      const { action: _action, icon, ...rest } = e;
      const label = icon ? (
        <span className="menu-icon-label">
          <Icon name={icon} size={14} />
          {e.label}
        </span>
      ) : (
        e.label
      );
      out.push({ type: 'item', value, ...rest, label, checked: e.checked ?? false });
    }
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

interface Menus {
  menu: { x: number; y: number; entries: MenuEntry[]; actions: Map<string, () => void>; seq: number; target: Element | null } | null;
  popup: { x: number; y: number; node: ReactNode; seq: number } | null;
}

const useMenus = create<Menus>(() => ({ menu: null, popup: null }));
let seq = 0;
let lastPoint = { x: 0, y: 0 };

function closeMenu() {
  useMenus.getState().menu?.target?.classList.remove('context-target');
  useMenus.setState({ menu: null });
}

type PointerLike = {
  clientX: number;
  clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
  currentTarget?: EventTarget | null;
};

/** Opens a right-click menu at the pointer. The element it was opened on is highlighted while it's open. */
export function openContextMenu(e: PointerLike, entries: ContextEntries) {
  e.preventDefault();
  e.stopPropagation();
  const actions = new Map<string, () => void>();
  const list = toMenu(entries, actions);
  closeMenu();
  if (!list.length) return;
  const target = e.currentTarget instanceof Element ? e.currentTarget : null;
  lastPoint = { x: e.clientX, y: e.clientY };
  target?.classList.add('context-target');
  useMenus.setState({ menu: { x: e.clientX, y: e.clientY, entries: list, actions, seq: ++seq, target }, popup: null });
}

/** Opens a small floating panel (a transition picker, a name field…) at a point, kept on screen. */
export function openPopup(x: number, y: number, node: ReactNode) {
  closeMenu();
  useMenus.setState({ popup: { x, y, node, seq: ++seq } });
}

/** Opens a floating panel under an element, e.g. the button that asked for it. */
export function openPopupBelow(el: Element, node: ReactNode) {
  const r = el.getBoundingClientRect();
  openPopup(r.left, r.bottom + 4, node);
}

export const closePopup = () => useMenus.setState({ popup: null });

/** Opens a floating panel where the last right-click menu opened, for a "…" item chosen from it. */
export const openPopupAtMenu = (node: ReactNode) => openPopup(lastPoint.x, lastPoint.y, node);

/** Escape and clicks elsewhere close it; resizing (and, for menus, leaving the window) too. */
function useDismiss(open: boolean, inside: string, close: () => void, closeOnBlur: boolean) {
  useEffect(() => {
    if (!open) return;
    // A press anywhere else closes it: the pointer press, which comes first and always arrives (an
    // area that starts a selection box on the press can keep the Mac app from sending mousedown).
    const onDown = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest(inside)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close this, not a dialog behind it.
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    // Not for panels: a color well's system picker takes focus from the window.
    if (closeOnBlur) window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, inside, close, closeOnBlur]);
}

function Popup({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: x, top: y, visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const M = 8;
    // Placed again whenever it changes size (a panel that grows once its preview is drawn,
    // say), so all of it, rounded corners included, stays in the window.
    const place = () => {
      const left = Math.max(M, Math.min(x, window.innerWidth - el.offsetWidth - M));
      const top = Math.max(M, Math.min(y, window.innerHeight - el.offsetHeight - M));
      setStyle({ left, top });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y]);
  return (
    <div ref={ref} className="floating-popup" style={style} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** Renders the open right-click menu and floating panel. Mount once, in the control window. */
export function ContextMenuHost() {
  const menu = useMenus((s) => s.menu);
  const popup = useMenus((s) => s.popup);
  useDismiss(!!menu, '.context-menu', closeMenu, true);
  useDismiss(!!popup, '.floating-popup', closePopup, false);
  return (
    <>
      {menu && (
        // Keys stay in the menu rather than reaching the slide shortcuts.
        <div className="context-menu" onKeyDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <MenuList
            key={menu.seq}
            entries={menu.entries}
            value=""
            anchor={() => new DOMRect(menu.x, menu.y, 0, 0)}
            side="point"
            onClose={closeMenu}
            onPick={(v) => {
              const action = menu.actions.get(v);
              closeMenu();
              action?.();
            }}
          />
        </div>
      )}
      {popup && (
        <Popup key={popup.seq} x={popup.x} y={popup.y}>
          {popup.node}
        </Popup>
      )}
    </>
  );
}

/** A name and a color: for a new or renamed group, a slide label, or (without colors) any rename. */
export function NamePopup({
  title,
  initial,
  colors = true,
  action = 'Save',
  suggestColor,
  onSave,
}: {
  title: string;
  initial: ColorLabel;
  colors?: boolean;
  action?: string;
  /** Picks the color from the name as it's typed ("Chorus" is red), until a color is chosen by hand. */
  suggestColor?: (name: string) => string;
  onSave: (value: ColorLabel) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [picked, setPicked] = useState<string | null>(suggestColor && !initial.name ? null : initial.color);
  const color = picked ?? (name.trim() && suggestColor ? suggestColor(name) : initial.color);
  const setColor = setPicked;
  const save = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), color });
    closePopup();
  };
  return (
    <form
      className="name-popup"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="pop-title">{title}</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} aria-label="Name" />
      {colors && (
        <div className="swatches">
          {LABEL_SWATCHES.map((c) => (
            <button
              key={c.color}
              type="button"
              className={`swatch ${color === c.color ? 'on' : ''}`}
              style={{ background: c.color }}
              onClick={() => setColor(c.color)}
              title={c.name}
              aria-label={c.name}
            />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom color" />
        </div>
      )}
      <div className="button-row">
        <button type="button" className="btn" onClick={closePopup}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={!name.trim()}>
          {action}
        </button>
      </div>
    </form>
  );
}
