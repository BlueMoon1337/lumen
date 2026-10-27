/** Importing PowerPoint and Keynote files: see src/slideshows.ts. */
import type { Deck } from './deck';
import { loadDeckImages, renderDeckSlide } from './deckRender';
import { parsePptx } from './import/pptx';
import { readZip } from './import/zip';
import { putMediaBlob } from './media';
import { SLIDESHOW_LIBRARY_ID, SLIDESHOW_LIBRARY_NAME } from './slideshows';
import { useStore } from './store';
import type { Category, Group, PresentationSource, Slide } from './types';
import { uid } from './util';

/** The PowerPoint & Keynote library, made if it isn't there (or was deleted). */
export function slideshowLibrary(): Category {
  const s = useStore.getState();
  if (!s.libraries.some((l) => l.id === SLIDESHOW_LIBRARY_ID))
    useStore.setState({ libraries: [...s.libraries, { id: SLIDESHOW_LIBRARY_ID, name: SLIDESHOW_LIBRARY_NAME }] });
  return SLIDESHOW_LIBRARY_ID;
}

/** A slide of an imported presentation, before it is stored. */
export interface ImportedSlide {
  picture: Blob;
  text: string;
  notes: string;
  /** Its number in the file, from 1. */
  number: number;
}

export interface ImportedSlideshow {
  title: string;
  source: Omit<PresentationSource, 'fileId' | 'modelId'>;
  /** Sections (PowerPoint's groups of slides), as names and slide numbers; none puts them all in one group. */
  sections: { name: string; slides: number[] }[];
  slides: ImportedSlide[];
  /** The original file, and Lumen's model of it, to keep. */
  file?: Blob;
  model?: Deck;
  /** Keynote: its PowerPoint export, which the slides are edited from. */
  pptx?: Blob;
}

const SLIDE_GROUP_COLOR = '#5f6368';

/** Stores an imported presentation's pictures and files, and adds it to the PowerPoint & Keynote library. */
export async function createSlideshow(data: ImportedSlideshow): Promise<string> {
  const pictures = new Map<number, string>();
  for (const sl of data.slides) {
    const id = uid();
    await putMediaBlob(id, sl.picture);
    pictures.set(sl.number, id);
  }
  const source: PresentationSource = { ...data.source };
  if (data.file) {
    source.fileId = uid();
    await putMediaBlob(source.fileId, data.file);
  }
  if (data.model) {
    source.modelId = uid();
    await putMediaBlob(source.modelId, new Blob([JSON.stringify(data.model)], { type: 'application/json' }));
  }
  if (data.pptx) {
    source.pptxId = uid();
    await putMediaBlob(source.pptxId, data.pptx);
  }
  // The PowerPoint file each slide is edited from.
  const file = source.kind === 'keynote' ? source.pptxId : source.fileId;
  const slideOf = (sl: ImportedSlide): Slide => ({
    id: uid(),
    text: '',
    notes: sl.notes || undefined,
    source: { picture: pictures.get(sl.number)!, text: sl.text, number: sl.number, ...(file ? { file } : {}) },
  });
  const byNumber = new Map(data.slides.map((sl) => [sl.number, sl]));
  const used = new Set<number>();
  const groups: Group[] = [];
  for (const section of data.sections) {
    const slides = section.slides.flatMap((n) => {
      const sl = byNumber.get(n);
      if (!sl || used.has(n)) return [];
      used.add(n);
      return [slideOf(sl)];
    });
    if (slides.length) groups.push({ id: uid(), name: section.name || 'Slides', color: SLIDE_GROUP_COLOR, slides });
  }
  const rest = data.slides.filter((sl) => !used.has(sl.number));
  if (rest.length)
    groups.push({ id: uid(), name: groups.length ? 'More Slides' : 'Slides', color: SLIDE_GROUP_COLOR, slides: rest.map(slideOf) });

  const category = slideshowLibrary();
  return useStore.getState().createPresentation({
    title: data.title,
    category,
    groups,
    arrangement: groups.map((g) => g.id),
    // No background of its own: the pictures fill the screen, and black bars show behind other shapes.
    background: { type: 'none', color: '#000000', color2: '#000000' },
    source,
  });
}

/** Lumen's pictures are 1920 wide; a slide that isn't 16:9 sits in the middle, on black. */
const PICTURE_W = 1920;
const PICTURE_H = 1080;

/** Reads a PowerPoint file and draws its slides. `progress` hears how many are done. */
export async function readPowerPoint(file: File, progress?: (done: number, total: number) => void): Promise<ImportedSlideshow> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const deck = parsePptx(bytes);
  const images = await loadDeckImages(
    deck,
    readZip(bytes, (n) => n.startsWith('ppt/media/')),
  );
  const shown = deck.slides.map((s, i) => ({ s, number: i + 1 })).filter(({ s }) => !s.hidden);
  if (!shown.length) throw new Error('it has no slides to show');
  const slides: ImportedSlide[] = [];
  for (const { s, number } of shown) {
    slides.push({ picture: await renderDeckSlide(deck, s, images, PICTURE_W, PICTURE_H), text: s.text, notes: s.notes, number });
    progress?.(slides.length, shown.length);
  }
  return {
    title: file.name.replace(/\.[^.]+$/, ''),
    source: { kind: 'powerpoint', fileName: file.name, width: deck.width, height: deck.height, importedAt: Date.now() },
    sections: deck.sections ?? [],
    slides,
    file,
    model: deck,
  };
}

/** Has Keynote (on a Mac) export a Keynote file's slides. */
export async function readKeynote(file: File, progress?: (done: number, total: number) => void): Promise<ImportedSlideshow> {
  const desktop = window.lumenDesktop;
  if (!desktop?.keynoteExport)
    throw new Error(
      'Keynote files can only be imported in Lumen’s Mac app, with Keynote installed. In Keynote, choose File ▸ Export To ▸ PowerPoint, and import that.',
    );
  const deck = await desktop.keynoteExport(file.name, new Uint8Array(await file.arrayBuffer()));
  try {
    const shown = deck.slides.map((s, i) => ({ s, number: i + 1 })).filter(({ s }) => !s.skipped);
    if (!shown.length || !deck.images) throw new Error('it has no slides to show');
    const slides: ImportedSlide[] = [];
    for (const [i, { s, number }] of shown.slice(0, deck.images).entries()) {
      const bytes = await desktop.keynoteImage(deck.id, i);
      slides.push({ picture: await fitPicture(new Blob([bytes], { type: 'image/jpeg' })), text: s.text, notes: s.notes, number });
      progress?.(slides.length, shown.length);
    }
    return {
      title: file.name.replace(/\.[^.]+$/, ''),
      source: {
        kind: 'keynote',
        fileName: file.name,
        width: PICTURE_W,
        height: Math.round((deck.height / deck.width) * PICTURE_W) || PICTURE_H,
        importedAt: Date.now(),
      },
      sections: [],
      slides,
      file,
      pptx: deck.pptx ? await keynotePptx(deck.id) : undefined,
    };
  } finally {
    void desktop.keynoteDone(deck.id);
  }
}

/** Keynote's PowerPoint export, if it could be read. */
async function keynotePptx(id: string): Promise<Blob | undefined> {
  try {
    const bytes = await window.lumenDesktop!.keynotePptx(id);
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  } catch {
    return undefined;
  }
}

/** A picture redrawn at 1920 × 1080, in the middle on black if it's another shape. */
async function fitPicture(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_W;
  canvas.height = PICTURE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, PICTURE_W, PICTURE_H);
  const k = Math.min(PICTURE_W / bitmap.width, PICTURE_H / bitmap.height);
  const w = bitmap.width * k;
  const h = bitmap.height * k;
  ctx.drawImage(bitmap, (PICTURE_W - w) / 2, (PICTURE_H - h) / 2, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.9));
}
