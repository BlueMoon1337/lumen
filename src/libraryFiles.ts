/**
 * Libraries in Finder (the desktop app): each presentation is kept as a .lumen file in
 * Documents ▸ Lumen ▸ Libraries ▸ (its library), named after it, as ProPresenter keeps .pro files
 * in its Libraries folder. The files follow the library: a presentation changed, renamed, moved
 * to another library or deleted rewrites, moves or removes its file a moment later. They're copies
 * to find, back up or share (File ▸ Import opens them); Lumen's own library is still the original.
 */
import { notify } from './notices';
import { encodeJson, presentationFile, safeFileName } from './fileFormats';
import type { LumenFolder } from './outputs';
import { useStore } from './store';
import type { Presentation } from './types';

/** Each presentation's file, as written last: its folder, name, and the presentation's updatedAt then. */
type Written = Record<string, { folder: LumenFolder; name: string; at: number }>;

const KEY = 'lumen.libraryFiles';
const WAIT_MS = 1500;

const load = (): Written => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Written;
  } catch {
    return {};
  }
};

const libraryFolder = (name: string): LumenFolder => `Libraries/${safeFileName(name, 'Library')}`;

/** Where a presentation's file goes: its library's folder, and its title (numbered when two match). */
export function plannedFiles(
  presentations: Presentation[],
  libraryName: (category: string) => string,
  written: Written,
): Record<string, { folder: LumenFolder; name: string }> {
  const out: Record<string, { folder: LumenFolder; name: string }> = {};
  const taken = new Set<string>();
  // Ones whose file already has the right name keep it, so a new namesake doesn't take it over.
  const sorted = [...presentations].sort((a, b) => Number(!written[a.id]) - Number(!written[b.id]) || a.title.localeCompare(b.title));
  for (const p of sorted) {
    const folder = libraryFolder(libraryName(p.category));
    const base = safeFileName(p.title);
    let name = `${base}.lumen`;
    for (let n = 2; taken.has(`${folder}/${name}`.toLowerCase()); n++) name = `${base} ${n}.lumen`;
    const was = written[p.id];
    if (was && was.folder === folder && was.name.startsWith(base) && !taken.has(`${folder}/${was.name}`.toLowerCase())) name = was.name;
    taken.add(`${folder}/${name}`.toLowerCase());
    out[p.id] = { folder, name };
  }
  return out;
}

let running: Promise<void> | null = null;
let again: Promise<void> | null = null;

/**
 * Brings the Libraries folder up to date. While a sync runs, another is queued after it (one at a
 * time), and the promise settles when the files reflect the library as it is now, so Show in Finder
 * can wait for a file it's about to show.
 */
export function syncLibraryFiles(): Promise<void> {
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
    return running;
  }
  again ??= running.then(() => {
    again = null;
    return syncLibraryFiles();
  });
  return again;
}

/** Writes, moves and removes presentation files to match the library. */
async function runSync() {
  const desktop = window.lumenDesktop;
  if (!desktop?.writeFinderFile || !desktop.removeLumenFile) return;
  try {
    await desktop.lumenFolder();
    const s = useStore.getState();
    const written = load();
    const shown = Object.values(s.presentations).filter((p) => !p.hidden);
    const libraryName = (id: string) => s.libraries.find((l) => l.id === id)?.name ?? 'Other';
    const plan = plannedFiles(shown, libraryName, written);
    for (const p of shown) {
      const to = plan[p.id];
      const was = written[p.id];
      const moved = was && (was.folder !== to.folder || was.name !== to.name);
      if (!was || moved || was.at !== p.updatedAt) {
        try {
          await desktop.writeFinderFile(to.folder, to.name, encodeJson(presentationFile(s, p.id)));
          if (moved) await desktop.removeLumenFile(was.folder, was.name).catch(() => {});
          written[p.id] = { ...to, at: p.updatedAt };
        } catch {
          // Tried again at the next change.
        }
      }
    }
    for (const id of Object.keys(written)) {
      if (plan[id]) continue;
      await desktop.removeLumenFile(written[id].folder, written[id].name).catch(() => {});
      delete written[id];
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(written));
    } catch {
      // Without it, files are written again next time.
    }
  } catch {
    // Tried again at the next change.
  }
}

/** Keeps the Libraries folder in step with the library, from launch (the desktop app only). */
export function startLibraryFiles(): () => void {
  if (!window.lumenDesktop?.removeLumenFile) return () => {};
  let timer = window.setTimeout(() => void syncLibraryFiles(), WAIT_MS);
  const unsubscribe = useStore.subscribe((s, before) => {
    if (s.presentations === before.presentations && s.libraries === before.libraries) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncLibraryFiles(), WAIT_MS);
  });
  return () => {
    window.clearTimeout(timer);
    unsubscribe();
  };
}

/** Show in Finder for a presentation: its file, written first if it isn't yet. */
export async function revealPresentation(id: string): Promise<void> {
  const desktop = window.lumenDesktop;
  if (!desktop?.revealFinderFile) return;
  await syncLibraryFiles();
  const file = load()[id];
  if (file) await desktop.revealFinderFile(file.folder, file.name);
  else notify('Couldn’t write this presentation’s file in Documents ▸ Lumen ▸ Libraries, so there’s nothing to show yet.', 'error');
}

/** Show in Finder for a library: its folder (or Libraries, before it has any presentations). */
export async function revealLibrary(name: string): Promise<void> {
  const desktop = window.lumenDesktop;
  if (!desktop?.revealLumenFolder) return;
  await syncLibraryFiles();
  const folder = libraryFolder(name);
  const has = Object.values(load()).some((f) => f.folder === folder);
  await desktop.revealLumenFolder(has ? folder : 'Libraries');
}
