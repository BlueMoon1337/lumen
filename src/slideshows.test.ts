import { beforeEach, describe, expect, it } from 'vitest';
import { enabledCommands } from './components/editCommands';
import { slideMenu } from './components/menus';
import { planImport, presentationFile, readLumenFile, zipFile } from './fileFormats';
import { buildFrame } from './frame';
import { getSequence } from './lyrics';
import { deckFileOf, isSlideshow, ownFiles, slideWords, withoutMissingFiles } from './slideshows';
import { useStore } from './store';
import type { Presentation } from './types';

const s = () => useStore.getState();

/** A presentation as importing a PowerPoint file makes it: picture slides, with the file kept. */
function slideshow(): string {
  return s().createPresentation({
    title: 'Retreat',
    category: 'slideshows',
    background: { type: 'none', color: '#000000', color2: '#000000' },
    source: { kind: 'powerpoint', fileName: 'Retreat.pptx', fileId: 'file1', modelId: 'model1', width: 1920, height: 1080, importedAt: 1 },
    groups: [
      {
        id: 'g1',
        name: 'Slides',
        color: '#5f6368',
        slides: [
          { id: 's1', text: '', notes: 'Welcome everyone', source: { picture: 'pic1', text: 'WELCOME\n\nRetreat 2026', number: 1 } },
          { id: 's2', text: '', source: { picture: 'pic2', text: 'OBJECTIVES', number: 2 } },
        ],
      },
    ],
    arrangement: ['g1'],
  });
}

const slides = (id: string) => s().presentations[id].groups.flatMap((g) => g.slides);

beforeEach(() => {
  s().clearAll();
  useStore.setState({ media: [] });
});

describe('imported PowerPoint and Keynote presentations', () => {
  it('show each slide’s picture, with its words and notes on the stage', () => {
    const id = slideshow();
    s().select(id);
    s().goLive(id, 0);
    const frame = buildFrame(s());
    expect(frame.slide).toMatchObject({ text: '', picture: 'pic1' });
    expect(frame.stage).toMatchObject({ current: 'WELCOME\n\nRetreat 2026', next: 'OBJECTIVES', notes: 'Welcome everyone' });
    expect(frame.stage.currentSlide?.picture).toBe('pic1');
    expect(slideWords(slides(id)[1])).toBe('OBJECTIVES');
  });

  it('have slide operations like any presentation, but no Reflow (their slides are pictures)', () => {
    const id = slideshow();
    s().select(id);
    s().setPresentationText(id, 'New words');
    expect(slides(id).map((sl) => sl.id)).toEqual(['s1', 's2']);
    const copy = s().duplicateSlide(id, 's1');
    expect(slides(id).find((sl) => sl.id === copy)?.source?.picture).toBe('pic1');
    s().deleteSlides(id, ['s2']);
    expect(slides(id).map((sl) => sl.source?.picture)).toEqual(['pic1', 'pic1']);
    s().openEditor('s1');
    expect(s().mode).toBe('edit');
  });

  it('take their PowerPoint file along when their slides are copied', () => {
    const id = slideshow();
    s().copySlides(id, ['s1']);
    expect(s().slideClipboard?.[0].source).toMatchObject({ picture: 'pic1', file: 'file1' });
    const other = s().createPresentation({ title: 'Mixed' }, 'Hello');
    s().pasteSlides(other, null);
    expect(slides(other).at(-1)?.source?.file).toBe('file1');
  });

  it('offer slide editing in their menus, without text styles', () => {
    const id = slideshow();
    s().select(id);
    const p = s().presentations[id];
    const labels = slideMenu(p, p.groups[0].slides[0], p.groups[0], { index: 0 })
      .filter((e) => e && e !== '-')
      .map((e) => (e as { label: string }).label);
    expect(labels).toEqual(
      expect.arrayContaining(['Edit Slide', 'Cut', 'Copy', 'Duplicate', 'Insert Blank Slide', 'Delete Slide', 'Label']),
    );
    expect(labels).not.toContain('Copy Text Style');
    const on = enabledCommands({ kind: 'slides', presentation: p, ids: ['s1'] });
    expect([...on]).toEqual(expect.arrayContaining(['cut', 'copy', 'duplicate', 'delete']));
  });

  it('keep their pictures and files, which Lumen bundles carry with them', () => {
    const id = slideshow();
    const p = s().presentations[id];
    expect(isSlideshow(p)).toBe(true);
    expect(deckFileOf(p, p.groups[0].slides[0])).toBe('file1');
    expect(ownFiles(p).map((f) => f.id)).toEqual(['pic1', 'pic2', 'file1', 'model1']);
    const file = presentationFile(s(), id);
    expect(file.files?.map((f) => f.id)).toEqual(['pic1', 'pic2', 'file1', 'model1']);
    const blobs = new Map(['pic1', 'pic2', 'file1', 'model1'].map((k) => [k, new Uint8Array([1, 2, 3])]));
    const read = readLumenFile(zipFile(file, blobs));
    expect([...read.blobs.keys()].sort()).toEqual(['file1', 'model1', 'pic1', 'pic2']);
    // Into another library: the files come too, and it stays read-only.
    s().clearAll();
    const plan = planImport(s(), read.file, read.blobs, 'other');
    expect(plan.files.map((f) => f.id)).toEqual(['pic1', 'pic2', 'file1', 'model1']);
    expect(plan.presentations[0].source?.fileId).toBe('file1');
    expect(getSequence(plan.presentations[0]).map((e) => e.slide.source?.picture)).toEqual(['pic1', 'pic2']);
  });

  it('without their pictures (a file without them) become text slides of their words', () => {
    const id = slideshow();
    const p: Presentation = withoutMissingFiles(s().presentations[id], (f) => f === 'pic1');
    expect(p.groups[0].slides.map((sl) => [sl.text, sl.source?.picture])).toEqual([
      ['', 'pic1'],
      ['OBJECTIVES', undefined],
    ]);
    expect(p.source).toMatchObject({ kind: 'powerpoint' });
    expect(p.source?.fileId).toBeUndefined();
    const none = withoutMissingFiles(s().presentations[id], () => false);
    expect(none.source).toBeUndefined();
    expect(isSlideshow(none)).toBe(false);
  });
});
