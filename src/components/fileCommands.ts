/**
 * The File menu, as in ProPresenter: New Presentation, New Playlist, New Library, and the
 * Import and Export submenus. The desktop app's menu bar and the toolbar's More menu both run
 * these. Exports go through the system's Save panel in the desktop app (its web view can't
 * download) and through downloads in a browser.
 */
import { zipSync } from 'fflate';
import { create } from 'zustand';
import { IMPORT_ACCEPT, importFiles, newPresentation } from '../commands';
import { isReadOnly } from '../slideshows';
import {
  EXTENSIONS,
  encodeJson,
  playlistFile,
  presentationFile,
  presentationText,
  safeFileName,
  themesFile,
  zipFile,
  type LumenFile,
} from '../fileFormats';
import { undoBatch } from '../history';
import { getMediaBlob } from '../media';
import { dismiss, notify } from '../notices';
import { slideImages, type SlideImageOptions } from '../slideImages';
import { useStore } from '../store';
import type { Category } from '../types';
import { promptDialog } from './Ask';
import type { ContextEntries } from './ContextMenu';
import { importMediaFiles } from './MediaBin';
import { downloadFile, pickFiles, pickFolder, shortcut } from './ui';

const st = () => useStore.getState();

// ---- Saving ---------------------------------------------------------------------------------

/** Saves a file where the operator chooses; false when they cancelled or it failed (which says why). */
export async function saveBytes(name: string, data: Uint8Array, kind: string, extensions: string[], type = 'application/octet-stream') {
  const bridge = window.lumenDesktop;
  if (!bridge) {
    downloadFile(name, data.slice(), type);
    return true;
  }
  try {
    const path = await bridge.saveFile({ name, data, kind, extensions });
    if (path) notify(`Saved ${path}`, 'success');
    return !!path;
  } catch (e) {
    notify(`Couldn’t save “${name}”: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return false;
  }
}

/** The stored files of the media a Lumen file uses, for zipping with it. */
async function mediaBlobs(file: LumenFile): Promise<Map<string, Uint8Array>> {
  const blobs = new Map<string, Uint8Array>();
  for (const m of [...file.media, ...(file.files ?? [])]) {
    const blob = await getMediaBlob(m.id);
    if (blob) blobs.set(m.id, new Uint8Array(await blob.arrayBuffer()));
  }
  return blobs;
}

/** While something slow runs, a notice says so. */
async function working<T>(text: string, run: () => Promise<T>): Promise<T> {
  const id = notify(text, 'info', 0);
  try {
    return await run();
  } finally {
    dismiss(id);
  }
}

const failed = (what: string) => (e: unknown) => notify(`${what}: ${e instanceof Error ? e.message : String(e)}`, 'error');

// ---- New --------------------------------------------------------------------------------------

export const newPresentationCommand = () => newPresentation(st().libraryCategory);

export async function newPlaylist() {
  const name = await promptDialog({
    title: 'New Playlist',
    defaultValue: 'New Service',
    placeholder: 'Playlist name',
    confirmLabel: 'Create',
  });
  if (!name) return;
  undoBatch('New Playlist', () => {
    st().createPlaylist(name);
    st().setUI({ sidebar: 'playlist' });
  });
}

export async function newLibrary() {
  const name = await promptDialog({
    title: 'New Library',
    defaultValue: 'New Library',
    placeholder: 'Library name',
    confirmLabel: 'Create',
  });
  if (name) st().createLibrary(name);
}

// ---- Import -----------------------------------------------------------------------------------

/** Import ▸ File…: ProPresenter songs and playlists, lyrics, Bibles, and Lumen's own exports. */
export async function importFileCommand(category: Category = st().libraryCategory) {
  const files = await pickFiles(IMPORT_ACCEPT, true, 'Songs, Playlists, Lyrics, Bibles and Slideshows');
  if (files.length) await importFiles(files, category);
}

/** Presentations a library folder can hold. */
const LIBRARY_FILES = ['pro', 'txt', 'lumen', 'lumenbundle'];

/**
 * Import ▸ Library…: a folder of presentations (a ProPresenter library, or any folder of .pro
 * and .txt files) becomes a new library named after the folder.
 */
export async function importLibraryCommand() {
  const { name: folder, files } = await pickFolder(LIBRARY_FILES);
  if (!folder) return;
  if (!files.length) return void notify(`“${folder}” has no presentations in it (.pro or .txt files).`, 'error');
  const taken = new Set(st().libraries.map((l) => l.name.toLowerCase()));
  let name = folder;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${folder} ${n}`;
  await undoBatch(`Import Library ${name}`, async () => {
    const id = st().createLibrary(name);
    await importFiles(files, id);
    st().setUI({ sidebar: 'library', libraryCategory: id, mode: 'show' });
  });
}

/** Import ▸ PowerPoint or Keynote…: slideshows, into the PowerPoint & Keynote library. */
export async function importSlideshowCommand() {
  const files = await pickFiles('.pptx,.key', true, 'PowerPoint and Keynote Presentations');
  if (files.length) await importFiles(files);
}

/** Import ▸ Media…: images and videos to the media bin (the open media playlist too), audio to the Audio tab. */
export async function importMediaCommand() {
  const files = await pickFiles('image/*,video/*,audio/*', true, 'Images, Videos and Audio');
  if (!files.length) return;
  const s = st();
  s.setUI({ showMediaBin: true });
  const added = await importMediaFiles(files, s.mediaFilter === 'playlist' ? s.mediaPlaylistId : null);
  const visual = added.filter((m) => m.kind !== 'audio').length;
  if (visual) notify(`Added ${visual} ${visual === 1 ? 'item' : 'items'} to the media bin.`, 'success', 3500);
}

/** Import ▸ Text from Clipboard…: opens the text in a window to make a presentation from. */
export async function importClipboardCommand() {
  const text = await readClipboard();
  useFileDialogs.setState({ text });
  st().setUI({ dialog: 'textImport' });
}

/** The clipboard's text: from the desktop app, or the browser (which may ask first). Empty if it can't be read. */
export async function readClipboard(): Promise<string> {
  try {
    const bridge = window.lumenDesktop;
    return (bridge ? await bridge.readClipboardText() : await navigator.clipboard.readText()) ?? '';
  } catch {
    return '';
  }
}

/** Import ▸ Import Bible…: a ProPresenter .rvbible, for Bible mode. */
export async function importBibleCommand() {
  const files = await pickFiles('.rvbible', true, 'ProPresenter Bibles');
  if (files.length) await importFiles(files);
}

// ---- Export -----------------------------------------------------------------------------------

/** What File ▸ Export's presentation items export: the selected presentation. */
export function exportTarget() {
  const s = st();
  const p = s.selectedPresentationId ? s.presentations[s.selectedPresentationId] : undefined;
  return p && !p.hidden ? p : undefined;
}

function presentationOrSay(id?: string) {
  const p = id ? st().presentations[id] : exportTarget();
  if (!p) notify('Select a presentation to export first.', 'info');
  return p;
}

/**
 * Export ▸ Presentation…: a .lumen file of its slides and theme (no media files). A PowerPoint or
 * Keynote presentation's slides are pictures, so it's always a bundle.
 */
export async function exportPresentation(id?: string) {
  const p = presentationOrSay(id);
  if (!p) return;
  if (isReadOnly(p)) return exportBundle(p.id);
  const file = presentationFile(st(), p.id);
  await saveBytes(
    `${safeFileName(p.title)}.${EXTENSIONS.presentation}`,
    encodeJson(file),
    'Lumen Presentation',
    [EXTENSIONS.presentation],
    'application/json',
  );
}

/** Export ▸ Presentation Bundle…: the presentation zipped with the images and videos it uses. */
export async function exportBundle(id?: string) {
  const p = presentationOrSay(id);
  if (!p) return;
  const file = presentationFile(st(), p.id);
  const data = await working('Packing the bundle…', async () => zipFile(file, await mediaBlobs(file)));
  await saveBytes(
    `${safeFileName(p.title)}.${EXTENSIONS.bundle}`,
    data,
    'Lumen Presentation Bundle',
    [EXTENSIONS.bundle],
    'application/zip',
  );
}

/** Export ▸ Text…: the words, with [Group] headers, as a .txt file that imports back. */
export async function exportText(id?: string) {
  const p = presentationOrSay(id);
  if (!p) return;
  await saveBytes(`${safeFileName(p.title)}.txt`, new TextEncoder().encode(presentationText(p)), 'Text', ['txt'], 'text/plain');
}

/** Export ▸ Slide Images…: asks for the format and size first. */
export function exportSlideImagesCommand(id?: string) {
  const p = presentationOrSay(id);
  if (!p) return;
  useFileDialogs.setState({ presentationId: p.id });
  st().setUI({ dialog: 'slideImages' });
}

/** Draws the slides and saves them: into a folder in the desktop app, as a .zip in a browser. */
export async function exportSlideImages(id: string, options: SlideImageOptions) {
  const p = st().presentations[id];
  if (!p) return;
  const bridge = window.lumenDesktop;
  // Ask where first, so nothing is drawn for nothing.
  const folder = bridge ? await bridge.chooseExportFolder().catch(failed('Couldn’t choose a folder')) : null;
  if (bridge && !folder) return;
  const progress = notify('Drawing the slides…', 'info', 0);
  try {
    const images = await slideImages(st(), id, options);
    if (!images.length) return void notify('That presentation has no slides.', 'info');
    if (bridge) {
      for (const image of images) await bridge.writeExportFile(image.name, image.data);
      notify(`Saved ${images.length} slide image${images.length === 1 ? '' : 's'} to ${folder}`, 'success');
    } else {
      const zip = zipSync(Object.fromEntries(images.map((i) => [i.name, [i.data, { level: 0 }] as [Uint8Array, { level: 0 }]])));
      downloadFile(`${safeFileName(p.title)} Slides.zip`, zip.slice(), 'application/zip');
    }
  } catch (e) {
    failed('Couldn’t export the slide images')(e);
  } finally {
    dismiss(progress);
  }
}

/** Export ▸ Playlist…: the open playlist with its presentations, themes and media, zipped. */
export async function exportPlaylist(id = st().activePlaylistId) {
  const pl = st().playlists.find((x) => x.id === id);
  if (!pl) return;
  const file = playlistFile(st(), pl);
  const data = await working('Packing the playlist…', async () => zipFile(file, await mediaBlobs(file)));
  await saveBytes(`${safeFileName(pl.name)}.${EXTENSIONS.playlist}`, data, 'Lumen Playlist', [EXTENSIONS.playlist], 'application/zip');
}

/** Export ▸ Themes…: asks which themes first. */
export const exportThemesCommand = () => st().setUI({ dialog: 'exportThemes' });

export async function exportThemes(ids: string[]) {
  const themes = st().themes.filter((t) => ids.includes(t.id));
  if (!themes.length) return;
  const file = themesFile(st(), themes);
  const data = zipFile(file, await mediaBlobs(file));
  const name = themes.length === 1 ? safeFileName(themes[0].name) : 'Lumen Themes';
  await saveBytes(`${name}.${EXTENSIONS.themes}`, data, 'Lumen Themes', [EXTENSIONS.themes], 'application/zip');
}

// ---- The menu ---------------------------------------------------------------------------------

/** What the File dialogs are working on. */
export const useFileDialogs = create<{ text: string; presentationId: string | null }>(() => ({ text: '', presentationId: null }));

/** The desktop menu's File commands, by id (see src-tauri/src/menu.rs). */
const COMMANDS: Record<string, () => unknown> = {
  'new-presentation': newPresentationCommand,
  'new-playlist': newPlaylist,
  'new-library': newLibrary,
  'import-file': () => importFileCommand(),
  'import-library': importLibraryCommand,
  'import-media': importMediaCommand,
  'import-slideshow': importSlideshowCommand,
  'import-clipboard': importClipboardCommand,
  'import-bible': importBibleCommand,
  'export-presentation': () => exportPresentation(),
  'export-bundle': () => exportBundle(),
  'export-text': () => exportText(),
  'export-images': () => exportSlideImagesCommand(),
  'export-playlist': () => exportPlaylist(),
  'export-themes': exportThemesCommand,
};

/** Runs a File command from the desktop menu; false if `id` isn't one. */
export function runFileCommand(id: string): boolean {
  const run = COMMANDS[id];
  if (!run) return false;
  void Promise.resolve(run()).catch(failed('That didn’t work'));
  return true;
}

/** File ▸ Import's items. */
export function importEntries(): ContextEntries {
  return [
    { label: 'File…', shortcut: shortcut('I', false, true), action: () => void importFileCommand() },
    { label: 'Library…', action: () => void importLibraryCommand() },
    { label: 'Media…', action: () => void importMediaCommand() },
    { label: 'PowerPoint or Keynote…', action: () => void importSlideshowCommand() },
    { label: 'Text from Clipboard…', action: () => void importClipboardCommand() },
    '-',
    { label: 'Import Bible…', action: () => void importBibleCommand() },
  ];
}

/** File ▸ Export's items; the first four export the selected presentation. */
export function exportEntries(): ContextEntries {
  const none = !exportTarget();
  return [
    { label: 'Presentation…', disabled: none, action: () => void exportPresentation() },
    { label: 'Presentation Bundle…', disabled: none, action: () => void exportBundle() },
    { label: 'Text…', disabled: none, action: () => void exportText() },
    { label: 'Slide Images…', disabled: none, action: () => exportSlideImagesCommand() },
    '-',
    { label: 'Playlist…', action: () => void exportPlaylist() },
    { label: 'Themes…', action: exportThemesCommand },
  ];
}

/** ProPresenter's File menu, without Print. */
export function fileEntries(): ContextEntries {
  return [
    { label: 'New Presentation', shortcut: shortcut('N'), action: newPresentationCommand },
    { label: 'New Playlist', action: () => void newPlaylist() },
    { label: 'New Library', action: () => void newLibrary() },
    '-',
    { label: 'Import', submenu: importEntries },
    { label: 'Export', submenu: exportEntries },
  ];
}
