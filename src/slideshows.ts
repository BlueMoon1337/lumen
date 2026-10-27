/**
 * Presentations made from PowerPoint (.pptx) and Keynote (.key) files. Each slide becomes a
 * picture of itself, shown on the slide layer in place of text: PowerPoint slides drawn by Lumen
 * from the file (src/import/pptx.ts, src/deckRender.ts), Keynote slides exported by Keynote (on
 * a Mac). Each slide keeps its words, for search and the stage display, and its speaker notes as
 * its notes. They go in their own library. Their slides are edited in Edit mode as Lumen's model
 * of the PowerPoint file (src/deckEdit.ts, components/DeckEditor), and redrawn when changed;
 * Reflow (text only) doesn't apply to them.
 */
import type { Presentation, PresentationSource, Slide } from './types';

export const SLIDESHOW_LIBRARY_ID = 'slideshows';
export const SLIDESHOW_LIBRARY_NAME = 'PowerPoint & Keynote';

/** Made from a PowerPoint or Keynote file: its slides are pictures, so there's no Reflow. */
export const isSlideshow = (p: Pick<Presentation, 'source'> | undefined | null) => !!p?.source;

export const REFLOW_NOTICE = 'Reflow edits slides as text. Edit PowerPoint and Keynote slides in Edit mode instead.';

/** The PowerPoint file a slide is edited from: its own, or (imported before editing) its presentation's. */
export function deckFileOf(p: Pick<Presentation, 'source'>, sl: Pick<Slide, 'source'>): string | undefined {
  if (sl.source?.file) return sl.source.file;
  return p.source?.kind === 'keynote' ? p.source.pptxId : p.source?.fileId;
}

/** What a slide says: its text, or an imported slide's words. */
export const slideWords = (sl: Pick<Slide, 'text' | 'source'>) => sl.text || sl.source?.text || '';

const FILE_TYPES: Record<PresentationSource['kind'], string> = {
  powerpoint: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  keynote: 'application/x-iwork-keynote-sffkey',
};

/** Stored files a presentation keeps for itself: imported slides' pictures, the original file and its model. */
export function ownFiles(p: Presentation): { id: string; mime: string }[] {
  const files = p.groups.flatMap((g) =>
    g.slides.flatMap((sl) => {
      const src = sl.source;
      if (!src) return [];
      const out = [{ id: src.picture, mime: 'image/jpeg' }];
      if (src.file) out.push({ id: src.file, mime: FILE_TYPES.powerpoint });
      if (src.model) out.push({ id: src.model, mime: 'application/json' });
      for (const id of src.images ?? []) out.push({ id, mime: 'image/png' });
      return out;
    }),
  );
  if (p.source?.fileId) files.push({ id: p.source.fileId, mime: FILE_TYPES[p.source.kind] });
  if (p.source?.modelId) files.push({ id: p.source.modelId, mime: 'application/json' });
  if (p.source?.pptxId) files.push({ id: p.source.pptxId, mime: FILE_TYPES.powerpoint });
  return [...new Map(files.map((f) => [f.id, f])).values()];
}

/**
 * A presentation whose stored files are missing (from a Lumen file without them): slides without
 * their picture become text slides of their words, and without any pictures it's an ordinary one.
 */
export function withoutMissingFiles(p: Presentation, has: (id: string) => boolean): Presentation {
  if (!p.source && !p.groups.some((g) => g.slides.some((sl) => sl.source))) return p;
  const groups = p.groups.map((g) => ({
    ...g,
    slides: g.slides.map((sl) => {
      if (!sl.source) return sl;
      if (!has(sl.source.picture)) return { ...sl, text: sl.text || sl.source.text, source: undefined };
      // Without its model or file, a slide still shows; it just can't be edited.
      const source = { ...sl.source };
      if (source.file && !has(source.file)) delete source.file;
      if (source.model && !has(source.model)) delete source.model;
      if (source.images) source.images = source.images.filter(has);
      return { ...sl, source };
    }),
  }));
  const pictures = groups.some((g) => g.slides.some((sl) => sl.source));
  const source = p.source && pictures ? { ...p.source } : undefined;
  if (source?.fileId && !has(source.fileId)) delete source.fileId;
  if (source?.modelId && !has(source.modelId)) delete source.modelId;
  if (source?.pptxId && !has(source.pptxId)) delete source.pptxId;
  return { ...p, groups, source };
}
