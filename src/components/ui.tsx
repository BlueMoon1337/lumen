import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { notify } from '../notices';

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
  pause: 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z',
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
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
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
  center: 'M12 2v5M12 17v5M2 12h5M17 12h5M8 8h8v8H8z',
  outro: 'M5 4l10 8-10 8zM19 4v16',
  backdrop: 'M3 4h18v12H3zM8 20h8M12 16v4M3 13l5-4 4 3 3-2 6 4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16',
  crossfade: 'M3 4c7 0 10 13 18 13M3 17c8 0 11-13 18-13M3 21h18',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  layout: 'M3 4h18v16H3zM9 4v16M9 12h12',
  logo: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM12 8v8M8.5 12h7',
  timer: 'M10 2h4M12 2v3M12 13l3-3M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignTop: 'M4 4h16M8 8h8v8H8z',
  alignMiddle: 'M4 12h4M16 12h4M8 7h8v10H8z',
  alignBottom: 'M4 20h16M8 8h8v8H8z',
  text: 'M5 5h14M12 5v14M9 19h6',
  megaphone: 'M4 10h3l9-5v14l-9-5H4zM7 14l1.5 5H11l-1.2-4.2M19 9.5a3 3 0 0 1 0 5',
  repeat: 'M17 2l3 3-3 3M20 5H8a4 4 0 0 0-4 4v1M7 22l-3-3 3-3M4 19h12a4 4 0 0 0 4-4v-1',
  stop: 'M6 6h12v12H6z',
  back10: 'M11 7l-5 5 5 5M18 7l-5 5 5 5',
  previousTrack: 'M5 6h2.5v12H5zM19 6v12L9 12z',
  nextTrack: 'M16.5 6H19v12h-2.5zM5 6v12l10-6z',
  forward10: 'M13 7l5 5-5 5M6 7l5 5-5 5',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
} as const;

export type IconName = keyof typeof paths;

/** Icons drawn solid rather than as outlines, to read at a glance (pause: two bars). */
const SOLID = new Set<IconName>(['pause', 'previousTrack', 'nextTrack']);

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  if (SOLID.has(name))
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d={paths[name]} />
      </svg>
    );
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
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
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
        onClick(e);
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

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** How a shortcut reads on this computer: "⌥⌘C" or "⇧⌘Z" on a Mac, "Ctrl+Alt+C" or "Ctrl+Shift+Z" elsewhere. */
export const shortcut = (key: string, alt = false, shift = false) =>
  IS_MAC ? `${alt ? '⌥' : ''}${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;

/** File extensions for the types a file input's `accept` names, for the desktop app's Open panel. */
const EXTENSIONS_BY_TYPE: Record<string, string[]> = {
  'image/*': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff', 'avif'],
  'video/*': ['mp4', 'm4v', 'mov', 'webm', 'mkv'],
  'audio/*': ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'aif', 'aiff'],
  'text/plain': ['txt'],
  'application/json': ['json'],
};

export function extensionsOf(accept: string): string[] {
  const out = new Set<string>();
  for (const part of accept.split(',').map((p) => p.trim().toLowerCase())) {
    if (part.startsWith('.')) out.add(part.slice(1));
    else for (const ext of EXTENSIONS_BY_TYPE[part] ?? []) out.add(ext);
  }
  return [...out];
}

const opened = (e: unknown) => {
  notify(`Couldn’t open that: ${e instanceof Error ? e.message : String(e)}`, 'error');
  return { folder: null, files: [] as File[] };
};

/**
 * Asks for files. The desktop app shows the system's Open panel itself: its web view only opens
 * a file chooser for a click in the page, not for a menu command.
 */
export function pickFiles(accept: string, multiple = true, kind = 'Supported Files'): Promise<File[]> {
  const bridge = window.lumenDesktop;
  if (bridge)
    return bridge
      .openFiles({ extensions: extensionsOf(accept), kind, multiple, folder: false })
      .catch(opened)
      .then((r) => r.files);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Asks for a folder: its name, and the files in it and its subfolders with these extensions. Nothing when cancelled. */
export async function pickFolder(extensions: string[]): Promise<{ name: string; files: File[] }> {
  const bridge = window.lumenDesktop;
  if (bridge) {
    const r = await bridge.openFiles({ extensions, kind: 'Folder', multiple: true, folder: true }).catch(opened);
    return { name: r.folder ?? '', files: r.files };
  }
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
  const wanted = (f: File) => extensions.some((ext) => f.name.toLowerCase().endsWith(`.${ext}`)) && !f.name.startsWith('.');
  return { name: files[0]?.webkitRelativePath.split('/')[0] ?? '', files: files.filter(wanted) };
}

/** Saves a file through the browser's downloads. The desktop app saves with a Save panel instead (src/components/fileCommands.ts). */
export function downloadFile(name: string, contents: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Whether a drag started inside Lumen. A picture dragged out of a slide carries a file too, so
 * drop zones for files (the media bin, the Audio tab) take files only from outside: Finder, the
 * desktop, another app.
 */
let insideDrag = false;
if (typeof window !== 'undefined') {
  window.addEventListener('dragstart', () => (insideDrag = true), true);
  window.addEventListener('dragend', () => (insideDrag = false), true);
  window.addEventListener('drop', () => setTimeout(() => (insideDrag = false)), true);
}

/**
 * Dragging near the top or bottom edge of a list (the library, a playlist, the media bin, the
 * slides) scrolls it, faster the closer the pointer is to the edge: the Mac app's web view doesn't
 * do it by itself.
 */
const EDGE = 48;
const MAX_STEP = 22;
let autoScroll: { el: HTMLElement; step: number } | null = null;
let scrollFrame = 0;

function scrollableAt(target: EventTarget | null, y: number): { el: HTMLElement; step: number } | null {
  for (let el = target instanceof Element ? (target as HTMLElement) : null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const r = el.getBoundingClientRect();
    const edge = Math.min(EDGE, r.height / 4);
    let step = 0;
    if (y < r.top + edge && el.scrollTop > 0) step = -MAX_STEP * ((r.top + edge - y) / edge);
    else if (y > r.bottom - edge && el.scrollTop + el.clientHeight < el.scrollHeight - 1)
      step = MAX_STEP * ((y - (r.bottom - edge)) / edge);
    if (step) return { el, step: Math.max(-MAX_STEP, Math.min(MAX_STEP, step)) };
  }
  return null;
}

function scrollTick() {
  scrollFrame = 0;
  if (!autoScroll) return;
  autoScroll.el.scrollTop += autoScroll.step;
  scrollFrame = requestAnimationFrame(scrollTick);
}

function stopAutoScroll() {
  autoScroll = null;
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'dragover',
    (e) => {
      autoScroll = scrollableAt(e.target, e.clientY);
      if (autoScroll && !scrollFrame) scrollFrame = requestAnimationFrame(scrollTick);
    },
    true,
  );
  for (const type of ['drop', 'dragend'] as const) window.addEventListener(type, stopAutoScroll, true);
  // Leaving the window (dragleave with nowhere to go) stops it too.
  window.addEventListener('dragleave', (e) => !e.relatedTarget && stopAutoScroll(), true);
}

/** Files dragged in from outside Lumen (not a slide's picture dragged across the window). */
export const hasOutsideFiles = (e: { dataTransfer: DataTransfer | null }) => !insideDrag && !!e.dataTransfer?.types.includes('Files');

/** Drag payload type for library items dropped onto the playlist. */
export const DRAG_PRESENTATION = 'application/x-lumen-presentation';
export const DRAG_PLAYLIST_ITEM = 'application/x-lumen-playlist-item';
/** Drag payload type for media bin items dropped on media playlists or slides. */
export const DRAG_MEDIA = 'application/x-lumen-media';
/** Alongside DRAG_MEDIA (the item dragged), every highlighted item dragged with it: their ids as JSON. */
export const DRAG_MEDIA_IDS = 'application/x-lumen-media-ids';
/** Alongside DRAG_PRESENTATION, every highlighted presentation dragged with it: their ids as JSON. */
export const DRAG_PRESENTATION_IDS = 'application/x-lumen-presentation-ids';

/**
 * What follows the pointer while something is dragged. The Mac app's web view draws its own
 * picture of a dragged element wrongly (with pieces of the rest of the window in it, and copies
 * left behind), so Lumen hides that picture and moves its own: a see-through copy of the slide or
 * item, as ProPresenter shows, or a small label.
 */
let ghost: { el: HTMLElement; dx: number; dy: number } | null = null;
/** The slide or item being dragged, dimmed where it was. */
let dimmed: HTMLElement | null = null;
/** A transparent picture for the web view to show (loaded before any drag starts). */
const BLANK = typeof Image === 'undefined' ? null : new Image();
if (BLANK) BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function moveGhost(e: { clientX: number; clientY: number }) {
  // Some drag events carry no position (0, 0); the copy stays where it was then.
  if (!ghost || (e.clientX === 0 && e.clientY === 0)) return;
  ghost.el.style.transform = `translate(${e.clientX - ghost.dx}px, ${e.clientY - ghost.dy}px)`;
}

function endGhost() {
  ghost?.el.remove();
  ghost = null;
  // Its own style, as its class belongs to React (which redraws it while it's dragged over).
  if (dimmed) dimmed.style.opacity = '';
  dimmed = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('dragover', moveGhost, true);
  window.addEventListener('drag', moveGhost, true);
  for (const type of ['dragend', 'drop'] as const) window.addEventListener(type, () => setTimeout(endGhost), true);
}

/** A drag event, as React or the page gives it. */
type DragPoint = { dataTransfer: DataTransfer; clientX: number; clientY: number };

function startGhost(e: DragPoint, el: HTMLElement, dx: number, dy: number) {
  endGhost();
  if (BLANK) e.dataTransfer.setDragImage(BLANK, 0, 0);
  el.classList.add('drag-ghost');
  document.body.appendChild(el);
  ghost = { el, dx, dy };
  moveGhost(e);
}

/**
 * Drags a see-through copy of `source` (a slide or media item), held where it was picked up; with
 * `count` over one, a badge says how many are dragged. The item itself dims while it's dragged.
 */
export function setDragPreview(e: DragPoint, source: HTMLElement, count = 1) {
  const r = source.getBoundingClientRect();
  const copy = source.cloneNode(true) as HTMLElement;
  copy.classList.remove('selected', 'live', 'move-before', 'move-after', 'drop-media');
  copy.removeAttribute('data-slide-id');
  copy.style.width = `${r.width}px`;
  copy.style.height = `${r.height}px`;
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'drag-count';
    badge.textContent = String(count);
    copy.appendChild(badge);
  }
  startGhost(e, copy, e.clientX - r.left, e.clientY - r.top);
  dimmed = source;
  source.style.opacity = '0.45';
}

/** Drags a small label ("A Dios vamos adorar", "3 presentations") under the pointer. */
export function setDragLabel(e: DragPoint, label: string) {
  const chip = document.createElement('div');
  chip.className = 'drag-chip';
  chip.textContent = label.length > 40 ? `${label.slice(0, 39)}…` : label;
  startGhost(e, chip, -12, -12);
}

/**
 * Where something dragged over the open space of a grid or list (between items, or after the last)
 * would go: after the item to its left in the row it's level with (before the row's first item if
 * there's none), or after the last item when it's below them all. Null over the space between
 * rows. `selector` picks the items, in the order shown.
 */
export function nearestGap(container: HTMLElement, selector: string, x: number, y: number): { el: HTMLElement; after: boolean } | null {
  const items = [...container.querySelectorAll<HTMLElement>(selector)].map((el) => ({ el, r: el.getBoundingClientRect() }));
  if (!items.length) return null;
  const row = items.filter(({ r }) => y >= r.top && y <= r.bottom);
  if (row.length) {
    const left = row.filter(({ r }) => r.right <= x + 1).at(-1);
    return left ? { el: left.el, after: true } : { el: row[0].el, after: false };
  }
  const last = items[items.length - 1];
  return y > last.r.bottom ? { el: last.el, after: true } : null;
}

/**
 * Selecting by dragging a box over the open space of a grid or list: the items it touches are
 * selected (added to what's selected with ⇧, ⌘ or Ctrl held), and near the top or bottom edge the
 * list scrolls along. A click on the open space without dragging selects nothing. Spread
 * `onPointerDown` on the container (given `ref`, positioned) and render `marquee` inside it.
 */
export function useMarqueeSelect(opts: {
  /** Selects the items, in the order shown. */
  items: string;
  idOf: (el: HTMLElement) => string;
  selected: () => string[];
  select: (ids: string[]) => void;
  onStart?: () => void;
  /** What scrolls when the box nears an edge (the container itself, unless given). */
  scroller?: (el: HTMLElement) => HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0 || (e.target as Element).closest(`${opts.items}, button, input`)) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    opts.onStart?.();
    const adding = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = adding ? opts.selected() : [];
    // Positions inside the list, so the box stays put on the items when the list scrolls.
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
      for (const item of el.querySelectorAll<HTMLElement>(opts.items)) {
        const r = item.getBoundingClientRect();
        const a = local(r.left, r.top);
        if (a.x < rect.left + rect.width && a.x + r.width > rect.left && a.y < rect.top + rect.height && a.y + r.height > rect.top)
          hits.push(opts.idOf(item));
      }
      const ids = [...new Set([...base, ...hits])];
      const current = opts.selected();
      if (ids.length !== current.length || ids.some((id, i) => id !== current[i])) opts.select(ids);
    };
    const scroller = opts.scroller ? opts.scroller(el) : el;
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
      if (!moved && !adding) opts.select([]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const marquee = box && <div className="marquee" style={box} />;
  return { ref, onPointerDown, marquee };
}

/** The ids a drag carries: the highlighted items dragged together (`listType`), or the one (`type`). */
export function draggedIds(e: { dataTransfer: DataTransfer }, type: string, listType: string): string[] {
  try {
    const list = JSON.parse(e.dataTransfer.getData(listType) || 'null') as unknown;
    if (Array.isArray(list) && list.length) return list.filter((x): x is string => typeof x === 'string');
  } catch {
    // Not a list: the one item.
  }
  const id = e.dataTransfer.getData(type);
  return id ? [id] : [];
}

/** Drag payload type for audio tracks dropped on audio playlists: `{ ids, from }` as JSON (`from`: the playlist they're dragged out of). */
export const DRAG_AUDIO = 'application/x-lumen-audio';
