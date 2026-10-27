/**
 * The Edit menu, as in ProPresenter: Cut, Copy ▸ (Copy, Copy Text Style), Paste ▸ (Paste,
 * Paste and Match Style, Paste Text Style), Duplicate, Delete, Select All, Deselect All,
 * Search, Spelling and Grammar ▸ and Transformations ▸ (Undo and Redo are in history.ts).
 *
 * What a command does depends on where the focus is: in a text field, it works on the text;
 * in the library or a playlist, on the presentation or entry selected there; elsewhere, on the
 * selected slides. The desktop app's Edit menu, the More menu and the keys all come here, and
 * the desktop menu shows which commands can run.
 */
import { useEffect } from 'react';
import { notify } from '../notices';
import { useStore, type AppState } from '../store';
import type { Presentation } from '../types';
import { isAsking, onAskChange } from './Ask';
import type { ContextEntries } from './ContextMenu';
import { deleteLibrary, deletePlaylist, deletePresentation, deleteSlides, removePlaylistItem } from './deleting';
import { isReadOnly } from '../slideshows';
import { readClipboard } from './fileCommands';
import { openSearch } from './toolbarState';
import { shortcut } from './ui';

export type EditCommand =
  | 'cut'
  | 'copy'
  | 'copy-style'
  | 'paste'
  | 'paste-plain'
  | 'paste-style'
  | 'duplicate'
  | 'delete'
  | 'select-all'
  | 'deselect-all'
  | 'search'
  | 'upper'
  | 'lower'
  | 'capitalize'
  | 'spell-check';

const COMMANDS = new Set<string>([
  'cut',
  'copy',
  'copy-style',
  'paste',
  'paste-plain',
  'paste-style',
  'duplicate',
  'delete',
  'select-all',
  'deselect-all',
  'search',
  'upper',
  'lower',
  'capitalize',
  'spell-check',
]);
export const isEditCommand = (id: string): id is EditCommand => COMMANDS.has(id);

const st = () => useStore.getState();

// ---- Text fields ------------------------------------------------------------------------------

type TextElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number']);

/** The element if it's somewhere to type: a text input, a text area, or editable text. */
export function textField(el: Element | null): TextElement | null {
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement) return TEXT_INPUTS.has(el.type) ? el : null;
  if (el instanceof HTMLElement && el.isContentEditable) return el;
  return null;
}

const isInput = (el: TextElement): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

const canEdit = (el: TextElement) => (isInput(el) ? !el.readOnly && !el.disabled : el.isContentEditable);

/** Where the selection is in a field, to put it back after a menu took the focus. */
type SavedSelection = { start: number; end: number } | Range | null;

function saveSelection(el: TextElement): SavedSelection {
  if (isInput(el)) {
    // Number inputs have no selection.
    if (el.selectionStart === null || el.selectionEnd === null) return null;
    return { start: el.selectionStart, end: el.selectionEnd };
  }
  const sel = window.getSelection();
  return sel && sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
}

function restoreSelection(el: TextElement, saved: SavedSelection) {
  if (document.activeElement !== el) el.focus();
  if (!saved) return;
  if (saved instanceof Range) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(saved);
  } else if (isInput(el)) el.setSelectionRange(saved.start, saved.end);
}

function selectedText(el: TextElement): string {
  if (isInput(el)) {
    if (el.selectionStart === null || el.selectionEnd === null) return '';
    return el.value.slice(el.selectionStart, el.selectionEnd);
  }
  return window.getSelection()?.toString() ?? '';
}

async function writeClipboard(text: string) {
  try {
    const bridge = window.lumenDesktop;
    if (bridge) await bridge.writeClipboardText(text);
    else await navigator.clipboard.writeText(text);
  } catch {
    notify('Lumen couldn’t put that on the clipboard.', 'error');
  }
}

/** Types text in place of the selection, as typing would (so the field's own Undo takes it back). */
const insertText = (text: string) => document.execCommand('insertText', false, text);

/** The word around the caret, when nothing is selected (as macOS's Transformations do). */
function selectWordAtCaret(el: TextElement) {
  if (!isInput(el) || el.selectionStart === null || el.selectionStart !== el.selectionEnd) return;
  const at = el.selectionStart;
  const before = el.value.slice(0, at).match(/[\p{L}\p{N}'’]*$/u)?.[0].length ?? 0;
  const after = el.value.slice(at).match(/^[\p{L}\p{N}'’]*/u)?.[0].length ?? 0;
  el.setSelectionRange(at - before, at + after);
}

const TRANSFORMS: Record<'upper' | 'lower' | 'capitalize', (text: string) => string> = {
  upper: (t) => t.toLocaleUpperCase(),
  lower: (t) => t.toLocaleLowerCase(),
  capitalize: (t) =>
    t.toLocaleLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase()),
};

async function runOnText(cmd: EditCommand, el: TextElement, saved: SavedSelection) {
  restoreSelection(el, saved);
  switch (cmd) {
    case 'copy':
    case 'cut': {
      const text = selectedText(el);
      if (!text) return;
      await writeClipboard(text);
      if (cmd === 'cut' && canEdit(el)) {
        restoreSelection(el, saved);
        document.execCommand('delete');
      }
      return;
    }
    case 'paste':
    case 'paste-plain': {
      const text = await readClipboard();
      if (!text || !canEdit(el)) return;
      // Reading the clipboard can take the focus away for a moment.
      restoreSelection(el, saved);
      insertText(isInput(el) && el instanceof HTMLInputElement ? text.replace(/\r?\n/g, ' ') : text);
      return;
    }
    case 'delete':
      if (selectedText(el) && canEdit(el)) document.execCommand('delete');
      return;
    case 'select-all':
      if (isInput(el)) el.select();
      else document.execCommand('selectAll');
      return;
    case 'deselect-all':
      if (isInput(el)) el.setSelectionRange(el.selectionEnd ?? 0, el.selectionEnd ?? 0);
      else window.getSelection()?.collapseToEnd();
      return;
    case 'upper':
    case 'lower':
    case 'capitalize': {
      if (!canEdit(el)) return;
      selectWordAtCaret(el);
      const text = selectedText(el);
      if (!text) return;
      const start = isInput(el) ? el.selectionStart : null;
      insertText(TRANSFORMS[cmd](text));
      // Keep the changed words selected.
      if (isInput(el) && start !== null) el.setSelectionRange(start, start + text.length);
      return;
    }
  }
}

// ---- Selecting slides -------------------------------------------------------------------------

let anchor: string | null = null;

/**
 * A click on a slide: ⌘-click (Ctrl-click) adds it to the selection or takes it out, ⇧-click
 * selects the slides from the last one clicked; a plain click selects just it and returns true,
 * so the slide can go live (Show mode) or open on the canvas (Edit mode).
 */
export function clickSlide(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, presentationId: string, slideId: string): boolean {
  const s = st();
  const p = s.presentations[presentationId];
  if (!p) return false;
  const order = p.groups.flatMap((g) => g.slides.map((sl) => sl.id));
  const current = s.selectedPresentationId === presentationId ? s.selectedSlideIds : [];
  if (e.metaKey || e.ctrlKey) {
    anchor = slideId;
    s.setUI({ selectedSlideIds: current.includes(slideId) ? current.filter((id) => id !== slideId) : [...current, slideId] });
    return false;
  }
  if (e.shiftKey && anchor && order.includes(anchor)) {
    const [from, to] = [order.indexOf(anchor), order.indexOf(slideId)].sort((a, b) => a - b);
    s.setUI({ selectedSlideIds: order.slice(from, to + 1) });
    return false;
  }
  anchor = slideId;
  s.setUI({ selectedSlideIds: [slideId] });
  return true;
}

/** Right-clicking a slide that isn't selected selects it, so the menu is about it. */
export function selectForMenu(slideId: string) {
  const s = st();
  if (!s.selectedSlideIds.includes(slideId)) {
    anchor = slideId;
    s.setUI({ selectedSlideIds: [slideId] });
  }
}

// ---- Where the focus is -----------------------------------------------------------------------

/** What Edit's commands work on, from where the focus is. */
export type EditContext =
  | { kind: 'text'; el: TextElement; saved: SavedSelection }
  | { kind: 'library'; presentationId: string }
  | { kind: 'playlist'; itemId: string }
  | { kind: 'collections' }
  | { kind: 'slides'; presentation: Presentation; ids: string[] }
  | { kind: 'none' };

/** The selected slides of a presentation, in order; in Edit mode, at least the slide being edited. */
export function selectedSlides(s: AppState, p: Presentation): string[] {
  const chosen = new Set(s.selectedSlideIds);
  const ids = p.groups.flatMap((g) => g.slides.map((sl) => sl.id)).filter((id) => chosen.has(id));
  if (!ids.length && s.mode === 'edit' && s.editSlideId && p.groups.some((g) => g.slides.some((sl) => sl.id === s.editSlideId)))
    return [s.editSlideId];
  return ids;
}

export function editContext(): EditContext {
  const active = document.activeElement;
  const el = textField(active);
  if (el) return { kind: 'text', el, saved: saveSelection(el) };
  const s = st();
  // A window or question in front has the commands to itself.
  if (s.dialog || s.editingThemeId || !s.settings.appIcon || isAsking()) return { kind: 'none' };
  const scope = active instanceof Element ? active.closest('[data-edit-scope]')?.getAttribute('data-edit-scope') : null;
  if (scope === 'library')
    return s.selectedPresentationId && !s.selectedPlaylistItemId
      ? { kind: 'library', presentationId: s.selectedPresentationId }
      : { kind: 'none' };
  if (scope === 'playlist') return s.selectedPlaylistItemId ? { kind: 'playlist', itemId: s.selectedPlaylistItemId } : { kind: 'none' };
  if (scope === 'collections') return { kind: 'collections' };
  const p = s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined;
  if (!p || p.hidden || (s.mode !== 'show' && s.mode !== 'edit')) return { kind: 'none' };
  return { kind: 'slides', presentation: p, ids: selectedSlides(s, p) };
}

/** Puts the focus (and selection) back in the text field a context was taken in, for its own Undo. */
export function refocus(ctx: EditContext) {
  if (ctx.kind === 'text') restoreSelection(ctx.el, ctx.saved);
}

/** The commands that can run in a context. */
export function enabledCommands(ctx: EditContext): Set<EditCommand> {
  const on = new Set<EditCommand>(['spell-check']);
  const s = st();
  if (!s.dialog && !s.editingThemeId && !isAsking()) on.add('search');
  switch (ctx.kind) {
    case 'text': {
      const selected = !!selectedText(ctx.el);
      const editable = canEdit(ctx.el);
      on.add('select-all');
      if (selected) on.add('copy').add('deselect-all');
      if (selected && editable) on.add('cut').add('delete');
      if (editable) on.add('paste').add('paste-plain').add('upper').add('lower').add('capitalize');
      break;
    }
    case 'library':
      on.add('duplicate').add('delete');
      break;
    case 'playlist':
      on.add('delete');
      break;
    case 'collections':
      if (s.sidebar === 'library' ? s.libraries.length > 1 : s.playlists.length > 1) on.add('delete');
      break;
    case 'slides': {
      const any = ctx.ids.length > 0;
      if (isReadOnly(ctx.presentation)) {
        // A PowerPoint or Keynote presentation's slides can be copied, not changed.
        if (any) on.add('copy').add('deselect-all');
        if (ctx.presentation.groups.some((g) => g.slides.length)) on.add('select-all');
        break;
      }
      if (any) on.add('cut').add('copy').add('copy-style').add('duplicate').add('delete').add('deselect-all');
      if (s.slideClipboard?.length) on.add('paste').add('paste-plain');
      if (any && s.styleClipboard) on.add('paste-style');
      if (ctx.presentation.groups.some((g) => g.slides.length)) on.add('select-all');
      break;
    }
  }
  return on;
}

// ---- Running them -----------------------------------------------------------------------------

function runOnSlides(cmd: EditCommand, p: Presentation, ids: string[]) {
  const s = st();
  const editing = s.mode === 'edit';
  const last = ids[ids.length - 1] ?? null;
  switch (cmd) {
    case 'cut':
      return s.cutSlides(p.id, ids);
    case 'copy':
      return s.copySlides(p.id, ids);
    case 'copy-style':
      return ids[0] && s.copyTextStyle(p.id, ids[0]);
    case 'paste':
    case 'paste-plain': {
      const first = s.pasteSlides(p.id, last, { matchStyle: cmd === 'paste-plain' });
      if (first && editing) s.setUI({ editSlideId: first, editTextSelected: false });
      return;
    }
    case 'paste-style':
      return s.pasteTextStyle(p.id, { slideIds: ids });
    case 'duplicate': {
      const copies = s.duplicateSlides(p.id, ids);
      if (copies[0] && editing) s.setUI({ editSlideId: copies[0], editTextSelected: false });
      return;
    }
    case 'delete':
      return deleteSlides(p.id, ids);
    case 'select-all':
      return s.setUI({ selectedSlideIds: p.groups.flatMap((g) => g.slides.map((sl) => sl.id)) });
    case 'deselect-all':
      // In Edit mode the slide on the canvas stays; its text box is let go.
      return s.setUI({ selectedSlideIds: [], editTextSelected: false });
  }
}

/** Runs a command where `ctx` says. Use `runEditCommand` for the focus as it is now. */
export function runIn(cmd: EditCommand, ctx: EditContext) {
  if (cmd === 'search') return openSearch();
  if (cmd === 'spell-check') return st().updateSettings({ spellcheck: st().settings.spellcheck === false });
  if (!enabledCommands(ctx).has(cmd)) return;
  switch (ctx.kind) {
    case 'text':
      return void runOnText(cmd, ctx.el, ctx.saved);
    case 'library':
      if (cmd === 'duplicate') st().duplicatePresentation(ctx.presentationId);
      if (cmd === 'delete') deletePresentation(ctx.presentationId);
      return;
    case 'playlist':
      return cmd === 'delete' && removePlaylistItem(ctx.itemId);
    case 'collections':
      if (cmd === 'delete') {
        const s = st();
        if (s.sidebar === 'library') deleteLibrary(s.libraryCategory);
        else deletePlaylist(s.activePlaylistId);
      }
      return;
    case 'slides':
      return runOnSlides(cmd, ctx.presentation, ctx.ids);
  }
}

/**
 * The web view's own cut, copy and paste (a text field's Ctrl+C, on Windows), so the menu
 * command the same key may also send doesn't do it a second time.
 */
const nativeAt: Record<string, number> = {};
let keyAt: { cmd: EditCommand; time: number } | null = null;
const SAME_PRESS_MS = 400;

if (typeof document !== 'undefined')
  for (const type of ['cut', 'copy', 'paste']) document.addEventListener(type, () => (nativeAt[type] = Date.now()), true);

/** Runs a command from the desktop menu or a key, where the focus is now. */
export function runEditCommand(cmd: EditCommand, source: 'menu' | 'key') {
  const now = Date.now();
  if (source === 'menu') {
    if (now - (nativeAt[cmd] ?? 0) < SAME_PRESS_MS) return;
    if (keyAt?.cmd === cmd && now - keyAt.time < SAME_PRESS_MS) return;
  } else keyAt = { cmd, time: now };
  runIn(cmd, editContext());
}

// ---- Keys -------------------------------------------------------------------------------------

/** The command a key press is, with the modifier keys it needs (⌘ on a Mac, Ctrl elsewhere). */
function commandFor(e: KeyboardEvent): EditCommand | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return !e.altKey && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace') ? 'delete' : null;
  const keys: Record<string, EditCommand> = e.altKey
    ? e.shiftKey
      ? { KeyV: 'paste-plain' }
      : { KeyC: 'copy-style', KeyV: 'paste-style' }
    : e.shiftKey
      ? { KeyA: 'deselect-all' }
      : { KeyX: 'cut', KeyC: 'copy', KeyV: 'paste', KeyD: 'duplicate', KeyA: 'select-all', KeyF: 'search' };
  // e.code, because ⌥C types "ç" on a Mac.
  return keys[e.code] ?? null;
}

/**
 * Edit's keys outside text fields (in them, the field and the Edit menu handle them). In the
 * desktop app the menu's keys come here first on macOS; on Linux the menu takes them.
 */
export function useEditKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = commandFor(e);
      if (!cmd || e.defaultPrevented) return;
      if (cmd !== 'search' && textField(e.target as Element)) return;
      const ctx = editContext();
      if (!enabledCommands(ctx).has(cmd)) return;
      e.preventDefault();
      keyAt = { cmd, time: Date.now() };
      runIn(cmd, ctx);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ---- The desktop menu -------------------------------------------------------------------------

/** Keeps the desktop Edit menu's items on or off as the focus and selection change. */
export function useEditMenuState() {
  useEffect(() => {
    const bridge = window.lumenDesktop;
    if (!bridge) return;
    let sent = '';
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const enabled = [...enabledCommands(editContext())];
        const state = { enabled, spellCheck: st().settings.spellcheck !== false };
        const key = JSON.stringify(state);
        if (key === sent) return;
        sent = key;
        bridge.setEditState(state);
      });
    };
    sync();
    const stop = useStore.subscribe(sync);
    const stopAsk = onAskChange(sync);
    const stopMenu = bridge.onMenu((command) => isEditCommand(command) && runEditCommand(command, 'menu'));
    const events = ['selectionchange', 'focusin', 'focusout', 'input', 'mouseup', 'keyup'];
    for (const type of events) document.addEventListener(type, sync, true);
    return () => {
      cancelAnimationFrame(frame);
      stop();
      stopAsk();
      stopMenu();
      for (const type of events) document.removeEventListener(type, sync, true);
    };
  }, []);
}

// ---- The More menu ----------------------------------------------------------------------------

/** Edit's entries for the More menu, working on `ctx` (where the focus was when it opened). */
export function editEntries(ctx: EditContext): ContextEntries {
  const on = enabledCommands(ctx);
  const item = (label: string, cmd: EditCommand, key?: string) => ({
    label,
    shortcut: key,
    disabled: !on.has(cmd),
    action: () => runIn(cmd, ctx),
  });
  return [
    item('Cut', 'cut', shortcut('X')),
    {
      label: 'Copy',
      submenu: [item('Copy', 'copy', shortcut('C')), item('Copy Text Style', 'copy-style', shortcut('C', true))],
    },
    {
      label: 'Paste',
      submenu: [
        item('Paste', 'paste', shortcut('V')),
        item('Paste and Match Style', 'paste-plain', shortcut('V', true, true)),
        item('Paste Text Style', 'paste-style', shortcut('V', true)),
      ],
    },
    item('Duplicate', 'duplicate', shortcut('D')),
    item('Delete', 'delete', '⌫'),
    item('Select All', 'select-all', shortcut('A')),
    item('Deselect All', 'deselect-all', shortcut('A', false, true)),
    '-',
    item('Search', 'search', shortcut('F')),
    '-',
    {
      label: 'Spelling and Grammar',
      submenu: [
        { label: 'Check Spelling While Typing', checked: st().settings.spellcheck !== false, action: () => runIn('spell-check', ctx) },
      ],
    },
    {
      label: 'Transformations',
      submenu: [item('Make Upper Case', 'upper'), item('Make Lower Case', 'lower'), item('Capitalize', 'capitalize')],
    },
  ];
}
