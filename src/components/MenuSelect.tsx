import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

/** Entries of a ProPresenter-style pop-up menu: a checkmark on the current item, section headers, separators and submenus. */
export type MenuEntry =
  | { type: 'header'; label: string }
  | { type: 'separator' }
  | { type: 'item'; value: string; label: ReactNode; detail?: ReactNode; thumbnail?: ReactNode; disabled?: boolean; title?: string }
  | { type: 'submenu'; label: string; entries: MenuEntry[]; disabled?: boolean }
  | { type: 'note'; text: ReactNode };

const MARGIN = 8;

/** Places a fixed-position menu next to an anchor rectangle, flipping and clamping so it stays on screen. */
function usePlacement(open: boolean, anchor: () => DOMRect | undefined, side: 'below' | 'right') {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    const a = anchor();
    if (!open || !el || !a) return;
    const { innerWidth: W, innerHeight: H } = window;
    const w = Math.max(el.offsetWidth, side === 'below' ? a.width : 0);
    const h = Math.min(el.scrollHeight, H - MARGIN * 2);
    let left = side === 'below' ? a.left : a.right - 4;
    let top = side === 'below' ? a.bottom + 4 : a.top - 6;
    if (side === 'right' && left + w > W - MARGIN) left = a.left - w + 4;
    if (side === 'below' && top + h > H - MARGIN) top = a.top - h - 4 >= MARGIN ? a.top - h - 4 : H - MARGIN - h;
    left = Math.max(MARGIN, Math.min(left, W - MARGIN - w));
    top = Math.max(MARGIN, Math.min(top, H - MARGIN - h));
    setStyle({ left, top, minWidth: side === 'below' ? a.width : undefined, maxHeight: H - MARGIN * 2 });
    // anchor() reads the DOM; place the menu once, when it opens.
  }, [open, side]);
  return { ref, style };
}

function MenuList({
  entries,
  value,
  onPick,
  anchor,
  side,
  onClose,
  className = '',
}: {
  entries: MenuEntry[];
  value: string;
  onPick: (v: string) => void;
  anchor: () => DOMRect | undefined;
  side: 'below' | 'right';
  onClose: () => void;
  className?: string;
}) {
  const { ref, style } = usePlacement(true, anchor, side);
  const [sub, setSub] = useState<{ index: number; rect: DOMRect } | null>(null);
  const subEntry = sub ? entries[sub.index] : undefined;

  useEffect(() => {
    // Focus the checked item (or the first) so the arrow keys work straight away.
    const el = ref.current;
    (
      el?.querySelector<HTMLButtonElement>('button.checked:not(:disabled)') ?? el?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    )?.focus();
  }, [ref]);

  const onKey = (e: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) {
      e.preventDefault();
      (document.activeElement as HTMLButtonElement).click();
    } else if (e.key === 'ArrowLeft' && side === 'right') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div ref={ref} className={`menu-select-list ${className}`} style={style} role="menu" onKeyDown={onKey}>
      {entries.map((entry, i) => {
        if (entry.type === 'header')
          return (
            <div key={i} className="msl-header">
              {entry.label}
            </div>
          );
        if (entry.type === 'separator') return <hr key={i} />;
        if (entry.type === 'note')
          return (
            <div key={i} className="msl-note">
              {entry.text}
            </div>
          );
        if (entry.type === 'submenu')
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub?.index === i}
              className={`msl-item has-sub ${sub?.index === i ? 'open' : ''}`}
              disabled={entry.disabled}
              onMouseEnter={(e) => setSub({ index: i, rect: e.currentTarget.getBoundingClientRect() })}
              onClick={(e) => setSub(sub?.index === i ? null : { index: i, rect: e.currentTarget.getBoundingClientRect() })}
            >
              <span className="msl-check" />
              <span className="msl-label">{entry.label}</span>
              <span className="msl-arrow">›</span>
            </button>
          );
        const checked = entry.value === value;
        return (
          <button
            key={i}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            className={`msl-item ${checked ? 'checked' : ''} ${entry.thumbnail ? 'with-thumb' : ''}`}
            disabled={entry.disabled}
            title={entry.title}
            onMouseEnter={() => setSub(null)}
            onClick={() => onPick(entry.value)}
          >
            <span className="msl-check">{checked ? '✓' : ''}</span>
            {entry.thumbnail && <span className="msl-thumb">{entry.thumbnail}</span>}
            <span className="msl-label">
              {entry.label}
              {entry.detail && <span className="msl-detail">{entry.detail}</span>}
            </span>
          </button>
        );
      })}
      {subEntry?.type === 'submenu' && sub && (
        <MenuList
          key={sub.index}
          entries={subEntry.entries}
          value={value}
          onPick={onPick}
          anchor={() => sub.rect}
          side="right"
          onClose={() => setSub(null)}
          className="msl-sub"
        />
      )}
    </div>
  );
}

/** A pop-up button like ProPresenter's (and macOS's): shows the current choice; the menu marks it with a checkmark. */
export function MenuSelect({
  value,
  entries,
  onChange,
  display,
  disabled,
  label,
  className = '',
}: {
  value: string;
  entries: MenuEntry[];
  onChange: (value: string) => void;
  /** What the button shows; defaults to the checked item's label. */
  display?: ReactNode;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close the menu, not the dialog behind it.
      e.stopImmediatePropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const find = (list: MenuEntry[]): ReactNode =>
    list.reduce<ReactNode>(
      (found, e) => found ?? (e.type === 'item' && e.value === value ? e.label : e.type === 'submenu' ? find(e.entries) : undefined),
      undefined,
    );

  return (
    <div ref={root} className={`menu-select ${className}`}>
      <button
        ref={button}
        type="button"
        className="menu-select-button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="menu-select-value">{display ?? find(entries)}</span>
        <svg className="menu-select-chevrons" viewBox="0 0 10 16" aria-hidden="true">
          <path
            d="M2 6l3-3 3 3M2 10l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <MenuList
          entries={entries}
          value={value}
          anchor={() => button.current?.getBoundingClientRect()}
          side="below"
          onClose={() => setOpen(false)}
          onPick={(v) => {
            setOpen(false);
            button.current?.focus();
            onChange(v);
          }}
        />
      )}
    </div>
  );
}
