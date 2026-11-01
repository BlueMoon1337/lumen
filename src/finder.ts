/**
 * Lumen's media folders in Finder (the desktop app): the media bin's images and videos live in
 * Documents ▸ Lumen ▸ Media ▸ Assets and the Audio tab's tracks in Media ▸ Audio, as files Lumen
 * plays from where they are (see src/media.ts and src-tauri/src/finder.rs). Show in Finder opens
 * with an item's file selected; a file moved or deleted in Finder can be reconnected.
 */
import { useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { openContextMenu, type ContextEntries } from './components/ContextMenu';
import { deleteMedia } from './components/deleting';
import { pickFiles } from './components/ui';
import { getMediaBlob, keepsFiles, loadMedia, mediaFileOf, storeMediaFile, useMissingMedia } from './media';
import { dismiss, notify, renotify } from './notices';
import { extensionForMime, mimeFromName, useStore } from './store';
import type { MediaItem } from './types';

const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform;

/** The menu item's name on this computer. */
export const FINDER_LABEL = /Mac/.test(PLATFORM) ? 'Show in Finder' : /Win/.test(PLATFORM) ? 'Show in Explorer' : 'Show in Folder';

/** Only the desktop app can keep files and open Finder. */
export const canShowInFinder = () => !!window.lumenDesktop?.finderFile && keepsFiles();

/** The item's file name: its name, with the extension its type has (unless the name has it). */
export function finderName(m: Pick<MediaItem, 'name' | 'mime'>): string {
  const name =
    m.name
      .replace(/[/\\:]/g, '-')
      .replace(/^\.+/, '')
      .trim() || 'Untitled';
  const ext = extensionForMime(m.mime);
  return !ext || mimeFromName(name) === m.mime.toLowerCase() ? name : `${name}.${ext}`;
}

/** Saves an item Lumen still keeps itself as a file in its folder (and plays it from there). */
async function moveToFolder(m: MediaItem): Promise<boolean> {
  if (await mediaFileOf(m.id)) return true;
  const blob = await getMediaBlob(m.id);
  if (!blob) return false;
  await storeMediaFile(m.id, blob, finderName(m), m.kind, m.mime);
  return true;
}

/** Shows the items' files in Finder (the last one selected), offering to reconnect any that are missing. */
export async function showInFinder(items: MediaItem[]): Promise<void> {
  const desktop = window.lumenDesktop;
  if (!desktop?.revealFinderFile || !items.length) return;
  try {
    let last: { folder: Parameters<typeof desktop.revealFinderFile>[0]; name: string } | null = null;
    for (const m of items) {
      await moveToFolder(m);
      const file = await mediaFileOf(m.id);
      if (!file || !(await desktop.lumenFileExists(file.folder, file.name))) {
        missingNotice(m);
        continue;
      }
      last = { folder: file.folder, name: file.name };
    }
    if (last) await desktop.revealFinderFile(last.folder, last.name);
  } catch (e) {
    notify(`Couldn’t show it in ${FINDER_LABEL.replace('Show in ', '')}: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

/** The kinds of file that can stand in for an item. */
const ACCEPT: Record<MediaItem['kind'], string> = {
  image: 'image/*,.heic,.heif',
  video: 'video/*,.mp4,.m4v,.mov,.webm',
  audio: 'audio/*',
};

/** Asks for the file to use for an item whose file is missing, and puts it in Lumen's folder. */
export async function reconnectMedia(m: MediaItem): Promise<void> {
  const [file] = await pickFiles(ACCEPT[m.kind], false, m.kind === 'audio' ? 'Audio' : m.kind === 'video' ? 'Videos' : 'Images');
  if (!file) return;
  const type = file.type || mimeFromName(file.name) || m.mime;
  if (!type.startsWith(`${m.kind}/`))
    return void notify(`“${m.name}” is ${m.kind === 'audio' ? 'audio' : `a ${m.kind}`}: choose a file of that kind.`, 'info');
  try {
    await storeMediaFile(m.id, file, file.name, m.kind, type);
    notify(`Reconnected “${m.name}”.`, 'success', 2500);
  } catch (e) {
    notify(`Couldn’t reconnect “${m.name}”: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

function missingNotice(m: MediaItem) {
  notify(`“${m.name}”’s file is missing from Documents ▸ Lumen. Right-click it ▸ Reconnect File… to find it.`, 'error', 6000);
}

/** Whether an item's file is missing: loads it once to find out. */
export function useIsMissing(id: string): boolean {
  useEffect(() => void loadMedia(id), [id]);
  return useMissingMedia((s) => s.ids.includes(id));
}

/** Reconnect File… and Delete…, for an item whose file is missing. */
export function missingEntries(m: MediaItem): ContextEntries {
  return [
    { header: 'File Missing' },
    { label: 'Reconnect File…', action: () => void reconnectMedia(m) },
    { label: 'Delete…', danger: true, action: () => deleteMedia(m.id) },
    '-',
  ];
}

/** Clicking an item whose file is missing offers to reconnect it or delete it. */
export function offerReconnect(e: MouseEvent | ReactMouseEvent, m: MediaItem) {
  openContextMenu(e, missingEntries(m).slice(0, -1));
}

/**
 * Media Lumen kept itself (everything before this version, in the desktop app) moves into its
 * folders: each item is saved as a file there, then played from it, which frees the space Lumen
 * held it in. Runs once at launch, a file at a time; anything that can't be moved stays as it was.
 */
export async function moveMediaToFolders(): Promise<void> {
  if (!canShowInFinder()) return;
  const items = useStore.getState().media;
  const waiting: MediaItem[] = [];
  for (const m of items) if (!(await mediaFileOf(m.id))) waiting.push(m);
  if (!waiting.length) return;
  const notice = notify(`Moving media into Documents ▸ Lumen ▸ Media (0 of ${waiting.length})…`, 'info', 0);
  let done = 0;
  let failed = 0;
  for (const m of waiting) {
    try {
      if (!(await moveToFolder(m))) failed++;
    } catch {
      failed++;
    }
    renotify(notice, `Moving media into Documents ▸ Lumen ▸ Media (${++done} of ${waiting.length})…`);
  }
  dismiss(notice);
  if (done - failed > 0)
    notify(
      `Moved ${done - failed} item${done - failed === 1 ? '' : 's'} into Documents ▸ Lumen ▸ Media (Assets and Audio).`,
      'success',
      4000,
    );
}
