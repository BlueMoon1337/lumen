/**
 * Presentations made from PowerPoint (.pptx) and Keynote (.key) files. Each slide becomes a
 * picture of itself, shown on the slide layer in place of text: PowerPoint slides drawn by Lumen
 * from the file (src/import/pptx.ts, src/deckRender.ts), Keynote slides exported by Keynote (on
 * a Mac). Each slide keeps its words, for search and the stage display, and its speaker notes as
 * its notes. They go in their own library, and are read-only for now: the original file, and
 * for PowerPoint Lumen's model of it, are kept with the presentation, ready for editing later.
 */
import type { Presentation, PresentationSource, Slide } from './types';

export const SLIDESHOW_LIBRARY_ID = 'slideshows';
export const SLIDESHOW_LIBRARY_NAME = 'PowerPoint & Keynote';

/** Presentations made from another app's file can't be edited (yet). */
export const isReadOnly = (p: Pick<Presentation, 'source'> | undefined | null) => !!p?.source;

export const READ_ONLY_NOTICE =
  'PowerPoint and Keynote presentations can’t be edited in Lumen yet. You can still label their slides and give them transitions.';

/** What a slide says: its text, or an imported slide's words. */
export const slideWords = (sl: Pick<Slide, 'text' | 'source'>) => sl.text || sl.source?.text || '';

const FILE_TYPES: Record<PresentationSource['kind'], string> = {
  powerpoint: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  keynote: 'application/x-iwork-keynote-sffkey',
};

/** Stored files a presentation keeps for itself: imported slides' pictures, the original file and its model. */
export function ownFiles(p: Presentation): { id: string; mime: string }[] {
  const files = p.groups.flatMap((g) => g.slides.flatMap((sl) => (sl.source ? [{ id: sl.source.picture, mime: 'image/jpeg' }] : [])));
  if (p.source?.fileId) files.push({ id: p.source.fileId, mime: FILE_TYPES[p.source.kind] });
  if (p.source?.modelId) files.push({ id: p.source.modelId, mime: 'application/json' });
  return files;
}

/**
 * A presentation whose stored files are missing (from a Lumen file without them): slides without
 * their picture become text slides of their words, and without any pictures it's editable again.
 */
export function withoutMissingFiles(p: Presentation, has: (id: string) => boolean): Presentation {
  if (!p.source && !p.groups.some((g) => g.slides.some((sl) => sl.source))) return p;
  const groups = p.groups.map((g) => ({
    ...g,
    slides: g.slides.map((sl) =>
      sl.source && !has(sl.source.picture) ? { ...sl, text: sl.text || sl.source.text, source: undefined } : sl,
    ),
  }));
  const pictures = groups.some((g) => g.slides.some((sl) => sl.source));
  const source = p.source && pictures ? { ...p.source } : undefined;
  if (source?.fileId && !has(source.fileId)) delete source.fileId;
  if (source?.modelId && !has(source.modelId)) delete source.modelId;
  return { ...p, groups, source };
}
