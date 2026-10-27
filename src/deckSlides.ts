/**
 * Editing PowerPoint and Keynote slides, the stored side: a slide's model (src/deck.ts) comes
 * from what was saved when it was last edited, or else from the PowerPoint file it was made from;
 * saving keeps the model and redraws the slide's picture. Models and pictures are stored files
 * that never change (each save makes new ones), so Undo just goes back to the slide's old ones.
 */
import type { Deck, DeckElement, DeckSlide, EditableSlide } from './deck';
import { blankSlideLike, slideWordsOf } from './deckEdit';
import { decodeImage, deckImagePaths, fileImage, renderDeckSlide, type Images } from './deckRender';
import { parsePptx } from './import/pptx';
import { readZip } from './import/zip';
import { getMediaBlob, putMediaBlob } from './media';
import * as ops from './slideOps';
import { deckFileOf } from './slideshows';
import { useStore } from './store';
import type { Presentation, Slide, SlideSource } from './types';
import { uid } from './util';

interface OpenDeck {
  deck: Deck;
  files: Map<string, Uint8Array>;
}

const decks = new Map<string, Promise<OpenDeck>>();

/** A stored PowerPoint file, read once. */
function openDeck(fileId: string): Promise<OpenDeck> {
  let open = decks.get(fileId);
  if (!open) {
    open = (async () => {
      const blob = await getMediaBlob(fileId);
      if (!blob) throw new Error('The PowerPoint file this slide came from is missing, so it can’t be edited.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return { deck: parsePptx(bytes), files: readZip(bytes, (n) => n.startsWith('ppt/media/')) };
    })();
    open.catch(() => decks.delete(fileId));
    decks.set(fileId, open);
  }
  return open;
}

export class NeedsKeynote extends Error {}

/** A slide's model to edit: as saved when last edited, or from its PowerPoint file. */
export async function loadEditable(p: Presentation, slide: Slide): Promise<EditableSlide> {
  const src = slide.source;
  if (!src) throw new Error('This isn’t a PowerPoint or Keynote slide.');
  if (src.model) {
    const blob = await getMediaBlob(src.model);
    if (blob) return JSON.parse(await blob.text()) as EditableSlide;
  }
  const file = deckFileOf(p, slide);
  if (!file) {
    if (p.source?.kind === 'keynote')
      throw new NeedsKeynote('Keynote slides are edited from Keynote’s PowerPoint export, which this presentation doesn’t have yet.');
    throw new Error('The PowerPoint file this slide came from is missing, so it can’t be edited.');
  }
  const { deck } = await openDeck(file);
  const found = deck.slides[src.number - 1];
  if (!found) throw new Error('This slide isn’t in its PowerPoint file any more.');
  return { width: deck.width, height: deck.height, slide: structuredClone(found) };
}

const decoded = new Map<string, Promise<CanvasImageSource | null>>();

/** The pictures a slide's model uses: from its PowerPoint file, or stored in Lumen ("media:<id>"). */
export async function imagesFor(fileId: string | undefined, slide: DeckSlide): Promise<Images> {
  const images: Images = new Map();
  await Promise.all(
    [...deckImagePaths([slide])].map(async (path) => {
      const key = path.startsWith('media:') ? path : `${fileId}|${path}`;
      let image = decoded.get(key);
      if (!image) {
        image = (async () => {
          if (path.startsWith('media:')) {
            const blob = await getMediaBlob(path.slice(6));
            return blob ? decodeImage(blob) : null;
          }
          if (!fileId) return null;
          const blob = fileImage(path, (await openDeck(fileId)).files);
          return blob ? decodeImage(blob) : null;
        })();
        decoded.set(key, image);
      }
      images.set(path, await image);
    }),
  );
  return images;
}

/** Stores a picture added on a slide, for the model to use as "media:<id>". */
export async function storeSlideImage(blob: Blob): Promise<{ id: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  const id = uid();
  await putMediaBlob(id, blob);
  return { id, ...size };
}

/** The stored pictures ("media:<id>") a slide's model uses. */
function addedImages(slide: DeckSlide): string[] {
  return [...deckImagePaths([slide])].filter((p) => p.startsWith('media:')).map((p) => p.slice(6));
}

/** A slide's model and picture, stored: what a slide's `source` says after an edit. */
async function storeSlide(editable: EditableSlide, file: string | undefined, number: number): Promise<SlideSource> {
  const slide: DeckSlide = { ...editable.slide, text: slideWordsOf(editable.slide) };
  const kept: EditableSlide = { ...editable, slide };
  const model = uid();
  await putMediaBlob(model, new Blob([JSON.stringify(kept)], { type: 'application/json' }));
  const picture = uid();
  await putMediaBlob(picture, await renderDeckSlide(editable, slide, await imagesFor(file, slide)));
  const images = addedImages(slide);
  return { picture, text: slide.text, number, model, ...(file ? { file } : {}), ...(images.length ? { images } : {}) };
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Keeps an edited slide: its model, a new picture, and its words. Saves of one slide happen in
 * the order they're made. Each is one step to undo.
 */
export function saveEditable(presentationId: string, slideId: string, editable: EditableSlide): Promise<void> {
  const run = async () => {
    const s = useStore.getState();
    const p = s.presentations[presentationId];
    const slide = p?.groups.flatMap((g) => g.slides).find((sl) => sl.id === slideId);
    if (!p || !slide?.source) return;
    const source = await storeSlide(editable, deckFileOf(p, slide), slide.source.number);
    useStore.getState().updateSlide(presentationId, slideId, { source });
  };
  const next = (queues.get(slideId) ?? Promise.resolve()).then(run, run);
  queues.set(slideId, next);
  return next;
}

/** A new slide after `afterSlideId` with the same design as it (or the first slide). Returns its id. */
export async function insertBlankSlide(presentationId: string, afterSlideId: string | null): Promise<string | null> {
  const p = useStore.getState().presentations[presentationId];
  const slides = p?.groups.flatMap((g) => g.slides) ?? [];
  const like = slides.find((sl) => sl.id === afterSlideId && sl.source) ?? slides.find((sl) => sl.source);
  if (!p || !like?.source) return null;
  const base = await loadEditable(p, like);
  const blank: EditableSlide = { ...base, slide: blankSlideLike(base.slide) };
  const slide: Slide = { id: uid(), text: '', source: await storeSlide(blank, deckFileOf(p, like), 0) };
  const now = useStore.getState().presentations[presentationId];
  if (!now) return null;
  const before = new Set(now.groups.flatMap((g) => g.slides.map((sl) => sl.id)));
  useStore.getState().updatePresentation(presentationId, ops.insertSlides(now, afterSlideId ?? like.id, [slide]));
  const after = useStore.getState().presentations[presentationId]?.groups.flatMap((g) => g.slides) ?? [];
  return after.find((sl) => !before.has(sl.id))?.id ?? null;
}

/**
 * Keynote presentations imported before editing came in have no PowerPoint export to edit from:
 * Keynote (on a Mac) makes one from the stored Keynote file.
 */
export async function makeKeynoteEditable(presentationId: string): Promise<void> {
  const p = useStore.getState().presentations[presentationId];
  const desktop = window.lumenDesktop;
  if (!p?.source || p.source.kind !== 'keynote') return;
  if (!desktop?.keynoteExport) throw new Error('Keynote slides can be made editable in Lumen’s Mac app, with Keynote installed.');
  const original = p.source.fileId ? await getMediaBlob(p.source.fileId) : undefined;
  if (!original) throw new Error('The Keynote file this presentation came from is missing.');
  const exported = await desktop.keynoteExport(p.source.fileName, new Uint8Array(await original.arrayBuffer()));
  try {
    if (!exported.pptx) throw new Error('Keynote couldn’t export this presentation as PowerPoint.');
    const bytes = await desktop.keynotePptx(exported.id);
    const pptxId = uid();
    await putMediaBlob(pptxId, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    const now = useStore.getState().presentations[presentationId];
    if (now?.source) useStore.getState().updatePresentation(presentationId, { source: { ...now.source, pptxId } });
  } finally {
    void desktop.keynoteDone(exported.id);
  }
}

/** The slide's own elements (for the editor's list), with their places in `slide.elements`. */
export const ownElements = (slide: DeckSlide): { e: DeckElement; i: number }[] =>
  slide.elements.flatMap((e, i) => (e.template ? [] : [{ e, i }]));
