import { useEffect, useRef, type ReactNode } from 'react';

const paths = {
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  close: 'M6 6l12 12M18 6L6 18',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  heading: 'M6 4v16M18 4v16M6 12h12',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  theme: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 12.5l4 4-4 4-4-4z',
  reflow: 'M4 6h16M4 12h11a3 3 0 0 1 0 6h-4M13 16l-2 2 2 2M4 18h4',
  bible: 'M6 3h12a1 1 0 0 1 1 1v17H7a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1zM12 7v8M9 10h6',
  more: 'M3.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M17.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3z',
  slides: 'M3 5h18v14H3zM7 9h10M7 13h6',
  library: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  playlist: 'M4 6h12M4 11h12M4 16h7M15 14v6l5-3z',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  lines: 'M4 6h16M4 10h16M4 14h16M4 18h10',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronUp: 'M6 15l6-6 6 6',
  filter: 'M3 5h18M6 12h12M10 19h4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  fill: 'M5 11l7-7 7 7-7 7zM19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignTop: 'M4 4h16M8 8h8v8H8z',
  alignMiddle: 'M4 12h4M16 12h4M8 7h8v10H8z',
  alignBottom: 'M4 20h16M8 8h8v8H8z',
  text: 'M5 5h14M12 5v14M9 19h6',
  megaphone: 'M4 10h3l9-5v14l-9-5H4zM7 14l1.5 5H11l-1.2-4.2M19 9.5a3 3 0 0 1 0 5',
  repeat: 'M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1',
  stop: 'M6 6h12v12H6z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function IconButton({
  icon,
  title,
  onClick,
  active,
  danger,
  disabled,
}: {
  icon: IconName;
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`icon-btn ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-label={title}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * A panel that drops down from its anchor. Render it inside an element with
 * `position: relative` that also contains the button that opens it; clicks
 * inside that element do not close it.
 */
export function Popover({
  open,
  onClose,
  children,
  align = 'left',
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close the popover, not a dialog it sits in.
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`popover ${align} ${className}`}>
      {children}
    </div>
  );
}

/** The small-caps header rows ProPresenter uses above every list ("LIBRARY", "279 ITEMS"). */
export function SectionHeader({
  title,
  onAdd,
  addTitle = 'Add',
  collapsed,
  onToggle,
  children,
}: {
  title: ReactNode;
  onAdd?: () => void;
  addTitle?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="section-header">
      <span className="section-title">{title}</span>
      <span className="section-actions">
        {children}
        {onAdd && <IconButton icon="plus" title={addTitle} onClick={onAdd} />}
        {onToggle && (
          <IconButton icon={collapsed ? 'chevronDown' : 'chevronUp'} title={collapsed ? 'Expand' : 'Collapse'} onClick={onToggle} />
        )}
      </span>
    </div>
  );
}

export function FilterField({
  value,
  onChange,
  placeholder = 'Filter',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="filter-field">
      <Icon name="filter" size={13} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && <IconButton icon="close" title="Clear filter" onClick={() => onChange('')} />}
    </label>
  );
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export function downloadFile(name: string, contents: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Drag payload type for library items dropped onto the playlist. */
export const DRAG_PRESENTATION = 'application/x-lumen-presentation';
export const DRAG_PLAYLIST_ITEM = 'application/x-lumen-playlist-item';
