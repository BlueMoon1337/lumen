/**
 * Show in Finder (Explorer on Windows) for media and audio, in the desktop app. Lumen keeps media
 * in its own storage, so the item is first saved as a file in Documents ▸ Lumen ▸ Media (or Audio),
 * once; Finder then opens with that file selected. See src-tauri/src/finder.rs.
 */
import { getMediaBlob } from './media';
import { notify } from './notices';
import { extensionForMime, mimeFromName } from './store';
import type { MediaItem } from './types';

const PLATFORM = typeof navigator === 'undefined' ? '' : navigator.platform;

/** The menu item's name on this computer. */
export const FINDER_LABEL = /Mac/.test(PLATFORM) ? 'Show in Finder' : /Win/.test(PLATFORM) ? 'Show in Explorer' : 'Show in Folder';

/** Only the desktop app can save files and open Finder. */
export const canShowInFinder = () => !!window.lumenDesktop?.finderFile;

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

/** Saves the items (the first time) and shows the last one in Finder. */
export async function showInFinder(items: MediaItem[]): Promise<void> {
  const desktop = window.lumenDesktop;
  if (!desktop?.finderFile || !items.length) return;
  try {
    let last: { folder: 'Media' | 'Audio'; name: string } | null = null;
    for (const m of items) {
      const blob = await getMediaBlob(m.id);
      if (!blob) throw new Error(`“${m.name}” is missing from Lumen’s storage.`);
      const folder = m.kind === 'audio' ? 'Audio' : 'Media';
      const file = await desktop.finderFile(folder, finderName(m), blob.size);
      if (!file.saved) await desktop.writeFinderFile(folder, file.name, new Uint8Array(await blob.arrayBuffer()));
      last = { folder, name: file.name };
    }
    if (last) await desktop.revealFinderFile(last.folder, last.name);
  } catch (e) {
    notify(`Couldn’t show it in ${FINDER_LABEL.replace('Show in ', '')}: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}
